import importlib.util
import json
import logging
import os
import queue
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


def _load_worker():
    boto3 = types.ModuleType('boto3')
    boto3.client = lambda *args, **kwargs: Mock()
    boto3.Session = lambda: types.SimpleNamespace(get_credentials=lambda: Mock())
    botocore = types.ModuleType('botocore')
    botocore_exceptions = types.ModuleType('botocore.exceptions')
    botocore_exceptions.ClientError = type('ClientError', (Exception,), {})
    gql_module = types.ModuleType('gql')
    gql_module.gql = lambda document: document
    gql_client = types.ModuleType('gql.client')
    gql_client.Client = lambda **kwargs: Mock()
    gql_transport = types.ModuleType('gql.transport')
    gql_requests = types.ModuleType('gql.transport.requests')
    gql_requests.RequestsHTTPTransport = lambda **kwargs: Mock()
    gql_requests.log = logging.getLogger('gql-stub')
    aws_auth = types.ModuleType('requests_aws4auth')
    aws_auth.AWS4Auth = lambda **kwargs: Mock()
    stubs = {
        'boto3': boto3,
        'botocore': botocore,
        'botocore.exceptions': botocore_exceptions,
        'gql': gql_module,
        'gql.client': gql_client,
        'gql.transport': gql_transport,
        'gql.transport.requests': gql_requests,
        'requests_aws4auth': aws_auth,
        'torch': types.ModuleType('torch'),
    }
    environment = {
        'REGION': 'eu-west-1',
        'QUEUE_URL': 'https://sqs.example/queue',
        'API_ENDPOINT': 'https://appsync.example/graphql',
    }
    spec = importlib.util.spec_from_file_location(
        'scoutbot_process_sqs_tested', Path(__file__).with_name('processSQS.py')
    )
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, stubs), patch.dict(os.environ, environment, clear=False):
        spec.loader.exec_module(module)
    return module


worker = _load_worker()

try:
    import torch
except ImportError:
    torch = None


class DuplicateCreateError(Exception):
    def __init__(self, errors):
        super().__init__('GraphQL create failed')
        self.errors = errors


CONDITIONAL_FAILURE = {
    'errorType': 'DynamoDB:ConditionalCheckFailedException',
    'message': 'The conditional request failed',
}


