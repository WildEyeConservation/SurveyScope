"""OWL-D SQS worker for Detweb."""

import hashlib
import json
import os
import sys
import time
from pathlib import Path
from tempfile import NamedTemporaryFile

import boto3
from botocore.exceptions import ClientError
from gql import gql
from gql.client import Client
from gql.transport.requests import RequestsHTTPTransport
from PIL import Image, ImageOps
from requests_aws4auth import AWS4Auth

from owl_detector import OwlDDetector

REGION = os.environ['REGION']
QUEUE_URL = os.environ['QUEUE_URL']
API_ENDPOINT = os.environ['API_ENDPOINT']
MODEL_S3_URI = os.environ.get('OWL_MODEL_S3', '')
MODEL_PATH = Path(os.environ.get('OWL_MODEL_PATH', '/workspace/model_cache/OWL-D.pth'))
MODEL_SHA256 = os.environ.get('OWL_MODEL_SHA256', '').strip().lower()
THRESHOLD = float(os.environ.get('OWL_THRESHOLD', '0.05'))
BOX_SIZE = int(os.environ.get('OWL_BOX_SIZE', '64'))
SOURCE = 'owl-d'
LOCATION_BATCH = int(os.environ.get('OWL_LOCATION_BATCH', '25'))
MESSAGE_VISIBILITY_SECONDS = int(os.environ.get('OWL_MESSAGE_VISIBILITY_SECONDS', '3600'))

sqs = boto3.client('sqs', region_name=REGION)
s3 = boto3.client('s3', region_name=REGION)

auth = AWS4Auth(
    region=REGION,
    service='appsync',
    refreshable_credentials=boto3.Session().get_credentials(),
)
client = Client(
    transport=RequestsHTTPTransport(
        url=API_ENDPOINT,
        headers={'Accept': 'application/json', 'Content-Type': 'application/json'},
        auth=auth,
    ),
    fetch_schema_from_transport=False,
)

locations_by_image = gql("""
query LocationsByImageKey($imageId: ID!, $source: String!, $setId: ID!, $limit: Int, $nextToken: String) {
  locationsByImageKey(
    imageId: $imageId
    filter: { source: { eq: $source }, setId: { eq: $setId } }
    limit: $limit
    nextToken: $nextToken
  ) {
    items { id }
    nextToken
  }
}
""")

delete_location = gql("""
mutation DeleteLocation($id: ID!) {
  deleteLocation(input: { id: $id }) { id }
}
""")

delete_image_processed_by = gql("""
mutation DeleteImageProcessedBy($imageId: ID!, $source: String!) {
  deleteImageProcessedBy(input: { imageId: $imageId, source: $source }) {
    imageId
    source
  }
}
""")

get_project_organization = gql("""
query GetProjectOrganization($id: ID!) {
  getProject(id: $id) { organizationId }
}
""")

_detector = None
# organizationId per project, for messages sent without 'group'.
_organization_ids = {}


def _error_summary(error):
    return f'{type(error).__name__}: {error}'


def _download_s3_object(bucket, key, destination, object_label):
    try:
        s3.download_file(bucket, key, str(destination))
    except ClientError as error:
        code = error.response.get('Error', {}).get('Code', 'unknown')
        raise RuntimeError(
            f'Failed to download {object_label} from s3://{bucket}/{key} '
            f'(S3 error {code})'
        ) from error


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _verify_model_hash(path):
    if not MODEL_SHA256:
        return
    actual = _sha256(path).lower()
    if actual != MODEL_SHA256:
        raise RuntimeError(
            f'OWL-D checkpoint SHA256 mismatch for {path}: expected '
            f'{MODEL_SHA256}, got {actual}'
        )


def _download_model():
    if MODEL_PATH.exists():
        _verify_model_hash(MODEL_PATH)
        return MODEL_PATH
    if not MODEL_S3_URI.startswith('s3://'):
        raise RuntimeError('OWL_MODEL_S3 must be set to a private s3://bucket/key')
    bucket_and_key = MODEL_S3_URI[5:]
    bucket, key = bucket_and_key.split('/', 1)
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    temp_path = MODEL_PATH.with_suffix(MODEL_PATH.suffix + '.tmp')
    if temp_path.exists():
        temp_path.unlink()
    print(f'Downloading OWL-D checkpoint from s3://{bucket}/{key}', flush=True)
    _download_s3_object(bucket, key, temp_path, 'OWL-D checkpoint')
    _verify_model_hash(temp_path)
    temp_path.replace(MODEL_PATH)
    return MODEL_PATH


def _get_detector():
    global _detector
    if _detector is None:
        _detector = OwlDDetector(str(_download_model()), threshold=THRESHOLD)
    return _detector


