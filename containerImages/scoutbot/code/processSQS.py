import json
import os
import sys
from boto3 import Session as AWSSession
from gql import gql
from gql.client import Client
from gql.transport.requests import RequestsHTTPTransport
import boto3
from botocore.exceptions import ClientError
from tempfile import NamedTemporaryFile
import time
from contextlib import ExitStack
import scoutbot
from requests_aws4auth import AWS4Auth
import multiprocessing
import logging
import torch
import cv2
                                                                                                                                         
logging.basicConfig(level=logging.INFO)   
from gql.transport.requests import log as requests_logger                                                               
                                                                                                                        
requests_logger.setLevel(logging.WARNING)

sqs = boto3.client('sqs',os.environ['REGION'])
queue_url = os.environ['QUEUE_URL']
single_image_failure_visibility_seconds = int(
    os.environ.get('SINGLE_IMAGE_FAILURE_VISIBILITY_SECONDS', '1800')
)

createLocation=gql("""
mutation MyMutation($confidence: Float, $height: Int, $imageId: ID!, $projectId: ID="", $setId: ID!, $source: String!, $width: Int, $x: Int!, $y: Int!, $group: String!) {
  createLocation(input: {confidence: $confidence, height: $height, imageId: $imageId, projectId: $projectId, setId: $setId, source: $source, x: $x, y: $y, width: $width, group: $group}){
    id
    group
  }
}
""")

getProjectOrganization=gql("""
query GetProjectOrganization($id: ID!) {
  getProject(id: $id) { organizationId }
}
""")


# Create graphQL client that we'll use to post results back to the DetwebAPI
headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
}
# Keep credentials refreshable: ECS task-role credentials rotate every few hours,
# so pass the live botocore credentials object (not a frozen snapshot) to AWS4Auth.
# A frozen snapshot expires mid-run and every AppSync write fails with
# ExpiredTokenException until the container restarts.
auth = AWS4Auth(
    region=os.environ['REGION'],
    service='appsync',
    refreshable_credentials=boto3.Session().get_credentials(),
)
transport = RequestsHTTPTransport(url=os.environ['API_ENDPOINT'],
                                    headers=headers,
                                    auth=auth)
client = Client(transport=transport,
                fetch_schema_from_transport=False)

def _message_context(message):
    body = json.loads(message['Body'])
    image_ids = [image.get('imageId') for image in body.get('images', [])]
    receive_count = message.get('Attributes', {}).get('ApproximateReceiveCount', 'unknown')
    return body, message.get('MessageId', 'unknown'), image_ids, receive_count

def _split_batch_message(body, source_message_id):
    images = body.get('images', [])
    for image in images:
        sqs.send_message(
            QueueUrl=queue_url,
            MessageBody=json.dumps({
                **body,
                'images': [image],
                'splitFromBatch': True,
                'splitFromMessageId': source_message_id,
            }),
        )
    logging.info(
        'Split failed batch message %s into %d single-image messages: %s',
        source_message_id,
        len(images),
        [image.get('imageId') for image in images],
    )

def _split_and_delete_batch_message(body, source_message_id, receipt_handle):
    try:
        _split_batch_message(body, source_message_id)
        sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=receipt_handle)
        logging.info('Deleted failed batch message %s after successful split.', source_message_id)
        return True
    except Exception as error:
        logging.error(
            'Failed to split/delete batch message %s; original message will retry. Error: %s',
            source_message_id,
            _error_summary(error),
        )
        return False

def _cleanup_files(files):
    for file in files:
        try:
            if os.path.exists(file):
                os.remove(file)
        except Exception:
            logging.warning('Failed to remove temporary file %s', file)

def _error_summary(error):
    return f'{type(error).__name__}: {error}'

# Location auth is groupDefinedIn('group'): a Location without the project's
# organizationId as its group is invisible to every annotator. runScoutbot sends
# the group in the message; messages queued before it did are resolved here.
_organization_ids = {}

def _location_group(body):
    if body.get('group'):
        return body['group']
    project_id = body['projectId']
    if project_id not in _organization_ids:
        resp = client.execute(getProjectOrganization, variable_values=json.dumps({'id': project_id}))
        organization_id = (resp.get('getProject') or {}).get('organizationId')
        if not organization_id:
            raise ValueError(f'No organizationId found for project {project_id}')
        _organization_ids[project_id] = organization_id
    return _organization_ids[project_id]

