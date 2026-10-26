FROM nvidia/cuda:12.9.1-cudnn-devel-ubuntu24.04

# System dependencies
RUN set -ex \
 && apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        python3 \
        python3-venv \
        python3-dev \
        libgl1 \
        libglib2.0-0t64 \
        build-essential \
        gfortran \
 && rm -rf /var/lib/apt/lists/*

# Ubuntu 24.04's system Python is externally managed, so install into a venv.
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /workspace

# Copy worker code and (optionally) vendored MAD repo files
COPY code /workspace

# Preinstall PyTorch CUDA 12.9 wheels
RUN pip3 install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cu129 \
    torch==2.13.0+cu129 torchvision==0.28.0+cu129

# Python deps (rest)
RUN pip3 install --no-cache-dir -r requirements.txt

ENV PYTHONUNBUFFERED=1
CMD ["python3", "-u", "processSQS.py"]


