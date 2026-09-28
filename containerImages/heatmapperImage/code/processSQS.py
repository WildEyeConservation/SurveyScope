"""Unified elephant heatmap + point-finder SQS worker (GPU).

Replaces the old two-stage pipeline (Heatmapper4 EC2 AMI that wrote .h5 heatmaps to
S3, then a separate CPU point-finder container). Here a single GPU container:

  1. downloads the source image,
  2. (optionally) rotates it before inference - for images whose true orientation is
     missing from EXIF - gated on a `landscape` dimension check,
  3. generates the MobileNet heatmap (TF1 checkpoint, channel 1 = elephant),
  4. runs the point finder on the heatmap IN-PROCESS (the heatmap is never stored),
  5. maps detected points back into the stored/display frame, and
  6. posts the resulting Locations to AppSync (source 'heatmap').

Message body (JSON):
  imageId, projectId, setId, bucket, key            (required)
  group                Location.group (organizationId)(optional; resolved from the project)
  width, height        block size / Location box     (optional; env defaults)
  threshold            heatmap threshold             (optional; env default)
  rotation             CCW degrees 90/180/270        (optional)
  landscape            orientation guard for rotation(optional)
"""

import json
import os
import queue
import threading

import boto3
import numpy as np
import requests
from botocore.exceptions import ClientError
from PIL import Image
from requests_aws4auth import AWS4Auth
from tempfile import NamedTemporaryFile

from mobilenet_heatmapper import MobileNetHeatmapper
from point_finder import MultiTypeBlockPointFinder

REGION = os.environ['REGION']
QUEUE_URL = os.environ['QUEUE_URL']
API_ENDPOINT = os.environ['API_ENDPOINT']
MODEL_DIR = os.environ.get('ELEPHANT_MODEL_DIR', '/models/batched_ss30_bs10_bg4_0')
# Point-finder defaults (match the values the legacy runPointFinder used). The
# projector maps heatmap cells back to image pixels at the MobileNet stride.
DEFAULT_BLOCK_WIDTH = int(os.environ.get('ELEPHANT_BLOCK_WIDTH', '1024'))
DEFAULT_BLOCK_HEIGHT = int(os.environ.get('ELEPHANT_BLOCK_HEIGHT', '1024'))
DEFAULT_THRESHOLD = float(os.environ.get('ELEPHANT_THRESHOLD', '0.95'))
HM_STRIDE = float(os.environ.get('ELEPHANT_HM_STRIDE', '32.0'))
HM_OFFSET = float(os.environ.get('ELEPHANT_HM_OFFSET', '0.0'))
SOURCE = 'heatmap'

# Pipeline concurrency: download (ahead) and post (behind) run on their own threads
# so the GPU thread only ever does back-to-back inference. The infer queue is kept
# shallow because decoded full-res images are large (~hundreds of MB each).
DOWNLOAD_THREADS = int(os.environ.get('ELEPHANT_DOWNLOAD_THREADS', '2'))
POST_THREADS = int(os.environ.get('ELEPHANT_POST_THREADS', '3'))
INFER_QUEUE_MAX = int(os.environ.get('ELEPHANT_PREFETCH', '2'))
POST_QUEUE_MAX = int(os.environ.get('ELEPHANT_POST_QUEUE', '16'))

sqs = boto3.client('sqs', REGION)
s3 = boto3.client('s3', REGION)

# Refreshable signing creds: ECS task-role credentials rotate every few hours, so
# pass the live botocore credentials object (not a frozen snapshot) to AWS4Auth.
_auth = AWS4Auth(
    region=REGION,
    service='appsync',
    refreshable_credentials=boto3.Session().get_credentials(),
)

CREATE_LOCATION = """
mutation CreateLocation($confidence: Float, $height: Int, $imageId: ID!, $projectId: ID="", $setId: ID!, $source: String!, $width: Int, $x: Int!, $y: Int!, $group: String!) {
  createLocation(input: {confidence: $confidence, height: $height, imageId: $imageId, projectId: $projectId, setId: $setId, source: $source, x: $x, y: $y, width: $width, group: $group}) {
    id
    group
  }
}
"""

GET_PROJECT_ORGANIZATION = """
query GetProjectOrganization($id: ID!) {
  getProject(id: $id) { organizationId }
}
"""

heatmapper = None
# Location auth is groupDefinedIn('group'): a Location without the project's
# organizationId as its group is invisible to every annotator. runElephantDetector
# sends the group in the message; messages queued before it did are resolved here.
_organization_ids = {}


# ── optional rotation support (mirrors the scoutbot / stormfly workers) ──────────
_ROTATE_K = {90: 1, 180: 2, 270: 3}  # np.rot90 is counter-clockwise