# Optional rotation support.
#
# Some surveys hold landscape images whose correct orientation is only reached by
# rotating them (e.g. 270 CCW), but that rotation was never written to EXIF, so
# Scoutbot (via cv2.imread, which honours EXIF) sees them in the wrong orientation
# and detects poorly. When a message carries a `rotation` (CCW degrees, one of
# 90/180/270 - message-level, or per-image as an override) we rotate the pixels
# before inference and map every detection box back into the original/stored frame
# so the saved Locations still line up with the image as the web app displays it.
#
# An optional `landscape` flag gates the rotation on the image's actual dimensions,
# so a mixed set only rotates the images that are genuinely in the wrong orientation:
#   landscape=True  -> only rotate when width  > height
#   landscape=False -> only rotate when height > width
#   landscape unset -> rotate regardless of dimensions
_ROTATE_CODES = {
    90: cv2.ROTATE_90_COUNTERCLOCKWISE,
    180: cv2.ROTATE_180,
    270: cv2.ROTATE_90_CLOCKWISE,  # 270 CCW == 90 CW
}

def _normalize_rotation(value):
    """Return rotation in CCW degrees (0/90/180/270), or 0 if unset/invalid."""
    if value is None:
        return 0
    try:
        rotation = int(value) % 360
    except (TypeError, ValueError):
        logging.warning('Ignoring invalid rotation value: %r', value)
        return 0
    if rotation not in _ROTATE_CODES:
        if rotation != 0:
            logging.warning('Ignoring unsupported rotation %r (expected 0/90/180/270 CCW)', value)
        return 0
    return rotation

def _get_rotation(body, image):
    """Per-image rotation overrides the message-level rotation; both are CCW degrees."""
    if image.get('rotation') is not None:
        return _normalize_rotation(image.get('rotation'))
    return _normalize_rotation(body.get('rotation'))

def _normalize_landscape(value):
    """Return True/False for the landscape constraint, or None when unset/invalid."""
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
    logging.warning('Ignoring invalid landscape value: %r', value)
    return None

def _get_landscape(body, image):
    """Per-image landscape constraint overrides the message-level one. Returns
    True/False, or None when unset (no orientation check)."""
    if image.get('landscape') is not None:
        return _normalize_landscape(image.get('landscape'))
    return _normalize_landscape(body.get('landscape'))

def _orientation_qualifies(orig_width, orig_height, landscape):
    """Whether an image's orientation matches the optional landscape constraint.
    landscape=True requires width > height; False requires height > width;
    None imposes no constraint. Square images never qualify when a constraint is set."""
    if landscape is None:
        return True
    if landscape:
        return orig_width > orig_height
    return orig_height > orig_width

def _maybe_rotate_image_file(path, rotation, landscape):
    """Rotate the image on disk in place by `rotation` CCW degrees, but only when its
    orientation satisfies the optional `landscape` constraint.

    Returns a rotation_info dict: the rotation actually applied (0 if skipped) and the
    pre-rotation dimensions (the EXIF-applied display frame) when rotated, so detection
    coordinates can be mapped back. Raises on read/write failure."""
    image = cv2.imread(path, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f'cv2 could not read image for rotation: {path}')
    orig_height, orig_width = image.shape[:2]
    if not _orientation_qualifies(orig_width, orig_height, landscape):
        logging.info(
            'Skipping %d-degree rotation for %s: %dx%d does not satisfy landscape=%s',
            rotation, path, orig_width, orig_height, landscape,
        )
        return {'rotation': 0}
    rotated = cv2.rotate(image, _ROTATE_CODES[rotation])
    if not cv2.imwrite(path, rotated):
        raise ValueError(f'cv2 could not write rotated image: {path}')
    return {'rotation': rotation, 'origWidth': orig_width, 'origHeight': orig_height}

def _map_detect_to_original(detect, rotation, orig_width, orig_height):
    """Map a detection box (x, y top-left, w, h - in the rotated frame) back to the
    original pre-rotation frame. `rotation` is the CCW degrees applied to the image."""
    x, y, w, h = detect['x'], detect['y'], detect['w'], detect['h']
    if rotation == 90:
        mapped = {'x': orig_width - y - h, 'y': x, 'w': h, 'h': w}
    elif rotation == 180:
        mapped = {'x': orig_width - x - w, 'y': orig_height - y - h, 'w': w, 'h': h}
    elif rotation == 270:
        mapped = {'x': y, 'y': orig_height - x - w, 'w': h, 'h': w}
    else:
        return detect
    return {**detect, **mapped}

