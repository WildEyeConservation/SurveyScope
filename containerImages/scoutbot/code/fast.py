"""GPU-batched ScoutBot v3 inference, matching scoutbot.pipeline_v3."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
import torchvision
from PIL import Image

WEIGHTS = Path('/root/.cache/pooch/1531819e3bc2a3f67a7b407832add7fe-yolov8-onecls.kaza.pt')

# Ultralytics predictor defaults that pipeline_v3 never changes.
PREDICTOR_CONF = 0.25
NMS_IOU = 0.7
MAX_DET = 300
MERGE_IOS = 0.5
LETTERBOX_FILL = 114
# EXIF orientation as cv2.imread applies it: (quarter turns anticlockwise, mirror first).
ORIENTATIONS = {2: (0, True), 3: (2, False), 4: (2, True), 5: (1, True), 6: (3, False), 7: (3, True), 8: (1, False)}


def slice_corners(height: int, width: int, tile: int = 512, overlap: float = 0.25) -> list[tuple[int, int]]:
    """Top-left (y, x) of SAHI's slices, in its order."""
    corners = []
    step_overlap = int(overlap * tile)
    y_min = y_max = 0
    while y_max < height:
        x_min = x_max = 0
        y_max = y_min + tile
        while x_max < width:
            x_max = x_min + tile
            if y_max > height or x_max > width:
                corners.append((max(0, min(height, y_max) - tile), max(0, min(width, x_max) - tile)))
            else:
                corners.append((y_min, x_min))
            x_min = x_max - step_overlap
        y_min = y_max - step_overlap
    return corners


def _decode_cv2(path: str) -> torch.Tensor:
    import cv2

    image = cv2.imread(path, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f'could not read image {path}')
    return torch.from_numpy(cv2.cvtColor(image, cv2.COLOR_BGR2RGB)).permute(2, 0, 1)


def decode(path: str | Path) -> torch.Tensor:
    """The image as a 3 x H x W uint8 CPU tensor, EXIF-oriented with the same pixels as cv2.imread."""
    path = str(path)
    try:
        picture = torchvision.io.decode_image(torchvision.io.read_file(path), mode=torchvision.io.ImageReadMode.RGB)
    except RuntimeError:
        return _decode_cv2(path).contiguous()
    if picture.dtype == torch.uint16:
        # cv2.imread keeps the high byte of 16-bit images.
        picture = (picture.to(torch.int32) >> 8).to(torch.uint8)
    with Image.open(path) as image:
        orientation = image.getexif().get(0x0112, 1)
    if orientation in ORIENTATIONS:
        turns, mirror = ORIENTATIONS[orientation]
        if mirror:
            picture = picture.flip(-1)
        picture = torch.rot90(picture, turns, dims=(1, 2))
    return picture.contiguous()


def greedy_merge(
    boxes: np.ndarray, scores: np.ndarray, threshold: float = MERGE_IOS
) -> list[tuple[np.ndarray, float, int]]:
    """SAHI's class-agnostic GREEDYNMM on intersection over the smaller box: (box, score, label index)."""
    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    order = np.argsort(scores, kind='stable')
    alive = np.ones(len(boxes), dtype=bool)
    merged = []
    for position in range(len(order) - 1, -1, -1):
        keep = order[position]
        if not alive[keep]:
            continue
        alive[keep] = False
        rest = np.flatnonzero(alive)
        top_left = np.maximum(boxes[rest, :2], boxes[keep, :2])
        bottom_right = np.minimum(boxes[rest, 2:], boxes[keep, 2:])
        inter = np.prod(np.clip(bottom_right - top_left, 0, None), axis=1)
        matched = rest[inter / np.minimum(areas[rest], areas[keep]) >= threshold]
        alive[matched] = False
        box, score, label = boxes[keep].astype(np.float64), float(scores[keep]), keep
        for other in matched[np.argsort(-scores[matched], kind='stable')]:
            lt = np.maximum(box[:2], boxes[other, :2])
            rb = np.minimum(box[2:], boxes[other, 2:])
            inter_area = np.prod(np.clip(rb - lt, 0, None))
            smaller = min((box[2] - box[0]) * (box[3] - box[1]), areas[other])
            if inter_area / smaller > threshold:
                box = np.concatenate([np.minimum(box[:2], boxes[other, :2]), np.maximum(box[2:], boxes[other, 2:])])
                if not score > scores[other]:
                    label = other
                score = max(score, float(scores[other]))
        merged.append((box, score, label))
    return merged


