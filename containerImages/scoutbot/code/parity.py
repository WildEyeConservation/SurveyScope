"""Compare and time the worker's detector against scoutbot.pipeline_v3: python3 parity.py image1.jpg ..."""

import json
import sys
import time

import numpy as np
import torch

from detector import LOC_THRESH, Detector
from fast import decode


def xyxy(detections):
    return np.array([[d['x'], d['y'], d['x'] + d['w'], d['y'] + d['h'], d['c']] for d in detections]).reshape(-1, 5)


def compare(reference, candidate, iou=0.5):
    """Greedy one-to-one matching by IoU, strongest reference boxes first."""
    ref, new = xyxy(reference), xyxy(candidate)
    matched, score_moves, free = 0, [], np.ones(len(new), dtype=bool)
    for box in ref[np.argsort(-ref[:, 4])]:
        if not free.any():
            break
        others = new[free]
        lt = np.maximum(box[:2], others[:, :2])
        rb = np.minimum(box[2:4], others[:, 2:4])
        inter = np.prod(np.clip(rb - lt, 0, None), axis=1)
        union = np.prod(box[2:4] - box[:2]) + np.prod(others[:, 2:4] - others[:, :2], axis=1) - inter
        best = np.argmax(inter / union)
        if inter[best] / union[best] >= iou:
            free[np.flatnonzero(free)[best]] = False
            matched += 1
            score_moves.append(abs(others[best, 4] - box[4]))
    return {'reference': len(ref), 'candidate': len(new), 'matched': matched,
            'max_score_move': float(max(score_moves, default=0))}


def timed(run):
    torch.cuda.synchronize()
    started = time.perf_counter()
    result = run()
    torch.cuda.synchronize()
    return result, time.perf_counter() - started


def main(paths):
    import scoutbot
    from scoutbot import loc, tile_batched

    model = tile_batched.Yolov8DetectionModel(
        model_path=loc.fetch(config='v3'), confidence_threshold=LOC_THRESH, device=0
    )
    detector = Detector()
    if detector.builder is not None:
        print('waiting for the TensorRT engine build', flush=True)
        detector.builder.join()
        detector.maybe_upgrade()
    reference_run = lambda path: scoutbot.pipeline_v3(
        path, 'v3', batched_detection_model=model, backend_device=0, loc_thresh=LOC_THRESH
    )[1]
    fast_run = lambda path: detector.detect(decode(path).to(detector.device))
    reference_run(paths[0]), fast_run(paths[0])
    totals = {'reference': 0, 'candidate': 0, 'matched': 0}
    seconds = {'reference': [], 'fast': []}
    for path in paths:
        reference, reference_seconds = timed(lambda: reference_run(path) or [])
        candidate, fast_seconds = timed(lambda: fast_run(path))
        seconds['reference'].append(reference_seconds)
        seconds['fast'].append(fast_seconds)
        result = compare(reference, candidate)
        for key in totals:
            totals[key] += result[key]
        print(path, f'{reference_seconds:.2f} s -> {fast_seconds:.2f} s', json.dumps(result), flush=True)
    print('backend', detector.model.backend, 'totals', json.dumps(totals))
    print(f"mean {np.mean(seconds['reference']):.3f} s -> {np.mean(seconds['fast']):.3f} s per image")


if __name__ == '__main__':
    main(sys.argv[1:])
