"""OWL-D inference wrapper for the Detweb SQS worker."""

from contextlib import nullcontext
from dataclasses import dataclass
import os
import sys
import time

sys.path.insert(0, '/workspace')
sys.path.insert(0, '/workspace/dinov3')

from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = None

DOWN_RATIO = 2
DEFAULT_ADAPT_TS = 0.3
DEFAULT_NEG_TS = 0.1
DEFAULT_TILE_SIZE = 512
DEFAULT_OVERLAP = 160

VARIANTS = {
    'owl-d': {
        'registry': 'OWLD_H',
        'kwargs': {
            'pretrained': False,
            'head_conv': 64,
            'readout_type': 'ignore',
            'freeze_backbone': True,
            'down_ratio': DOWN_RATIO,
        },
    },
}


@dataclass(frozen=True)
class Detection:
    x: int
    y: int
    score: float


def _env_bool(name, default=False):
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ('1', 'true', 'yes', 'on')


def _env_int(name, default):
    raw = os.environ.get(name)
    return default if raw in (None, '') else int(raw)


def _tile_size():
    raw = os.environ.get('OWL_TILE_SIZE')
    if not raw:
        return (DEFAULT_TILE_SIZE, DEFAULT_TILE_SIZE)
    parts = raw.lower().replace('x', ',').split(',')
    values = [int(part.strip()) for part in parts if part.strip()]
    if len(values) == 1:
        return (values[0], values[0])
    if len(values) == 2:
        return (values[0], values[1])
    raise ValueError(f'OWL_TILE_SIZE must be N or HxW, got {raw!r}')


def _configure_torch(device):
    if device != 'cuda':
        return
    import torch

    try:
        torch.backends.cuda.matmul.allow_tf32 = _env_bool('OWL_TF32', True)
        torch.backends.cudnn.allow_tf32 = _env_bool('OWL_TF32', True)
        torch.backends.cudnn.benchmark = _env_bool('OWL_CUDNN_BENCHMARK', True)
    except Exception as error:
        print(f'[owl-d] CUDA backend tuning skipped ({error})', flush=True)
    try:
        torch.set_float32_matmul_precision(
            os.environ.get('OWL_MATMUL_PRECISION', 'high')
        )
    except Exception as error:
        print(f'[owl-d] matmul precision tuning skipped ({error})', flush=True)


def _amp_dtype(device):
    if device != 'cuda':
        return None
    mode = os.environ.get('OWL_AMP', 'off').strip().lower()
    if mode in ('', '0', 'false', 'no', 'off', 'none'):
        return None
    import torch

    if mode in ('1', 'true', 'yes', 'on', 'auto', 'fp16', 'float16', 'half'):
        return torch.float16
    if mode in ('bf16', 'bfloat16'):
        return torch.bfloat16
    raise ValueError(f'OWL_AMP must be off, fp16, or bf16, got {mode!r}')


def _autocast(device, dtype):
    if device == 'cuda' and dtype is not None:
        import torch

        return torch.autocast(device_type='cuda', dtype=dtype)
    return nullcontext()


def _compile_mode():
    mode = os.environ.get('OWL_COMPILE', 'off').strip().lower()
    if mode in ('', '0', 'false', 'no', 'off', 'none'):
        return None
    if mode in ('1', 'true', 'yes', 'on'):
        return 'default'
    return mode


def _static_batch_stitcher():
    import torch
    from animaloc.eval.stitchers import HerdNet_Detection_Branch_Stitcher

    class StaticBatchStitcher(HerdNet_Detection_Branch_Stitcher):
        # Pads short batches so compiled graphs always see one input shape.
        pad_batches = False

        @torch.no_grad()
        def _inference(self, patches):
            self.model.eval()
            maps = []
            for start in range(0, len(patches), self.batch_size):
                batch = patches[start:start + self.batch_size]
                count = len(batch)
                if self.pad_batches and count < self.batch_size:
                    padding = batch.new_zeros((self.batch_size - count, *batch.shape[1:]))
                    batch = torch.cat([batch, padding])
                outputs = self.model(batch.to(self.device).contiguous())[0]
                if isinstance(outputs, tuple):
                    outputs = outputs[0]
                maps.append(outputs[:count].clone())
            return maps

        def _process_single_image(self, image):
            output_map = self._inference(image.unsqueeze(0))[0]
            if self.up:
                output_map = torch.nn.functional.interpolate(
                    output_map,
                    scale_factor=self.down_ratio,
                    mode='bilinear',
                    align_corners=True,
                )
            return output_map

    return StaticBatchStitcher


def _image_tensor(image):
    import numpy as np
    import torch

    oriented = ImageOps.exif_transpose(image).convert('RGB')
    original_width, original_height = oriented.size
    max_side = _env_int('OWL_MAX_SIDE', 0)
    scale = 1.0
    if max_side > 0 and max(original_width, original_height) > max_side:
        scale = max_side / float(max(original_width, original_height))
        new_size = (
            max(1, int(round(original_width * scale))),
            max(1, int(round(original_height * scale))),
        )
        resampling = getattr(getattr(Image, 'Resampling', Image), 'BILINEAR')
        oriented = oriented.resize(new_size, resampling)
    width, height = oriented.size
    arr = np.asarray(oriented, dtype=np.float32) / 255.0

    tensor = torch.from_numpy(arr).permute(2, 0, 1)
    mean = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
    std = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
    return (tensor - mean) / std, original_width, original_height, width, height, scale


