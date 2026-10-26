# Unified elephant heatmap + point-finder worker (GPU).
#
# TensorFlow 2 (CUDA 12, Python 3.11). The TF1 MobileNet checkpoint loads unchanged:
# mobilenet_heatmapper.py rebuilds the original slim graph in tf.compat.v1 ops.
FROM tensorflow/tensorflow:2.21.0-gpu

WORKDIR /workspace
COPY code/ /workspace/
RUN pip install --no-cache-dir -r requirements.txt

# Model checkpoint baked in (gitignored locally). tf.train.latest_checkpoint
# reads the `checkpoint` pointer, which references /models/batched_ss30_bs10_bg4_0/...
COPY models/ /models/

ENV PYTHONUNBUFFERED=1
CMD ["python3", "-u", "processSQS.py"]
