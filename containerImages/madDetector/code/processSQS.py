import os
import json
import time
from tempfile import NamedTemporaryFile

import boto3
from botocore.exceptions import ClientError
from requests_aws4auth import AWS4Auth
from gql import gql
from gql.client import Client
from gql.transport.requests import RequestsHTTPTransport

# MAD repo imports (vendored under code/mad_repo)
import sys
from pathlib import Path

MAD_REPO_PATH = Path(__file__).parent / 'mad_repo'
if MAD_REPO_PATH.exists():
    sys.path.insert(0, str(MAD_REPO_PATH))

from mad_dataset_utils import CLASSES  # noqa: E402
from models import build_model  # noqa: E402
import torch  # noqa: E402
import torchvision.transforms as T  # noqa: E402
from torchvision.ops import nms  # noqa: E402
from PIL import Image  # noqa: E402

Image.MAX_IMAGE_PIXELS = None

MODEL_IIS = 800

def box_cxcywh_to_xyxy(x):
    x_c, y_c, w, h = x.unbind(1)
    b = [(x_c - 0.5 * w), (y_c - 0.5 * h), (x_c + 0.5 * w), (y_c + 0.5 * h)]
    return torch.stack(b, dim=1)

def rescale_bboxes(out_bbox, size, device):
    img_w, img_h = size
    b = box_cxcywh_to_xyxy(out_bbox)
    b = b * torch.tensor([img_w, img_h, img_w, img_h], dtype=torch.float32).to(device)
    return b

# Env
REGION = os.environ['REGION']
QUEUE_URL = os.environ['QUEUE_URL']
API_ENDPOINT = os.environ['API_ENDPOINT']
CHECKPOINT_S3_URI = os.environ.get('MAD_CHECKPOINT_S3', '')  # s3://bucket/key

sqs = boto3.client('sqs', REGION)
s3 = boto3.client('s3', REGION)
# Keep credentials refreshable: ECS task-role credentials rotate every few hours,
# so pass the live botocore credentials object (not a frozen snapshot) to AWS4Auth.
# A frozen snapshot expires mid-run and every AppSync write fails with
# ExpiredTokenException until the container restarts.
auth = AWS4Auth(
    region=REGION,
    service='appsync',
    refreshable_credentials=boto3.Session().get_credentials(),
)
transport = RequestsHTTPTransport(url=API_ENDPOINT, headers={'Accept': 'application/json', 'Content-Type': 'application/json'}, auth=auth)
client = Client(transport=transport, fetch_schema_from_transport=False)

createLocation = gql("""
mutation CreateLocation($confidence: Float, $height: Int, $imageId: ID!, $projectId: ID="", $setId: ID!, $source: String!, $width: Int, $x: Int!, $y: Int!, $group: String!) {
  createLocation(input: {confidence: $confidence, height: $height, imageId: $imageId, projectId: $projectId, setId: $setId, source: $source, x: $x, y: $y, width: $width, group: $group}) {
    id
    group
  }
}
""")

getProjectOrganization = gql("""
query GetProjectOrganization($id: ID!) {
  getProject(id: $id) { organizationId }
}
""")

# organizationId per project, for messages sent without 'group'.
_organization_ids = {}

def _location_group(body: dict) -> str:
    if body.get('group'):
        return body['group']
    project_id = body['projectId']
    if project_id not in _organization_ids:
        resp = client.execute(getProjectOrganization, variable_values={'id': project_id})
        organization_id = (resp.get('getProject') or {}).get('organizationId')
        if not organization_id:
            raise ValueError(f'No organizationId found for project {project_id}')
        _organization_ids[project_id] = organization_id
    return _organization_ids[project_id]

_model = None
_device = None

def _download_checkpoint_if_needed(local_path: Path):
    if local_path.exists():
        return
    if not CHECKPOINT_S3_URI.startswith('s3://'):
        raise RuntimeError('MAD_CHECKPOINT_S3 env var must be set to s3://bucket/key')
    _, s3_path = CHECKPOINT_S3_URI.split('s3://', 1)
    bucket, key = s3_path.split('/', 1)
    local_path.parent.mkdir(parents=True, exist_ok=True)
    s3.download_file(bucket, key, str(local_path))

def _load_model():
    global _model, _device
    if _model is not None:
        return _model

    _device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    class Args:
        # Defaults aligned with script
        num_classes = len(CLASSES) - 1
        dataset_file = ''
        lr_backbone = 0.0
        backbone = 'resnet50'
        dilation = False
        position_embedding = 'sine'
        enc_layers = 6
        dec_layers = 6
        dim_feedforward = 2048
        hidden_dim = 256
        dropout = 0.1
        nheads = 8
        num_queries = 100
        pre_norm = False
        masks = False
        no_aux_loss = True
        # The MAD repo expects `aux_loss`; keep aux disabled for inference
        aux_loss = False
        mask_loss_coef = 1.0
        dice_loss_coef = 1.0
        bbox_loss_coef = 5.0
        giou_loss_coef = 2.0
        # Matcher and criterion settings required by build()
        set_cost_class = 1.0
        set_cost_bbox = 5.0
        set_cost_giou = 2.0
        eos_coef = 0.1
        # Used when masks are enabled; keep None here
        frozen_weights = None
        device = 'cuda' if torch.cuda.is_available() else 'cpu'

    args = Args()
    model, _, _ = build_model(args)

    ckpt_path = Path('/workspace/model_cache/checkpoint.pth')
    _download_checkpoint_if_needed(ckpt_path)
    checkpoint = torch.load(str(ckpt_path), map_location='cpu', weights_only=False)
    model.load_state_dict(checkpoint['model'], strict=False)
    model.eval()
    model.to(_device)
    return model