class ScoutBot:
    def __init__(
        self,
        weights: Path = WEIGHTS,
        loc_thresh: float = 0.45,
        precision: str = 'fp32',
        backend: str = 'eager',
        batch: int = 32,
        tile: int = 512,
        overlap: float = 0.25,
        device: str = 'cuda',
        engine: Path | None = None,
    ):
        from ultralytics.nn.tasks import attempt_load_one_weight

        self.device = torch.device(device)
        self.loc_thresh, self.batch, self.tile, self.overlap = loc_thresh, batch, tile, overlap
        # A TensorRT engine takes float32 input whatever precision it computes in.
        self.dtype = torch.float16 if precision == 'fp16' and backend != 'tensorrt' else torch.float32
        model, _ = attempt_load_one_weight(str(weights))
        model = model.fuse(verbose=False).eval()
        self.names = model.names
        self.classes = len(model.names)
        head = model.model[-1]
        head.export, head.format = True, 'torchscript'  # return only decoded boxes and class scores
        if backend == 'tensorrt':
            from trt import Engine

            self.forward = Engine(engine, self.device)
        elif backend == 'eager':
            self.forward = model.to(self.device, self.dtype)
        else:
            raise ValueError(f'unknown backend {backend!r}')
        self.backend = backend

    def _slice(self, picture: torch.Tensor, y: int, x: int) -> torch.Tensor:
        part = picture[:, y : y + self.tile, x : x + self.tile]
        pad_height, pad_width = self.tile - part.shape[1], self.tile - part.shape[2]
        if pad_height or pad_width:
            part = torch.nn.functional.pad(part, (0, pad_width, 0, pad_height), value=LETTERBOX_FILL)
        return part

    @torch.inference_mode()
    def raw(self, picture: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """Boxes on the picture (x1, y1, x2, y2), scores and classes of every box NMS keeps."""
        _, height, width = picture.shape
        corners = slice_corners(height, width, self.tile, self.overlap)
        found = []
        for start in range(0, len(corners), self.batch):
            chunk = corners[start : start + self.batch]
            tiles = torch.stack([self._slice(picture, y, x) for y, x in chunk])
            output = self.forward(tiles.to(self.dtype).div_(255))
            output = output.float().transpose(1, 2)  # slices x anchors x (4 + classes)
            score, label = output[..., 4:].max(-1)
            keep = (score > PREDICTOR_CONF) & (score >= self.loc_thresh)
            slice_index, anchor = keep.nonzero(as_tuple=True)
            xywh = output[slice_index, anchor, :4]
            boxes = torch.cat([xywh[:, :2] - xywh[:, 2:] / 2, xywh[:, :2] + xywh[:, 2:] / 2], dim=1)
            score, label = score[slice_index, anchor], label[slice_index, anchor]
            kept = torchvision.ops.batched_nms(boxes, score, slice_index * self.classes + label, NMS_IOU)
            slice_index = slice_index[kept]
            rank = torch.zeros_like(slice_index)
            if len(kept):
                order = torch.argsort(slice_index, stable=True)
                sorted_slices = slice_index[order]
                first = torch.searchsorted(sorted_slices, sorted_slices, right=False)
                rank[order] = torch.arange(len(order), device=rank.device) - first
            within = rank < MAX_DET
            kept, slice_index = kept[within], slice_index[within]
            shift = torch.tensor(chunk, device=self.device, dtype=torch.float32)[slice_index][:, [1, 0]].repeat(1, 2)
            found.append((boxes[kept].clamp(0, self.tile) + shift, score[kept], label[kept]))
        boxes, scores, labels = (torch.cat(parts) for parts in zip(*found))
        boxes[:, 0::2] = boxes[:, 0::2].clamp(0, width)
        boxes[:, 1::2] = boxes[:, 1::2].clamp(0, height)
        return boxes, scores, labels

    def detect(self, picture: torch.Tensor) -> list[dict]:
        boxes, scores, labels = (part.cpu().numpy() for part in self.raw(picture))
        valid = (boxes[:, 0] < boxes[:, 2]) & (boxes[:, 1] < boxes[:, 3])
        boxes, scores, labels = boxes[valid], scores[valid], labels[valid]
        if len(boxes) > 1:
            merged = greedy_merge(boxes, scores)
        else:
            merged = [(box.astype(np.float64), float(score), index) for index, (box, score) in enumerate(zip(boxes, scores))]
        return [
            {
                'l': self.names[int(labels[label])],
                'c': score,
                'x': float(box[0]),
                'y': float(box[1]),
                'w': float(box[2] - box[0]),
                'h': float(box[3] - box[1]),
            }
            for box, score, label in merged
        ]
