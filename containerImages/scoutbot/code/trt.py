"""TensorRT engines are specific to their GPU model and TensorRT version."""

from __future__ import annotations

from pathlib import Path

import tensorrt as trt
import torch

LOGGER = trt.Logger(trt.Logger.WARNING)
TILE = 512


def export_onnx(weights: Path, path: Path, opset: int = 17) -> None:
    """The fused model as ONNX: N x 3 x 512 x 512 in [0, 1] in, N x (4 + classes) x anchors out."""
    from ultralytics.nn.tasks import attempt_load_one_weight

    model, _ = attempt_load_one_weight(str(weights))
    model = model.fuse(verbose=False).eval().float()
    head = model.model[-1]
    head.export, head.format = True, 'onnx'
    torch.onnx.export(
        model,
        torch.zeros(1, 3, TILE, TILE),
        str(path),
        opset_version=opset,
        input_names=['images'],
        output_names=['output'],
        dynamic_axes={'images': {0: 'batch'}, 'output': {0: 'batch'}},
        dynamo=False,
    )


def build(onnx_path: Path, engine_path: Path, batch: int, workspace_gb: float = 3) -> None:
    builder = trt.Builder(LOGGER)
    network = builder.create_network(0)
    parser = trt.OnnxParser(network, LOGGER)
    if not parser.parse(onnx_path.read_bytes()):
        raise RuntimeError('; '.join(str(parser.get_error(i)) for i in range(parser.num_errors)))
    config = builder.create_builder_config()
    config.set_memory_pool_limit(trt.MemoryPoolType.WORKSPACE, int(workspace_gb * 2**30))
    config.set_flag(trt.BuilderFlag.FP16)
    profile = builder.create_optimization_profile()
    profile.set_shape('images', (1, 3, TILE, TILE), (batch, 3, TILE, TILE), (batch, 3, TILE, TILE))
    config.add_optimization_profile(profile)
    serialised = builder.build_serialized_network(network, config)
    if serialised is None:
        raise RuntimeError('TensorRT could not build the engine')
    engine_path.write_bytes(bytes(serialised))


class Engine:
    """A built engine called like the model: N x 3 x 512 x 512 float32 in, N x (4 + classes) x anchors out."""

    def __init__(self, path: Path, device: torch.device):
        self.device = device
        self.runtime = trt.Runtime(LOGGER)
        self.engine = self.runtime.deserialize_cuda_engine(Path(path).read_bytes())
        if self.engine is None:
            raise RuntimeError(f'TensorRT could not load the engine {path}')
        self.context = self.engine.create_execution_context()
        self.output_shape = tuple(self.engine.get_tensor_shape('output'))[1:]
        # TensorRT synchronises around the default stream on every call, so it gets its own.
        self.stream = torch.cuda.Stream(device)

    def __call__(self, tiles: torch.Tensor) -> torch.Tensor:
        tiles = tiles.float().contiguous()
        output = torch.empty((len(tiles), *self.output_shape), device=self.device, dtype=torch.float32)
        if not self.context.set_input_shape('images', tuple(tiles.shape)):
            raise RuntimeError(f'TensorRT engine does not accept input shape {tuple(tiles.shape)}')
        self.context.set_tensor_address('images', tiles.data_ptr())
        self.context.set_tensor_address('output', output.data_ptr())
        caller = torch.cuda.current_stream(self.device)
        self.stream.wait_stream(caller)
        if not self.context.execute_async_v3(self.stream.cuda_stream):
            raise RuntimeError('TensorRT inference failed')
        caller.wait_stream(self.stream)
        tiles.record_stream(self.stream)
        output.record_stream(self.stream)
        return output
