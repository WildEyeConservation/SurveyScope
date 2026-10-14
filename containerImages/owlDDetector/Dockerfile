FROM nvidia/cuda:12.8.1-cudnn-devel-ubuntu24.04

ENV PIP_ROOT_USER_ACTION=ignore \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/workspace:/workspace/dinov3:/worker

RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      gcc \
      git \
      libgl1 \
      libglib2.0-0 \
      libgomp1 \
      python3 \
      python3-dev \
      python3-pip \
 && rm -rf /var/cache/apt \
 && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --break-system-packages --ignore-installed pip setuptools wheel

RUN python3 -m pip install --break-system-packages \
      torch==2.7.0 torchvision==0.22.0 \
      --index-url https://download.pytorch.org/whl/cu128

RUN python3 -m pip install --break-system-packages \
      albumentations \
      boto3 \
      'gql[all]' \
      ftfy \
      huggingface-hub \
      hydra-core \
      iopath \
      matplotlib \
      numpy \
      omegaconf \
      opencv-python-headless \
      pandas \
      pillow \
      pyyaml \
      regex \
      requests \
      requests_aws4auth \
      scikit-image \
      scikit-learn \
      scipy \
      submitit \
      termcolor \
      torchmetrics \
      tqdm \
      wandb

RUN git clone https://github.com/microsoft/MegaDetector-Overhead /workspace \
 && cd /workspace \
 && git checkout 7e5e4b9ca79027f071790d7f62978672bee656b0

RUN python3 -m pip install --break-system-packages --no-deps -e /workspace/dinov3 \
 && python3 -m pip install --break-system-packages --no-deps -e /workspace

WORKDIR /worker
COPY code /worker

CMD ["python3", "-u", "processSQS.py"]