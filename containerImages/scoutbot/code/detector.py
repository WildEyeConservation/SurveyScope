"""ScoutBot backend selection and TensorRT engine caching."""

import hashlib
import logging
import multiprocessing
import os
from pathlib import Path

import torch

from fast import WEIGHTS, ScoutBot

LOC_THRESH = 0.45
BATCH = 32
ENGINE_PREFIX = 'scoutbot-engines/'


def engine_name(batch=BATCH):
    import tensorrt

    gpu = torch.cuda.get_device_name().replace(' ', '-')
    weights = hashlib.sha256(WEIGHTS.read_bytes()).hexdigest()[:12]
    return f'scoutbot-{gpu}-fp16-b{batch}-{weights}-trt{tensorrt.__version__}.plan'


def _s3():
    import boto3

    return boto3.client('s3', os.environ['REGION'])


def fetch_engine(path):
    bucket = os.environ.get('ENGINE_BUCKET')
    if not bucket:
        return False
    partial = path.with_suffix('.download')
    try:
        _s3().download_file(bucket, ENGINE_PREFIX + path.name, str(partial))
    except Exception as error:
        logging.info('No cached TensorRT engine %s in %s (%s).', path.name, bucket, type(error).__name__)
        partial.unlink(missing_ok=True)
        return False
    partial.rename(path)
    return True


def build_engine(path):
    import trt

    onnx_path = path.with_suffix('.onnx')
    partial = path.with_suffix('.partial')
    trt.export_onnx(WEIGHTS, onnx_path)
    trt.build(onnx_path, partial, BATCH)
    onnx_path.unlink()
    partial.rename(path)
    bucket = os.environ.get('ENGINE_BUCKET')
    if bucket:
        try:
            _s3().upload_file(str(path), bucket, ENGINE_PREFIX + path.name)
        except Exception as error:
            logging.warning('Could not cache TensorRT engine %s in %s: %s', path.name, bucket, error)


def _build_engine_process(path):
    logging.basicConfig(level=logging.INFO)
    path = Path(path)
    logging.info('Building TensorRT engine %s.', path.name)
    build_engine(path)
    logging.info('Built TensorRT engine %s.', path.name)


class Detector:
    def __init__(self):
        self.device = torch.device('cuda')
        self.builder = None
        self.engine = None
        backend = os.environ.get('SCOUTBOT_BACKEND', 'tensorrt')
        if backend == 'tensorrt':
            try:
                directory = Path(os.environ.get('SCOUTBOT_ENGINE_DIR', '/workspace/engines'))
                directory.mkdir(parents=True, exist_ok=True)
                self.engine = directory / engine_name()
            except ImportError as error:
                logging.warning('TensorRT is not available (%s); ScoutBot runs in PyTorch fp16.', error)
        if self.engine and (self.engine.exists() or fetch_engine(self.engine)) and self._use_engine():
            return
        self.model = ScoutBot(loc_thresh=LOC_THRESH, precision='fp16', batch=BATCH)
        logging.info('ScoutBot runs in PyTorch fp16 on %s.', torch.cuda.get_device_name())
        if self.engine and not self.engine.exists():
            self.builder = multiprocessing.get_context('spawn').Process(
                target=_build_engine_process, args=(str(self.engine),), daemon=True
            )
            self.builder.start()

    def _use_engine(self):
        try:
            self.model = ScoutBot(loc_thresh=LOC_THRESH, backend='tensorrt', engine=self.engine, batch=BATCH)
        except Exception as error:
            logging.error('Could not load TensorRT engine %s: %s', self.engine, error)
            self.engine.unlink(missing_ok=True)
            return False
        logging.info('ScoutBot runs through TensorRT engine %s.', self.engine.name)
        return True

    def maybe_upgrade(self):
        if self.builder is None or self.builder.is_alive():
            return
        exitcode, self.builder = self.builder.exitcode, None
        if exitcode != 0 or not self.engine.exists():
            logging.error('Building the TensorRT engine failed (exit code %s); staying on PyTorch fp16.', exitcode)
            return
        previous = self.model
        if self._use_engine():
            del previous
            torch.cuda.empty_cache()

    def detect(self, picture):
        return self.model.detect(picture)