def _execute(document, variables):
    return client.execute(document, variable_values=variables)


def _location_group(body):
    if body.get('group'):
        return body['group']
    project_id = body['projectId']
    if project_id not in _organization_ids:
        response = _execute(get_project_organization, {'id': project_id})
        organization_id = (response.get('getProject') or {}).get('organizationId')
        if not organization_id:
            raise RuntimeError(f'No organizationId found for project {project_id}')
        _organization_ids[project_id] = organization_id
    return _organization_ids[project_id]


def _delete_processed_marker(image_id):
    try:
        _execute(delete_image_processed_by, {'imageId': image_id, 'source': SOURCE})
    except Exception as error:
        print(
            f'Could not delete ImageProcessedBy marker for {image_id}/{SOURCE}; '
            f'continuing. Error: {_error_summary(error)}',
            flush=True,
        )


def _delete_existing_locations(body, image_id):
    deleted = 0
    next_token = None
    while True:
        response = _execute(
            locations_by_image,
            {
                'imageId': image_id,
                'source': SOURCE,
                'setId': body['setId'],
                'limit': 100,
                'nextToken': next_token,
            },
        )
        page = response.get('locationsByImageKey') or {}
        for item in page.get('items') or []:
            if not item or not item.get('id'):
                continue
            _execute(delete_location, {'id': item['id']})
            deleted += 1
        next_token = page.get('nextToken')
        if not next_token:
            break
    if deleted:
        print(f'Deleted {deleted} stale OWL-D locations for image {image_id}', flush=True)


def _location_id(body, image_id, point_index):
    identity = json.dumps(
        [body['projectId'], body['setId'], image_id, SOURCE, int(point_index)],
        separators=(',', ':'),
    )
    return f'{SOURCE}-{hashlib.sha256(identity.encode("utf-8")).hexdigest()[:32]}'


def _is_duplicate_create_error(error):
    graphql_errors = getattr(error, 'errors', None)
    descriptions = graphql_errors if graphql_errors else [str(error)]
    duplicate_markers = (
        'conditionalcheckfailedexception',
        'the conditional request failed',
        'already exists',
    )
    return bool(descriptions) and all(
        any(marker in str(description).lower() for marker in duplicate_markers)
        for description in descriptions
    )


def _write_locations(body, image_id, points, size, group):
    for start in range(0, len(points), LOCATION_BATCH):
        chunk = points[start:start + LOCATION_BATCH]
        var_defs = ['$imageId: ID!', '$projectId: ID!', '$setId: ID!', '$source: String!', '$size: Int', '$group: String!']
        fields = []
        variables = {
            'imageId': image_id,
            'projectId': body['projectId'],
            'setId': body['setId'],
            'source': SOURCE,
            'size': int(size),
            'group': group,
        }
        for index, (x, y, confidence) in enumerate(chunk):
            point_index = start + index
            var_defs += [f'$id{index}: ID!', f'$x{index}: Int!', f'$y{index}: Int!', f'$c{index}: Float']
            fields.append(
                f'p{index}: createLocation(input: {{id: $id{index}, imageId: $imageId, '
                f'projectId: $projectId, setId: $setId, source: $source, '
                f'width: $size, height: $size, x: $x{index}, y: $y{index}, '
                f'confidence: $c{index}, group: $group}}) {{ id group }}'
            )
            variables[f'id{index}'] = _location_id(body, image_id, point_index)
            variables[f'x{index}'] = int(round(x))
            variables[f'y{index}'] = int(round(y))
            variables[f'c{index}'] = float(confidence)
        document = gql(
            'mutation BatchCreateLocations('
            + ', '.join(var_defs)
            + ') { '
            + ' '.join(fields)
            + ' }'
        )
        try:
            _execute(document, variables)
        except Exception as error:
            if not _is_duplicate_create_error(error):
                raise


_TRANSPOSE = getattr(Image, 'Transpose', Image)
_ROTATE_TRANSPOSE = {
    90: _TRANSPOSE.ROTATE_90,
    180: _TRANSPOSE.ROTATE_180,
    270: _TRANSPOSE.ROTATE_270,
}


def _normalize_rotation(value):
    if value is None:
        return 0
    try:
        rotation = int(value) % 360
    except (TypeError, ValueError):
        print(f'Ignoring invalid rotation value: {value!r}', flush=True)
        return 0
    if rotation not in _ROTATE_TRANSPOSE:
        if rotation != 0:
            print(f'Ignoring unsupported rotation {value!r} (expected 0/90/180/270 CCW)', flush=True)
        return 0
    return rotation


def _get_rotation(body, image):
    if image.get('rotation') is not None:
        return _normalize_rotation(image.get('rotation'))
    return _normalize_rotation(body.get('rotation'))


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