def _run_mad_on_image(pil_image: Image.Image, min_score_thresh: float = 0.7, iou_threshold: float = 0.5, overlap: float = 0.33, window_batch_size: int = 16):
    model = _load_model()
    device = _device

    w, h = pil_image.size
    bottom_pad = max(0, MODEL_IIS - h)
    right_pad = max(0, MODEL_IIS - w)
    if bottom_pad > 0 or right_pad > 0:
        # simple padding
        padded = Image.new(pil_image.mode, (w + right_pad, h + bottom_pad))
        padded.paste(pil_image, (0, 0))
        pil_image = padded

    t_image = T.ToTensor()(pil_image)  # CxHxW

    # sliding window batching
    r_max, c_max = t_image.shape[1:]
    shift = int(MODEL_IIS * (1 - overlap))
    windows = []
    coords = []
    r = 0
    c = 0
    while True:
        if r + MODEL_IIS <= r_max and c + MODEL_IIS <= c_max:
            sw = t_image[:, r:r+MODEL_IIS, c:c+MODEL_IIS]
        else:
            sw = torch.zeros((3, MODEL_IIS, MODEL_IIS), dtype=t_image.dtype)
            n_r = min(r_max - r, MODEL_IIS)
            n_c = min(c_max - c, MODEL_IIS)
            sw[:, :n_r, :n_c] = t_image[:, r:r+n_r, c:c+n_c]

        windows.append(sw)
        coords.append((r, c))

        if c + MODEL_IIS >= c_max:
            if r_max <= r + MODEL_IIS:
                break
            r += shift
            c = 0
        else:
            c += shift

    assert windows, 'No windows generated'

    gBoxes = []
    gProbas = []
    gClassIdx = []

    for batch_start in range(0, len(windows), window_batch_size):
        batch_end = min(batch_start + window_batch_size, len(windows))
        batch = torch.stack(windows[batch_start:batch_end], dim=0).to(device)
        outputs = model(batch)
        for i in range(batch_start, batch_end):
            local_i = i - batch_start
            probas = outputs['pred_logits'].softmax(-1)[local_i, :, :-1]
            probas_m, class_indices = torch.max(probas, dim=-1)
            keep = probas_m > min_score_thresh
            if keep.any():
                bboxes_scaled = rescale_bboxes(outputs['pred_boxes'][local_i, keep], (MODEL_IIS, MODEL_IIS), device)
                x1, y1, x2, y2 = bboxes_scaled.unbind(1)
                R, C = coords[i]
                gBoxes.append(torch.stack([x1 + C, y1 + R, x2 + C, y2 + R], dim=1))
                gProbas.append(probas_m[keep])
                gClassIdx.extend(class_indices[keep].tolist())

        del batch
        torch.cuda.empty_cache()

    detections = []
    if gBoxes:
        gBoxes = torch.cat(gBoxes, dim=0)
        gProbas = torch.cat(gProbas, dim=0)
        keep_idx = nms(gBoxes, gProbas, iou_threshold=iou_threshold)
        for si in keep_idx.tolist():
            x1, y1, x2, y2 = gBoxes[si].tolist()
            w = x2 - x1
            h = y2 - y1
            detections.append({
                'x': x1 + w / 2,
                'y': y1 + h / 2,
                'w': w,
                'h': h,
                'c': float(gProbas[si].item()),
                'cls': gClassIdx[si]
            })
    return detections

def handle_message(body: dict):
    # Expected body: {'bucket': str, 'setId': str, 'projectId': str, 'group'?: str, 'images': [{ 'imageId': str, 'key': str }]}
    group = _location_group(body)
    for image in body['images']:
        key = image['key']
        with NamedTemporaryFile(suffix=os.path.splitext(key)[1]) as tmp:
            s3.download_file(body['bucket'], key, tmp.name)
            pil = Image.open(tmp.name).convert('RGB')
            detects = _run_mad_on_image(pil)
        if not detects:
            client.execute(createLocation, variable_values=json.dumps({
                'height': 0,
                'imageId': image['imageId'],
                'projectId': body['projectId'],
                'x': 0,
                'y': 0,
                'width': 0,
                'setId': body['setId'],
                'confidence': 0.0,
                'source': 'mad-v2',
                'group': group
            }))
        else:
            for d in detects:
                client.execute(createLocation, variable_values=json.dumps({
                    'height': round(d['h']),
                    'imageId': image['imageId'],
                    'projectId': body['projectId'],
                    'x': round(d['x']),
                    'y': round(d['y']),
                    'width': round(d['w']),
                    'setId': body['setId'],
                    'confidence': d['c'],
                    'source': 'mad-v2',
                    'group': group
                }))

def main():
    while True:
        resp = sqs.receive_message(
            QueueUrl=QUEUE_URL,
            AttributeNames=['SentTimestamp'],
            MaxNumberOfMessages=1,
            MessageAttributeNames=['All'],
            VisibilityTimeout=600,
            WaitTimeSeconds=10
        )
        if 'Messages' not in resp:
            time.sleep(10)
            continue
        for msg in resp['Messages']:
            receipt = msg['ReceiptHandle']
            body = json.loads(msg['Body'])
            try:
                handle_message(body)
                sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=receipt)
            except Exception as e:
                print(f"Error processing message: {e}")
                # Reset visibility to 0 so a failed message retries / reaches the DLQ
                # promptly instead of squatting in flight for the full timeout.
                try:
                    sqs.change_message_visibility(
                        QueueUrl=QUEUE_URL,
                        ReceiptHandle=receipt,
                        VisibilityTimeout=0,
                    )
                except ClientError as visibility_error:
                    print(f"Failed to reset message visibility: {visibility_error}")

if __name__ == '__main__':
    main()


