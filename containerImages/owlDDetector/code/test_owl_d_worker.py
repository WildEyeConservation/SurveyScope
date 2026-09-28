import importlib.util
import os
import sys
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
    aws_auth = types.ModuleType('requests_aws4auth')
    aws_auth.AWS4Auth = lambda **kwargs: Mock()
    detector = types.ModuleType('owl_detector')
    detector.OwlDDetector = Mock
    stubs = {
        'boto3': boto3,
        'botocore': botocore,
        'botocore.exceptions': botocore_exceptions,
        'gql': gql_module,
        'gql.client': gql_client,
        'gql.transport': gql_transport,
        'gql.transport.requests': gql_requests,
        'requests_aws4auth': aws_auth,
        'owl_detector': detector,
    }
    environment = {
        'REGION': 'eu-west-1',
        'QUEUE_URL': 'https://sqs.example/queue',
        'API_ENDPOINT': 'https://appsync.example/graphql',
    }
    spec = importlib.util.spec_from_file_location(
        'owl_d_process_sqs_tested', Path(__file__).with_name('processSQS.py')
    )
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, stubs), patch.dict(os.environ, environment, clear=False):
        spec.loader.exec_module(module)
    return module


worker = _load_worker()


class DuplicateCreateError(Exception):
    def __init__(self, errors):
        super().__init__('GraphQL create failed')
        self.errors = errors


class OwlDWorkerTests(unittest.TestCase):
    def setUp(self):
        self.body = {'projectId': 'project-1', 'setId': 'set-1'}

    def test_execute_passes_graphql_variables_as_a_mapping(self):
        variables = {'imageId': 'image-1', 'limit': 100}
        fake_client = Mock()
        fake_client.execute.return_value = {'ok': True}
        with patch.object(worker, 'client', fake_client):
            result = worker._execute('query', variables)
        self.assertEqual(result, {'ok': True})
        fake_client.execute.assert_called_once_with('query', variable_values=variables)
        self.assertIs(fake_client.execute.call_args.kwargs['variable_values'], variables)

    def test_inverse_rotation_maps_all_edge_pixels_inside_original_image(self):
        cases = {
            90: [((0, 0), (3, 0)), ((2, 3), (0, 2))],
            180: [((0, 0), (3, 2)), ((3, 2), (0, 0))],
            270: [((0, 0), (0, 2)), ((2, 3), (3, 0))],
        }
        for rotation, points in cases.items():
            info = {'rotation': rotation, 'origWidth': 4, 'origHeight': 3}
            for rotated, expected in points:
                with self.subTest(rotation=rotation, rotated=rotated):
                    self.assertEqual(worker._map_point_to_original(*rotated, info), expected)

    def test_location_ids_are_stable_and_scoped_to_result_position(self):
        first = worker._location_id(self.body, 'image-1', 0)
        self.assertEqual(first, worker._location_id(self.body, 'image-1', 0))
        self.assertNotEqual(first, worker._location_id(self.body, 'image-1', 1))
        self.assertNotEqual(first, worker._location_id(self.body, 'image-2', 0))
        self.assertNotEqual(first, worker._location_id({'projectId': 'project-1', 'setId': 'set-2'}, 'image-1', 0))

    def test_write_locations_uses_unique_stable_ids_across_batches(self):
        calls = []
        points = [(1.2, 2.8, 0.9), (3, 4, 0.8), (5, 6, 0.7)]
        with patch.object(worker, 'LOCATION_BATCH', 2), patch.object(
            worker, '_execute', side_effect=lambda document, variables: calls.append((document, variables))
        ):
            worker._write_locations(self.body, 'image-1', points, 64, 'org-1')
        self.assertEqual(len(calls), 2)
        self.assertIn('id: $id0', calls[0][0])
        ids = [calls[0][1]['id0'], calls[0][1]['id1'], calls[1][1]['id0']]
        self.assertEqual(len(set(ids)), 3)
        self.assertEqual(ids[2], worker._location_id(self.body, 'image-1', 2))
        self.assertEqual((calls[0][1]['x0'], calls[0][1]['y0']), (1, 3))

    def test_write_locations_sets_group_on_every_location(self):
        calls = []
        with patch.object(
            worker, '_execute', side_effect=lambda document, variables: calls.append((document, variables))
        ):
            worker._write_locations(self.body, 'image-1', [(1, 2, 0.5), (3, 4, 0.6)], 64, 'org-1')
        document, variables = calls[0]
        self.assertIn('$group: String!', document)
        self.assertEqual(document.count('group: $group'), 2)
        self.assertEqual(variables['group'], 'org-1')

    def test_location_group_prefers_message_group(self):
        with patch.object(worker, '_execute') as execute:
            self.assertEqual(worker._location_group({**self.body, 'group': 'org-msg'}), 'org-msg')
        execute.assert_not_called()

    def test_location_group_falls_back_to_cached_project_lookup(self):
        response = {'getProject': {'organizationId': 'org-project'}}
        with patch.dict(worker._organization_ids, clear=True), patch.object(
            worker, '_execute', return_value=response
        ) as execute:
            self.assertEqual(worker._location_group(self.body), 'org-project')
            self.assertEqual(worker._location_group(self.body), 'org-project')
        execute.assert_called_once_with(worker.get_project_organization, {'id': 'project-1'})

    def test_location_group_raises_when_project_has_no_organization(self):
        with patch.dict(worker._organization_ids, clear=True), patch.object(
            worker, '_execute', return_value={'getProject': None}
        ):
            with self.assertRaises(RuntimeError):
                worker._location_group(self.body)

    def test_concurrent_duplicate_write_is_idempotent(self):
        stored_ids = set()
        def persist(_document, variables):
            ids = {value for key, value in variables.items() if key.startswith('id')}
            duplicates = ids & stored_ids
            if duplicates:
                raise DuplicateCreateError([
                    {'message': 'The conditional request failed',
                     'errorType': 'DynamoDB:ConditionalCheckFailedException'}
                    for _ in duplicates
                ])
            stored_ids.update(ids)
        points = [(10, 20, 0.9), (30, 40, 0.8)]
        with patch.object(worker, '_execute', side_effect=persist):
            worker._write_locations(self.body, 'image-1', points, 64, 'org-1')
            worker._write_locations(self.body, 'image-1', points, 64, 'org-1')
        self.assertEqual(len(stored_ids), len(points))

    def test_non_duplicate_graphql_errors_are_not_suppressed(self):
        error = DuplicateCreateError([{'message': 'Unauthorized', 'errorType': 'UnauthorizedException'}])
        with patch.object(worker, '_execute', side_effect=error):
            with self.assertRaises(DuplicateCreateError):
                worker._write_locations(self.body, 'image-1', [(1, 2, 0.5)], 64, 'org-1')

    def test_mixed_graphql_errors_are_not_suppressed(self):
        error = DuplicateCreateError([
            {'message': 'The conditional request failed',
             'errorType': 'DynamoDB:ConditionalCheckFailedException'},
            {'message': 'Internal failure', 'errorType': 'InternalFailure'},
        ])
        with patch.object(worker, '_execute', side_effect=error):
            with self.assertRaises(DuplicateCreateError):
                worker._write_locations(self.body, 'image-1', [(1, 2, 0.5)], 64, 'org-1')


if __name__ == '__main__':
    unittest.main()