def _get_landscape(body, image):
    if image.get('landscape') is not None:
        return _normalize_landscape(image.get('landscape'))
    return _normalize_landscape(body.get('landscape'))


def _orientation_qualifies(orig_width, orig_height, landscape):
    if landscape is None:
        return True
    if landscape:
        return orig_width > orig_height
    return orig_height > orig_width


def _maybe_rotate_image(pil_image, rotation, landscape):
    if not rotation:
        return pil_image, {'rotation': 0}
    orig_width, orig_height = pil_image.size
    if not _orientation_qualifies(orig_width, orig_height, landscape):
        print(
            f'Skipping {rotation}-degree rotation: {orig_width}x{orig_height} '
            f'does not satisfy landscape={landscape}',
            flush=True,
        )
        return pil_image, {'rotation': 0}
    rotated = pil_image.transpose(_ROTATE_TRANSPOSE[rotation])
    return rotated, {'rotation': rotation, 'origWidth': orig_width, 'origHeight': orig_height}


def _map_point_to_original(x, y, rotation_info):
    rotation = rotation_info.get('rotation', 0) if rotation_info else 0
    if not rotation:
        return x, y
    orig_width = rotation_info['origWidth']
    orig_height = rotation_info['origHeight']
    if rotation == 90:
        return orig_width - 1 - y, x
    if rotation == 180:
        return orig_width - 1 - x, orig_height - 1 - y
    if rotation == 270:
        return y, orig_height - 1 - x
    return x, y


def _message_images(body):
    if isinstance(body.get('images'), list):
        return body['images']
    return [{'imageId': body['imageId'], 'key': body['key']}]


def _receive_count(message):
    return message.get('Attributes', {}).get('ApproximateReceiveCount', 'unknown')


def handle_message(body, message):
    model = _get_detector()
    group = _location_group(body)
    for image in _message_images(body):
        image_id = image['imageId']
        key = image['key']
        suffix = os.path.splitext(key)[1] or '.jpg'
        attempt = _receive_count(message)
        download_start = time.time()
        with NamedTemporaryFile(suffix=suffix) as temp_file:
            _download_s3_object(
                body['bucket'],
                key,
                temp_file.name,
                f'survey image {image_id}',
            )
            download_seconds = time.time() - download_start
            rotation = _get_rotation(body, image)
            landscape = _get_landscape(body, image) if rotation else None
            with Image.open(temp_file.name) as pil_image:
                display_image = ImageOps.exif_transpose(pil_image).convert('RGB')
                inference_image, rotation_info = _maybe_rotate_image(
                    display_image, rotation, landscape
                )
                inference_start = time.time()
                detections = model.detect(inference_image)
                inference_seconds = time.time() - inference_start

        points = [
            (*_map_point_to_original(detection.x, detection.y, rotation_info), detection.score)
            for detection in detections
        ]
        write_start = time.time()
        _delete_processed_marker(image_id)
        _delete_existing_locations(body, image_id)
        if points:
            _write_locations(body, image_id, points, BOX_SIZE, group)
        else:
            _write_locations(body, image_id, [(0, 0, 0.0)], 0, group)
        write_seconds = time.time() - write_start
        print(
            f'OWL-D image {image_id} attempt {attempt}: '
            f'download={download_seconds:.2f}s inference={inference_seconds:.2f}s '
            f'write={write_seconds:.2f}s detections={len(points)}',
            flush=True,
        )


def _release(message):
    try:
        sqs.change_message_visibility(
            QueueUrl=QUEUE_URL,
            ReceiptHandle=message['ReceiptHandle'],
            VisibilityTimeout=0,
        )
    except ClientError as error:
        print(f'Failed to reset message visibility: {error}', flush=True)


def main():
    import torch

    if not torch.cuda.is_available():
        print('CUDA is not available. Exiting so ECS can replace this task.', flush=True)
        sys.exit(1)
    _get_detector()

    while True:
        response = sqs.receive_message(
            QueueUrl=QUEUE_URL,
            AttributeNames=['SentTimestamp', 'ApproximateReceiveCount'],
            MaxNumberOfMessages=1,
            MessageAttributeNames=['All'],
            VisibilityTimeout=MESSAGE_VISIBILITY_SECONDS,
            WaitTimeSeconds=10,
        )
        for message in response.get('Messages', []):
            try:
                handle_message(json.loads(message['Body']), message)
                sqs.delete_message(
                    QueueUrl=QUEUE_URL,
                    ReceiptHandle=message['ReceiptHandle'],
                )
            except Exception as error:
                print(f'Error processing OWL-D message: {_error_summary(error)}', flush=True)
                _release(message)
        if 'Messages' not in response:
            time.sleep(5)


if __name__ == '__main__':
    main()