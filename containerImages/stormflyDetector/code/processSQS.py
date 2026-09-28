"""Stormfly SQS worker; testing weights are excluded."""

import json
import os
import time
from pathlib import Path
from tempfile import NamedTemporaryFile

import boto3
from botocore.exceptions import ClientError
from gql import gql
from gql.client import Client
from gql.transport.requests import RequestsHTTPTransport
from PIL import Image
from requests_aws4auth import AWS4Auth

from stormfly_detector import StormflyDetector

REGION = os.environ['REGION']
QUEUE_URL = os.environ['QUEUE_URL']
API_ENDPOINT = os.environ['API_ENDPOINT']
MODEL_S3_URI = os.environ.get('STORMFLY_MODEL_S3', '')
THRESHOLD = float(os.environ.get('STORMFLY_THRESHOLD', '0.00'))
BOX_SIZE = int(os.environ.get('STORMFLY_BOX_SIZE', '64'))

sqs = boto3.client('sqs', region_name=REGION)
s3 = boto3.client('s3', region_name=REGION)
# Keep credentials refreshable for long-lived workers.
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

create_location = gql("""
mutation CreateLocation($confidence: Float, $height: Int, $imageId: ID!, $projectId: ID!, $setId: ID!, $source: String!, $width: Int, $x: Int!, $y: Int!, $group: String!) {
  createLocation(input: {confidence: $confidence, height: $height, imageId: $imageId, projectId: $projectId, setId: $setId, source: $source, x: $x, y: $y, width: $width, group: $group}) {
    id
    group
  }
}
""")

get_project_organization = gql("""
query GetProjectOrganization($id: ID!) {
  getProject(id: $id) { organizationId }
}
""")

detector = None
# organizationId per project, for messages sent without 'group'.
_organization_ids = {}


def _location_group(body):
    if body.get('group'):
        return body['group']
    project_id = body['projectId']
    if project_id not in _organization_ids:
        response = client.execute(
            get_project_organization,
            variable_values={'id': project_id},
        )
        organization_id = (response.get('getProject') or {}).get('organizationId')
        if not organization_id:
            raise RuntimeError(f'No organizationId found for project {project_id}')
        _organization_ids[project_id] = organization_id
    return _organization_ids[project_id]


def _download_s3_object(bucket, key, destination, object_label):
    try:
        s3.download_file(bucket, key, str(destination))
    except ClientError as error:
        code = error.response.get('Error', {}).get('Code', 'unknown')
        raise RuntimeError(
            f'Failed to download {object_label} from s3://{bucket}/{key} '
            f'(S3 error {code})'
        ) from error


def _download_model():
    if not MODEL_S3_URI.startswith('s3://'):
        raise RuntimeError('STORMFLY_MODEL_S3 must be set to a private s3://bucket/key')
    bucket_and_key = MODEL_S3_URI[5:]
    bucket, key = bucket_and_key.split('/', 1)
    model_path = Path('/workspace/model_cache/stormfly.onnx')
    if not model_path.exists():
        model_path.parent.mkdir(parents=True, exist_ok=True)
        print(
            f'Downloading private Stormfly testing weights from '
            f's3://{bucket}/{key}',
            flush=True,
        )
        _download_s3_object(bucket, key, model_path, 'Stormfly model')
    return model_path


def _get_detector():
    global detector
    if detector is None:
        detector = StormflyDetector(str(_download_model()), threshold=THRESHOLD)
    return detector


def _write_location(body, image_id, x, y, confidence, size, group):
    client.execute(
        create_location,
        variable_values=json.dumps({
            'height': size,
            'imageId': image_id,
            'projectId': body['projectId'],
            'x': x,
            'y': y,
            'width': size,
            'setId': body['setId'],
            'confidence': confidence,
            'source': 'stormfly-testing',
            'group': group,
        }),
    )


LOCATION_BATCH = 25


def _write_locations(body, image_id, points, size, group):
    for start in range(0, len(points), LOCATION_BATCH):
        chunk = points[start:start + LOCATION_BATCH]
        var_defs = ['$imageId: ID!', '$projectId: ID!', '$setId: ID!',
                    '$source: String!', '$size: Int', '$group: String!']
        fields = []
        variables = {
            'imageId': image_id,
            'projectId': body['projectId'],
            'setId': body['setId'],
            'source': 'stormfly-testing',
            'size': size,
            'group': group,
        }
        for i, (x, y, confidence) in enumerate(chunk):
            var_defs += [f'$x{i}: Int!', f'$y{i}: Int!', f'$c{i}: Float']
            fields.append(
                f'p{i}: createLocation(input: {{imageId: $imageId, '
                f'projectId: $projectId, setId: $setId, source: $source, '
                f'width: $size, height: $size, x: $x{i}, y: $y{i}, '
                f'confidence: $c{i}, group: $group}}) {{ id group }}'
            )
            variables[f'x{i}'] = x
            variables[f'y{i}'] = y
            variables[f'c{i}'] = confidence
        document = gql(
            'mutation BatchCreateLocations('
            + ', '.join(var_defs)
            + ') { '
            + ' '.join(fields)
            + ' }'
        )
        client.execute(document, variable_values=json.dumps(variables))


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
        return orig_width - y, x
    if rotation == 180:
        return orig_width - x, orig_height - y
    if rotation == 270:
        return y, orig_height - x
    return x, y


def handle_message(body):
    model = _get_detector()
    group = _location_group(body)
    for image in body['images']:
        key = image['key']
        suffix = os.path.splitext(key)[1] or '.jpg'
        rotation = _get_rotation(body, image)
        landscape = _get_landscape(body, image) if rotation else None
        with NamedTemporaryFile(suffix=suffix) as temp_file:
            _download_s3_object(
                body['bucket'],
                key,
                temp_file.name,
                f'survey image {image["imageId"]}',
            )
            with Image.open(temp_file.name) as pil_image:
                inference_image, rotation_info = _maybe_rotate_image(
                    pil_image, rotation, landscape
                )
                detections = model.detect(inference_image)

        if not detections:
            _write_location(body, image['imageId'], 0, 0, 0.0, 0, group)
            continue

        points = [
            (*_map_point_to_original(detection.x, detection.y, rotation_info),
             detection.score)
            for detection in detections
        ]
        _write_locations(body, image['imageId'], points, BOX_SIZE, group)


def main():
    while True:
        response = sqs.receive_message(
            QueueUrl=QUEUE_URL,
            AttributeNames=['SentTimestamp'],
            MaxNumberOfMessages=1,
            MessageAttributeNames=['All'],
            VisibilityTimeout=1800,
            WaitTimeSeconds=10,
        )
        for message in response.get('Messages', []):
            try:
                handle_message(json.loads(message['Body']))
                sqs.delete_message(
                    QueueUrl=QUEUE_URL,
                    ReceiptHandle=message['ReceiptHandle'],
                )
            except Exception as error:
                print(f'Error processing Stormfly message: {error}', flush=True)
                # Retry immediately instead of waiting for visibility expiry.
                try:
                    sqs.change_message_visibility(
                        QueueUrl=QUEUE_URL,
                        ReceiptHandle=message['ReceiptHandle'],
                        VisibilityTimeout=0,
                    )
                except ClientError as visibility_error:
                    print(
                        f'Failed to reset message visibility: {visibility_error}',
                        flush=True,
                    )
        if 'Messages' not in response:
            time.sleep(5)


if __name__ == '__main__':
    main()
