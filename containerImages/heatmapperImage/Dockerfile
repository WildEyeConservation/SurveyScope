# Unified elephant heatmap + point-finder worker (GPU).
#
# TensorFlow 1.14 (CUDA 10, Python 3.6) - the exact environment the model checkpoint
# was trained/served in on the Heatmapper4 AMI. We deliberately keep TF1 rather than
# porting to TF2/ONNX so the checkpoint loads unchanged. Modern GPU-host NVIDIA drivers
# run CUDA 10 containers via forward compatibility.
FROM tensorflow/tensorflow:1.14.0-gpu-py3

WORKDIR /workspace
COPY code/ /workspace/
RUN pip install --no-cache-dir -r requirements.txt

# Model checkpoint baked in (gitignored locally). tf.train.latest_checkpoint
# reads the `checkpoint` pointer, which references /models/batched_ss30_bs10_bg4_0/...
COPY models/ /models/

ENV PYTHONUNBUFFERED=1
CMD ["python3", "-u", "processSQS.py"]