def _apply_rotation_to_detects(detects, info):
    """Map a single image's detections back to its original frame, if it was rotated."""
    rotation = info.get('rotation', 0) if info else 0
    if not rotation or not detects:
        return detects
    return [
        _map_detect_to_original(detect, rotation, info['origWidth'], info['origHeight'])
        for detect in detects
    ]

def _extend_failed_single_image_visibility(message, message_id, image_ids):
    try:
        sqs.change_message_visibility(
            QueueUrl=queue_url,
            ReceiptHandle=message['ReceiptHandle'],
            VisibilityTimeout=single_image_failure_visibility_seconds,
        )
        logging.info(
            'Delayed retry for failed single-image Scoutbot message %s by %d seconds. Image ids: %s',
            message_id,
            single_image_failure_visibility_seconds,
            image_ids,
        )
    except Exception as error:
        logging.error(
            'Failed to delay retry for single-image Scoutbot message %s. It will use the current visibility timeout. Error: %s',
            message_id,
            _error_summary(error),
        )

def process_scoutbot(input_queue, output_queue):
    while True:
        task = input_queue.get()
        if task is None:  # Sentinel value to stop the process
            output_queue.put(None)
            logging.info('Scoutbot process received sentinel value. Exiting.')
            break
        body, message_id, image_ids, receive_count = _message_context(task['message'])
        logging.info(
            'Processing Scoutbot message %s attempt %s with image ids: %s',
            message_id,
            receive_count,
            image_ids,
        )
        try:
            _, detects_list = scoutbot.batch_v3(task['files'], 'v3', torch.cuda.current_device())
            rotation_info = task.get('rotationInfo')
            if rotation_info:
                detects_list = [
                    _apply_rotation_to_detects(detects, info)
                    for detects, info in zip(detects_list, rotation_info)
                ]
            output_queue.put((detects_list, task['message']))
        except Exception as error:
            if len(body.get('images', [])) > 1 and not body.get('splitFromBatch'):
                logging.error(
                    'Scoutbot batch failed for message %s; splitting image ids into single-image messages: %s; error: %s',
                    message_id,
                    image_ids,
                    _error_summary(error),
                )
                _split_and_delete_batch_message(
                    body,
                    message_id,
                    task['message']['ReceiptHandle'],
                )
            else:
                logging.error(
                    'Scoutbot single-image message %s failed and will retry/DLQ via SQS. Image ids: %s; error: %s',
                    message_id,
                    image_ids,
                    _error_summary(error),
                )
                _extend_failed_single_image_visibility(task['message'], message_id, image_ids)
        finally:
            _cleanup_files(task['files'])

def process_output(output_queue):
    while True:
        output = output_queue.get() 
        if output is None:
            logging.info('Output process received sentinel value. Exiting.')
            break
        detects_list, message = output
        message_id = message.get('MessageId', 'unknown')
        image_ids = []
        try:
            body, message_id, image_ids, receive_count = _message_context(message)
            group = _location_group(body)
            for detects, image in zip(detects_list, body['images']):
                detection_count = len(detects) if detects else 0
                logging.info(
                    'Scoutbot message %s image %s produced %d detections.',
                    message_id,
                    image['imageId'],
                    detection_count,
                )
                if not detects:
                    resp = client.execute(createLocation, variable_values=json.dumps({
                        'height': 0,
                        'imageId': image['imageId'],
                        'projectId': body['projectId'],
                        'x': 0,
                        'y': 0,
                        'width': 0,
                        'setId': body['setId'],
                        'confidence': 0,
                        'source': 'scoutbotv3',
                        'group': group
                    }))
                else:
                    for detect in detects:
                        resp = client.execute(createLocation, variable_values=json.dumps({
                            'height': round(detect['h']),
                            'imageId': image['imageId'],
                            'projectId': body['projectId'],
                            'x': round(detect['x'] + detect['w'] / 2),
                            'y': round(detect['y'] + detect['h'] / 2),
                            'width': round(detect['w']),
                            'setId': body['setId'],
                            'confidence': detect['c'],
                            'source': 'scoutbotv3',
                            'group': group
                        }))
            sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=message['ReceiptHandle'])
            logging.info(
                'Completed Scoutbot message %s attempt %s with image ids: %s',
                message_id,
                receive_count,
                image_ids,
            )
        except Exception as error:
            logging.error(
                'Failed to write Scoutbot results for message %s; it will retry/DLQ via SQS. Image ids: %s; error: %s',
                message_id,
                image_ids,
                _error_summary(error),
            )
            if len(image_ids) == 1:
                _extend_failed_single_image_visibility(message, message_id, image_ids)