class ScoutbotWorkerTests(unittest.TestCase):
    def setUp(self):
        self.body = {
            'projectId': 'project-1',
            'setId': 'set-1',
            'group': 'org-1',
            'images': [{'imageId': 'image-1'}, {'imageId': 'image-2'}],
        }
        self.message = {
            'Body': json.dumps(self.body),
            'MessageId': 'message-1',
            'ReceiptHandle': 'receipt-1',
            'Attributes': {'ApproximateReceiveCount': '1'},
        }

    def _run_output(self, detects_list, fake_client, fake_sqs):
        outputs = queue.Queue()
        outputs.put((detects_list, self.message))
        outputs.put(None)
        with patch.object(worker, 'client', fake_client), patch.object(worker, 'sqs', fake_sqs):
            worker.process_output(outputs)

    def test_location_ids_are_stable_and_scoped_to_result_position(self):
        first = worker._location_id(self.body, 'image-1', 0)
        self.assertEqual(first, worker._location_id(self.body, 'image-1', 0))
        self.assertNotEqual(first, worker._location_id(self.body, 'image-1', 1))
        self.assertNotEqual(first, worker._location_id(self.body, 'image-2', 0))
        self.assertNotEqual(first, worker._location_id({**self.body, 'setId': 'set-2'}, 'image-1', 0))
        self.assertNotEqual(first, worker._location_id(self.body, 'image-1', worker.NO_DETECTIONS))

    def test_create_location_sends_stable_id_as_a_mapping(self):
        fake_client = Mock()
        with patch.object(worker, 'client', fake_client):
            worker._create_location(self.body, 'image-1', 3, 'org-1', 10, 20, 30, 40, 0.7)
        document, = fake_client.execute.call_args.args
        variables = fake_client.execute.call_args.kwargs['variable_values']
        self.assertIn('id: $id', document)
        self.assertEqual(variables['id'], worker._location_id(self.body, 'image-1', 3))
        self.assertEqual(
            (variables['x'], variables['y'], variables['width'], variables['height']),
            (10, 20, 30, 40),
        )
        self.assertEqual(variables['source'], 'scoutbotv3')
        self.assertEqual(variables['group'], 'org-1')

    def test_create_location_ignores_an_existing_location(self):
        fake_client = Mock()
        fake_client.execute.side_effect = DuplicateCreateError([CONDITIONAL_FAILURE])
        with patch.object(worker, 'client', fake_client):
            worker._create_location(self.body, 'image-1', 0, 'org-1', 1, 2, 3, 4, 0.5)

    def test_create_location_raises_other_errors(self):
        for error in (
            DuplicateCreateError([{'errorType': 'Unauthorized', 'message': 'Not Authorized'}]),
            DuplicateCreateError([CONDITIONAL_FAILURE, {'message': 'Throttled'}]),
            RuntimeError('connection reset'),
        ):
            fake_client = Mock()
            fake_client.execute.side_effect = error
            with self.subTest(error=error), patch.object(worker, 'client', fake_client):
                with self.assertRaises(type(error)):
                    worker._create_location(self.body, 'image-1', 0, 'org-1', 1, 2, 3, 4, 0.5)

    def test_redelivered_message_writes_the_same_location_ids(self):
        detects_list = [
            [{'x': 10, 'y': 20, 'w': 30, 'h': 40, 'c': 0.9}, {'x': 1, 'y': 2, 'w': 4, 'h': 6, 'c': 0.5}],
            [],
        ]
        runs = []
        for _ in range(2):
            fake_client, fake_sqs = Mock(), Mock()
            self._run_output(detects_list, fake_client, fake_sqs)
            runs.append([call.kwargs['variable_values'] for call in fake_client.execute.call_args_list])
            fake_sqs.delete_message.assert_called_once_with(
                QueueUrl=worker.queue_url, ReceiptHandle='receipt-1'
            )
        self.assertEqual(runs[0], runs[1])
        ids = [variables['id'] for variables in runs[0]]
        self.assertEqual(len(set(ids)), 3)
        self.assertEqual((runs[0][0]['x'], runs[0][0]['y']), (25, 40))
        self.assertEqual((runs[0][2]['imageId'], runs[0][2]['confidence']), ('image-2', 0))

    def test_existing_locations_do_not_block_message_completion(self):
        fake_client, fake_sqs = Mock(), Mock()
        fake_client.execute.side_effect = DuplicateCreateError([CONDITIONAL_FAILURE])
        self._run_output([[{'x': 0, 'y': 0, 'w': 2, 'h': 2, 'c': 0.9}], []], fake_client, fake_sqs)
        self.assertEqual(fake_client.execute.call_count, 2)
        fake_sqs.delete_message.assert_called_once()

    def test_failed_write_leaves_the_message_for_retry(self):
        fake_client, fake_sqs = Mock(), Mock()
        fake_client.execute.side_effect = RuntimeError('connection reset')
        self._run_output([[{'x': 0, 'y': 0, 'w': 2, 'h': 2, 'c': 0.9}], []], fake_client, fake_sqs)
        fake_sqs.delete_message.assert_not_called()

    @unittest.skipIf(torch is None, 'needs torch')
    def test_rotated_detections_map_back_onto_the_stored_image(self):
        box = {'x': 30, 'y': 5, 'w': 12, 'h': 7}
        picture = torch.zeros(3, 40, 64, dtype=torch.uint8)
        picture[:, box['y']:box['y'] + box['h'], box['x']:box['x'] + box['w']] = 255
        for rotation in (90, 180, 270):
            with self.subTest(rotation=rotation), patch.object(worker, 'torch', torch):
                rotated, info = worker._maybe_rotate_picture(picture, rotation, None)
                ys, xs = rotated[0].nonzero(as_tuple=True)
                found = {
                    'x': int(xs.min()), 'y': int(ys.min()),
                    'w': int(xs.max() - xs.min() + 1), 'h': int(ys.max() - ys.min() + 1), 'c': 0.9,
                }
                mapped, = worker._apply_rotation_to_detects([found], info)
                self.assertEqual({key: mapped[key] for key in box}, box)

    def test_landscape_constraint_skips_rotation(self):
        picture = types.SimpleNamespace(shape=(3, 40, 64))
        unchanged, info = worker._maybe_rotate_picture(picture, 90, False)
        self.assertIs(unchanged, picture)
        self.assertEqual(info, {'rotation': 0})

    def test_decode_failures_travel_with_the_task_and_files_are_removed(self):
        files = []
        for _ in range(2):
            handle = tempfile.NamedTemporaryFile(delete=False)
            handle.close()
            files.append(handle.name)

        def decode(path):
            if path == files[1]:
                raise ValueError('unreadable')
            return 'pixels'

        fast = types.ModuleType('fast')
        fast.decode = decode
        inputs, decoded = queue.Queue(), queue.Queue()
        inputs.put({'files': [files[0]], 'message': self.message})
        inputs.put({'files': files, 'message': self.message})
        inputs.put(None)
        with patch.dict(sys.modules, {'fast': fast}):
            worker._decode_tasks(inputs, decoded)
        good, bad, sentinel = decoded.get(), decoded.get(), decoded.get()
        self.assertEqual(good['pictures'], ['pixels'])
        self.assertIsInstance(bad['error'], ValueError)
        self.assertIsNone(sentinel)
        self.assertFalse(any(os.path.exists(file) for file in files))
        with self.assertRaises(ValueError):
            worker._detect_task(Mock(), bad)

    def test_receive_uses_the_queue_visibility_timeout(self):
        fake_sqs = Mock()
        fake_sqs.receive_message.side_effect = KeyboardInterrupt
        with patch.object(worker.boto3, 'client', return_value=fake_sqs), patch.object(
            worker, 'torch', Mock()
        ), patch.object(worker.multiprocessing, 'get_context', return_value=Mock()), patch.dict(
            os.environ, {'REGION': 'eu-west-1', 'QUEUE_URL': 'https://sqs.example/queue'}
        ):
            worker.main()
        fake_sqs.receive_message.assert_called_once()
        self.assertNotIn('VisibilityTimeout', fake_sqs.receive_message.call_args.kwargs)


if __name__ == '__main__':
    unittest.main()