def _normalize_rotation(value):
    if value is None:
        return 0
    try:
        rotation = int(value) % 360
    except (TypeError, ValueError):
        print(f'Ignoring invalid rotation value: {value!r}', flush=True)
        return 0
    if rotation not in _ROTATE_K:
        if rotation != 0:
            print(f'Ignoring unsupported rotation {value!r} (expected 0/90/180/270 CCW)', flush=True)
        return 0
    return rotation


def _normalize_landscape(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ('true', '1', 'yes'):
            return True
        if lowered in ('false', '0', 'no'):
            return False
    print(f'Ignoring invalid landscape value: {value!r}', flush=True)
    return None


def _orientation_qualifies(width, height, landscape):
    """landscape=True requires width>height; False requires height>width; None: always."""
    if landscape is None:
        return True
    if landscape:
        return width > height
    return height > width


def _map_point_to_original(x, y, rotation, orig_width, orig_height):
    """Map a point (rotated frame) back to the original pre-rotation frame.
    `rotation` is the CCW degrees applied to the image before inference."""
    if rotation == 90:
        return orig_width - y, x
    if rotation == 180:
        return orig_width - x, orig_height - y
    if rotation == 270:
        return y, orig_height - x
    return x, y


def _load_image_array(path, rotation, landscape):
    """Decode the image (RGB) and optionally rotate it for inference.

    Returns (image_array, rotation_applied, orig_width, orig_height). orig_* are the
    pre-rotation dimensions used to map detections back. PIL.Image.open does not apply
    EXIF orientation - matching the original heatmap worker - which is correct here
    because the target images carry no EXIF rotation."""
    # np.array (not asarray) so the buffer is owned and independent of the PIL image
    # and the temp file, both of which are gone by the time the GPU thread reads it.
    with Image.open(path) as img:
        arr = np.array(img.convert('RGB'))
    orig_height, orig_width = arr.shape[:2]
    if not rotation:
        return arr, 0, orig_width, orig_height
    if not _orientation_qualifies(orig_width, orig_height, landscape):
        print(
            f'Skipping {rotation}-degree rotation: {orig_width}x{orig_height} '
            f'does not satisfy landscape={landscape}',
            flush=True,
        )
        return arr, 0, orig_width, orig_height
    # ascontiguousarray: rot90 returns a view; make a contiguous owned copy to feed TF.
    arr = np.ascontiguousarray(np.rot90(arr, _ROTATE_K[rotation]))
    return arr, rotation, orig_width, orig_height


def _post_graphql(query, variables, label):
    response = requests.post(
        API_ENDPOINT,
        json={'query': query, 'variables': variables},
        auth=_auth,
        headers={'Accept': 'application/json', 'Content-Type': 'application/json'},
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get('errors'):
        raise RuntimeError(f'{label} errors: {payload["errors"]}')
    return payload


def _location_group(body):
    if body.get('group'):
        return body['group']
    project_id = body['projectId']
    if project_id not in _organization_ids:
        payload = _post_graphql(GET_PROJECT_ORGANIZATION, {'id': project_id}, 'getProject')
        project = (payload.get('data') or {}).get('getProject') or {}
        if not project.get('organizationId'):
            raise RuntimeError(f'No organizationId found for project {project_id}')
        _organization_ids[project_id] = project['organizationId']
    return _organization_ids[project_id]


def _write_location(body, x, y, confidence, width, height, group):
    _post_graphql(CREATE_LOCATION, {
        'height': int(round(height)),
        'imageId': body['imageId'],
        'projectId': body['projectId'],
        'x': int(round(x)),
        'y': int(round(y)),
        'width': int(round(width)),
        'setId': body['setId'],
        'confidence': float(confidence),
        'source': SOURCE,
        'group': group,
    }, 'createLocation')


def _get_detector():
    global heatmapper
    if heatmapper is None:
        print(f'Loading Heatmapper model from {MODEL_DIR}', flush=True)
        import tensorflow as tf
        heatmapper = MobileNetHeatmapper(tf.train.latest_checkpoint(MODEL_DIR))
        print('Done loading Heatmapper model', flush=True)
    return heatmapper


def _release(message):
    """Reset visibility to 0 so a failed message retries promptly (DLQ after 3)."""
    try:
        sqs.change_message_visibility(
            QueueUrl=QUEUE_URL,
            ReceiptHandle=message['ReceiptHandle'],
            VisibilityTimeout=0,
        )
    except ClientError as error:
        print(f'Failed to reset visibility: {error}', flush=True)


# ── pipeline stages ──────────────────────────────────────────────────────────────
# downloader(s) -> infer_queue -> single GPU inferer -> post_queue -> poster(s)
# The GPU thread does only generate() + (cheap) point-finding back-to-back; S3
# downloads of upcoming images and the per-detection HTTP posts of finished images
# run concurrently on their own threads, so the GPU no longer idles during I/O.

def _downloader(infer_queue):
    while True:
        try:
            response = sqs.receive_message(
                QueueUrl=QUEUE_URL,
                AttributeNames=['SentTimestamp'],
                MaxNumberOfMessages=1,
                MessageAttributeNames=['All'],
                VisibilityTimeout=1800,
                WaitTimeSeconds=10,
            )
        except ClientError as error:
            print(f'receive_message failed: {error}', flush=True)
            continue
        for message in response.get('Messages', []):
            try:
                body = json.loads(message['Body'])
                rotation = _normalize_rotation(body.get('rotation'))
                landscape = (
                    _normalize_landscape(body.get('landscape')) if rotation else None
                )
                key = body['key']
                suffix = os.path.splitext(key)[1] or '.jpg'
                with NamedTemporaryFile(suffix=suffix) as tmp:
                    s3.download_file(body['bucket'], key, tmp.name)
                    image, applied, orig_w, orig_h = _load_image_array(
                        tmp.name, rotation, landscape
                    )
                # Blocks when the infer queue is full -> natural backpressure that
                # caps how many large decoded images are held in memory at once.
                infer_queue.put(
                    {
                        'message': message,
                        'body': body,
                        'image': image,
                        'applied': applied,
                        'orig_w': orig_w,
                        'orig_h': orig_h,
                    }
                )
            except Exception as error:
                print(f'Error preparing message: {error}', flush=True)
                _release(message)


def _inferer(infer_queue, post_queue):
    model = _get_detector()  # load the TF graph once, in the thread that uses it
    while True:
        task = infer_queue.get()
        message = task['message']
        try:
            body = task['body']
            block_width = int(body.get('width', DEFAULT_BLOCK_WIDTH))
            block_height = int(body.get('height', DEFAULT_BLOCK_HEIGHT))
            threshold = float(body.get('threshold', DEFAULT_THRESHOLD))

            heatmap = model.generate(task['image'])
            finder = MultiTypeBlockPointFinder(
                smoothing_flag=True,
                block_width=block_width,
                block_height=block_height,
                threshold=threshold,
            )
            detections = finder.detect(heatmap)

            points = []
            for det in detections:
                vis_x = det['x'] * HM_STRIDE + HM_OFFSET
                vis_y = det['y'] * HM_STRIDE + HM_OFFSET
                if task['applied']:
                    vis_x, vis_y = _map_point_to_original(
                        vis_x, vis_y, task['applied'], task['orig_w'], task['orig_h']
                    )
                points.append((vis_x, vis_y, det['features']['hm_block_max']))

            post_queue.put(
                {
                    'message': message,
                    'body': body,
                    'points': points,
                    'block_width': block_width,
                    'block_height': block_height,
                }
            )
        except Exception as error:
            print(f'Error during inference: {error}', flush=True)
            _release(message)


def _poster(post_queue):
    while True:
        result = post_queue.get()
        message = result['message']
        try:
            body = result['body']
            points = result['points']
            group = _location_group(body)
            if not points:
                _write_location(body, 0, 0, 0.0, 0, 0, group)
            else:
                for vis_x, vis_y, confidence in points:
                    _write_location(
                        body,
                        vis_x,
                        vis_y,
                        confidence,
                        result['block_width'],
                        result['block_height'],
                        group,
                    )
            sqs.delete_message(
                QueueUrl=QUEUE_URL, ReceiptHandle=message['ReceiptHandle']
            )
        except Exception as error:
            print(f'Error posting/deleting: {error}', flush=True)
            _release(message)


def main():
    # Fail fast if CUDA is unavailable, so ECS replaces the task rather than the
    # worker silently running heatmap inference on CPU.
    import tensorflow as tf
    if not tf.test.is_gpu_available():
        print('No GPU available to TensorFlow. Exiting.', flush=True)
        raise SystemExit(1)

    # Preload the model here (not lazily in the daemon inferer thread) so a load
    # failure surfaces in the main thread and ECS replaces the task. The TF session
    # is thread-safe; the inferer thread reuses this same loaded instance.
    _get_detector()

    infer_queue = queue.Queue(maxsize=INFER_QUEUE_MAX)
    post_queue = queue.Queue(maxsize=POST_QUEUE_MAX)

    threads = [threading.Thread(target=_inferer, args=(infer_queue, post_queue), daemon=True)]
    for _ in range(DOWNLOAD_THREADS):
        threads.append(threading.Thread(target=_downloader, args=(infer_queue,), daemon=True))
    for _ in range(POST_THREADS):
        threads.append(threading.Thread(target=_poster, args=(post_queue,), daemon=True))

    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()


if __name__ == '__main__':
    main()
