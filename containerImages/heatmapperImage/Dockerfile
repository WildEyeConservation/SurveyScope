# Unified elephant heatmap + point-finder worker (GPU).
#
# tf.compat.v1 preserves compatibility with the TF1 MobileNet checkpoint.
FROM tensorflow/tensorflow:2.17.0-gpu

WORKDIR /workspace
COPY code/ /workspace/
RUN pip install --no-cache-dir -r requirements.txt

# Model checkpoint baked in (gitignored locally). tf.train.latest_checkpoint
# reads the `checkpoint` pointer, which references /models/batched_ss30_bs10_bg4_0/...
COPY models/ /models/

ENV PYTHONUNBUFFERED=1
CMD ["python3", "-u", "processSQS.py"]