def main():
    sqs = boto3.client('sqs', os.environ['REGION'])
    queue_url = os.environ['QUEUE_URL']
    s3_client = boto3.client('s3', os.environ['REGION'])

    # Fail fast if CUDA is unavailable, rather than consuming messages we can't process
    if not torch.cuda.is_available():
        logging.error('CUDA is not available. Exiting so ECS can replace this task.')
        sys.exit(1)

    # CUDA cannot be re-initialized in a forked subprocess. The torch.cuda.is_available()
    # check above initializes a CUDA context in this parent process, so children must be
    # started with 'spawn' (a fresh interpreter) rather than the Linux default of 'fork'.
    ctx = multiprocessing.get_context('spawn')

    # Create queues for inter-process communication (must share the spawn context)
    input_queue = ctx.Queue(maxsize=5)  # Adjust capacity as needed
    output_queue = ctx.Queue()

    # Start the scoutbot process
    scoutbot_process = ctx.Process(target=process_scoutbot, args=(input_queue, output_queue))
    output_process = ctx.Process(target=process_output, args=(output_queue,))
    scoutbot_process.start()
    output_process.start()

    try:
        while True:
            # Fail fast if either child process has died so ECS replaces the task
            if not scoutbot_process.is_alive() or not output_process.is_alive():
                logging.error(f'Child process died (scoutbot exitcode={scoutbot_process.exitcode}, output exitcode={output_process.exitcode}). Exiting.')
                scoutbot_process.terminate()
                output_process.terminate()
                sys.exit(1)

            response = sqs.receive_message(
                QueueUrl=queue_url,
                AttributeNames=['SentTimestamp', 'ApproximateReceiveCount'],
                MaxNumberOfMessages=1,
                MessageAttributeNames=['All'],
                VisibilityTimeout=120,
                WaitTimeSeconds=0
            )

            if 'Messages' in response:
                for message in response['Messages']:
                    body, message_id, image_ids, receive_count = _message_context(message)
                    logging.info(
                        'Received Scoutbot message %s attempt %s with image ids: %s',
                        message_id,
                        receive_count,
                        image_ids,
                    )

                    keys= [image['key'] for image in body['images']]
                    files = [NamedTemporaryFile(suffix=os.path.splitext(key)[1]).name for key in keys]
                    try:
                        for key,file in zip(keys,files):
                            s3_client.download_file(body['bucket'], key, file)

                        # Optionally rotate images whose true orientation is missing
                        # from EXIF, gated on the `landscape` orientation check, and
                        # record original dimensions so detection boxes can be mapped
                        # back to the stored frame after inference.
                        rotation_info = []
                        for image, file in zip(body['images'], files):
                            rotation = _get_rotation(body, image)
                            if rotation:
                                landscape = _get_landscape(body, image)
                                rotation_info.append(
                                    _maybe_rotate_image_file(file, rotation, landscape)
                                )
                            else:
                                rotation_info.append({'rotation': 0})

                        # Put task in the input queue
                        input_queue.put({'files':files, 'message': message, 'rotationInfo': rotation_info})
                    except Exception as error:
                        _cleanup_files(files)
                        if len(body.get('images', [])) > 1 and not body.get('splitFromBatch'):
                            logging.error(
                                'Failed to prepare Scoutbot batch message %s; splitting image ids into single-image messages: %s; error: %s',
                                message_id,
                                image_ids,
                                _error_summary(error),
                            )
                            _split_and_delete_batch_message(
                                body,
                                message_id,
                                message['ReceiptHandle'],
                            )
                        else:
                            logging.error(
                                'Failed to prepare Scoutbot single-image message %s; it will retry/DLQ via SQS. Image ids: %s; error: %s',
                                message_id,
                                image_ids,
                                _error_summary(error),
                            )
                            _extend_failed_single_image_visibility(message, message_id, image_ids)
            else:
                logging.debug('Scoutbot queue empty.')
                time.sleep(30)

    except KeyboardInterrupt:
        print("Shutting down...")
    finally:
        # Signal the scoutbot process to stop (skip if it already died, so we don't
        # block forever on a full queue)
        if scoutbot_process.is_alive():
            input_queue.put(None)
        scoutbot_process.join()
        output_process.join()

if __name__ == "__main__":
    main()