class OwlDDetector:
    def __init__(self, model_path, threshold=0.05):
        if not os.path.isfile(model_path):
            raise FileNotFoundError(f'OWL-D checkpoint not found: {model_path}')

        import animaloc.models as model_registry
        from animaloc.eval.lmds import HerdNet_Detection_Branch_LMDS
        from animaloc.models.utils import LossWrapper, load_model
        import torch

        variant = os.environ.get('OWL_VARIANT', 'owl-d').lower()
        if variant not in VARIANTS:
            raise ValueError(f'unknown OWL_VARIANT {variant!r}; expected owl-d')
        if not torch.cuda.is_available():
            raise RuntimeError('CUDA is not available for OWL-D inference')

        self.device = 'cuda'
        _configure_torch(self.device)
        spec = VARIANTS[variant]
        model_cls = getattr(model_registry, spec['registry'])
        model = LossWrapper(model_cls(**spec['kwargs']), [])
        model = load_model(model, model_path).to(self.device).eval()
        model.register_forward_pre_hook(self._before_forward)
        model.register_forward_hook(self._after_forward)
        self._forward_seconds = 0.0
        self._forward_calls = 0
        self.last_stats = {}
        self.compile_mode = _compile_mode()
        if self.compile_mode:
            model.model = torch.compile(model.model, mode=self.compile_mode, dynamic=False)

        self.stitcher = _static_batch_stitcher()(
            model=model,
            size=_tile_size(),
            overlap=_env_int('OWL_OVERLAP', DEFAULT_OVERLAP),
            batch_size=max(1, _env_int('OWL_BATCH_SIZE', 1)),
            down_ratio=DOWN_RATIO,
            up=False,
            reduction=os.environ.get('OWL_REDUCTION', 'mean'),
            device_name=self.device,
        )
        self.stitcher.pad_batches = bool(self.compile_mode)
        self.lmds = HerdNet_Detection_Branch_LMDS(
            up=False,
            kernel_size=(3, 3),
            adapt_ts=float(os.environ.get('OWL_ADAPT_TS', str(DEFAULT_ADAPT_TS))),
            neg_ts=float(os.environ.get('OWL_NEG_TS', str(DEFAULT_NEG_TS))),
        )
        self.amp_dtype = _amp_dtype(self.device)
        self.threshold = float(threshold)
        print(
            '[owl-d] config '
            f'device={self.device} tile={self.stitcher.size} '
            f'overlap={self.stitcher.overlap} batch={self.stitcher.batch_size} '
            f'amp={os.environ.get("OWL_AMP", "off")} '
            f'compile={self.compile_mode or "off"} '
            f'threshold={self.threshold}',
            flush=True,
        )
        if self.compile_mode:
            self._warm_up()

    def _warm_up(self):
        import torch

        patches = torch.zeros((self.stitcher.batch_size, 3, *self.stitcher.size))
        start = time.perf_counter()
        with torch.inference_mode(), _autocast(self.device, self.amp_dtype):
            self.stitcher._inference(patches)
        print(
            f'[owl-d] compiled in {time.perf_counter() - start:.1f}s',
            flush=True,
        )

    def _before_forward(self, module, args):
        self._forward_start = time.perf_counter()

    def _after_forward(self, module, args, output):
        import torch

        torch.cuda.synchronize()
        self._forward_seconds += time.perf_counter() - self._forward_start
        self._forward_calls += 1

    def detect(self, image):
        import torch

        start = time.perf_counter()
        self._forward_seconds = 0.0
        self._forward_calls = 0
        torch.cuda.reset_peak_memory_stats()
        tensor, original_width, original_height, _, _, scale = _image_tensor(image)
        prep_done = time.perf_counter()
        with torch.inference_mode(), _autocast(self.device, self.amp_dtype):
            heatmap = self.stitcher(tensor)
        torch.cuda.synchronize()
        stitch_done = time.perf_counter()
        if heatmap.dtype != torch.float32:
            heatmap = heatmap.float()

        with torch.inference_mode():
            _, locs, _, scores = self.lmds(heatmap)

        detections = []
        for (row, col), score in zip(locs[0], scores[0]):
            score = float(score)
            if score < self.threshold:
                continue
            x = min(original_width - 1.0, ((float(col) + 0.5) * DOWN_RATIO) / scale)
            y = min(original_height - 1.0, ((float(row) + 0.5) * DOWN_RATIO) / scale)
            detections.append(Detection(x=int(round(x)), y=int(round(y)), score=score))
        self.last_stats = {
            'prep': prep_done - start,
            'forward': self._forward_seconds,
            'tiling': stitch_done - prep_done - self._forward_seconds,
            'post': time.perf_counter() - stitch_done,
            'batches': self._forward_calls,
            'peak_vram_mib': torch.cuda.max_memory_allocated() / 2**20,
        }
        return detections