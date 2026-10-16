import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

try:
    import numpy as np
    import torch

    import detector
    from fast import ScoutBot, decode, greedy_merge, slice_corners
except ImportError:
    np = None


def fake_scoutbot(forward):
    model = ScoutBot.__new__(ScoutBot)
    model.device, model.dtype, model.backend = torch.device('cpu'), torch.float32, 'eager'
    model.loc_thresh, model.batch, model.tile, model.overlap = 0.45, 32, 512, 0.25
    model.names, model.classes = {0: 'animal'}, 1
    model.forward = forward
    return model


@unittest.skipIf(np is None, 'needs numpy and torch')
class FastScoutbotTests(unittest.TestCase):
    def test_slices_cover_a_survey_photograph_as_sahi_does(self):
        corners = slice_corners(9504, 6336)
        self.assertEqual(len(corners), 425)
        self.assertEqual(corners[:3], [(0, 0), (0, 384), (0, 768)])
        self.assertEqual(max(x for _, x in corners), 6336 - 512)
        self.assertEqual(max(y for y, _ in corners), 9504 - 512)
        self.assertEqual(len(set(corners)), len(corners))

    def test_a_picture_the_size_of_a_slice_gets_one_slice(self):
        self.assertEqual(slice_corners(512, 512), [(0, 0)])

    def test_overlapping_boxes_merge_into_their_union_with_the_best_score(self):
        boxes = np.array([[0, 0, 10, 10], [2, 2, 11, 11], [100, 100, 110, 110]], dtype=np.float32)
        scores = np.array([0.5, 0.9, 0.6], dtype=np.float32)
        merged = greedy_merge(boxes, scores)
        self.assertEqual(
            [(box.tolist(), round(score, 3), label) for box, score, label in merged],
            [([0, 0, 11, 11], 0.9, 1), ([100, 100, 110, 110], 0.6, 2)],
        )

    def test_a_box_inside_a_larger_one_merges_by_intersection_over_the_smaller(self):
        boxes = np.array([[0, 0, 100, 100], [10, 10, 20, 20]], dtype=np.float32)
        merged = greedy_merge(boxes, np.array([0.7, 0.8], dtype=np.float32))
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0][0].tolist(), [0, 0, 100, 100])
        self.assertEqual(merged[0][2], 1)

    def test_merging_matches_sahi_on_random_boxes(self):
        try:
            from sahi.postprocess import combine
            from sahi.prediction import ObjectPrediction
        except ImportError:
            self.skipTest('needs sahi')
        generator = np.random.default_rng(0)
        for _ in range(20):
            corners = generator.uniform(0, 300, size=(60, 2))
            boxes = np.concatenate([corners, corners + generator.uniform(5, 60, size=(60, 2))], axis=1).astype(
                np.float32
            )
            scores = generator.uniform(0.25, 1, size=60).astype(np.float32)
            predictions = [
                ObjectPrediction(bbox=box.tolist(), score=float(score), category_id=0, category_name='detection')
                for box, score in zip(boxes, scores)
            ]
            expected = combine.GreedyNMMPostprocess(match_threshold=0.5, match_metric='IOS', class_agnostic=True)(
                predictions
            )
            expected = sorted((round(p.score.value, 5), *np.round(p.bbox.to_xyxy(), 3)) for p in expected)
            found = sorted((round(score, 5), *np.round(box, 3)) for box, score, _ in greedy_merge(boxes, scores))
            self.assertEqual(found, expected)

    def test_small_images_are_padded_to_whole_tiles_and_boxes_stay_inside(self):
        seen = []

        def forward(tiles):
            seen.append(tiles)
            output = torch.zeros(len(tiles), 5, 2)
            output[:, :, 0] = torch.tensor([100.0, 100.0, 40.0, 40.0, 0.9])
            output[:, :, 1] = torch.tensor([200.0, 240.0, 40.0, 40.0, 0.8])
            return output

        for height, width in ((400, 600), (256, 256)):
            seen.clear()
            with self.subTest(size=(height, width)):
                detections = fake_scoutbot(forward).detect(torch.zeros(3, height, width, dtype=torch.uint8))
                self.assertTrue(all(tiles.shape[-2:] == (512, 512) for tiles in seen))
                self.assertTrue(torch.allclose(seen[0][0, :, height:, :], torch.tensor(114 / 255)))
                self.assertTrue(detections)
                for found in detections:
                    self.assertLessEqual(found['x'] + found['w'], width)
                    self.assertLessEqual(found['y'] + found['h'], height)

    def test_16_bit_images_decode_like_opencv(self):
        import cv2

        pixels = np.random.default_rng(0).integers(0, 65536, size=(20, 30, 3), dtype=np.uint16)
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, 'deep.png')
            cv2.imwrite(path, pixels)
            expected = cv2.cvtColor(cv2.imread(path, cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)
            self.assertTrue(np.array_equal(decode(path).permute(1, 2, 0).numpy(), expected))


@unittest.skipIf(np is None, 'needs numpy and torch')
class DetectorTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.context = Mock()
        environment = {'SCOUTBOT_ENGINE_DIR': self.directory.name, 'SCOUTBOT_BACKEND': 'tensorrt'}
        for patcher in (
            patch.dict(os.environ, environment),
            patch.object(detector, 'engine_name', return_value='engine.plan'),
            patch.object(detector.multiprocessing, 'get_context', return_value=self.context),
            patch.object(detector.torch.cuda, 'get_device_name', return_value='GPU'),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.engine = Path(self.directory.name) / 'engine.plan'

    def scoutbot(self, fail_engine=False):
        def build(**kwargs):
            if kwargs.get('backend') == 'tensorrt' and fail_engine:
                raise RuntimeError('corrupt engine')
            return types.SimpleNamespace(backend=kwargs.get('backend', 'eager'))

        return patch.object(detector, 'ScoutBot', side_effect=build)

    def test_without_a_cached_engine_it_runs_in_fp16_and_builds_one(self):
        with self.scoutbot(), patch.object(detector, 'fetch_engine', return_value=False):
            chosen = detector.Detector()
        self.assertEqual(chosen.model.backend, 'eager')
        self.context.Process.assert_called_once()
        self.assertTrue(self.context.Process.call_args.kwargs['daemon'])
        chosen.builder.start.assert_called_once()

    def test_a_cached_engine_is_used_directly(self):
        self.engine.write_bytes(b'engine')
        with self.scoutbot():
            chosen = detector.Detector()
        self.assertEqual(chosen.model.backend, 'tensorrt')
        self.assertIsNone(chosen.builder)

    def test_an_engine_that_will_not_load_is_discarded_and_rebuilt(self):
        self.engine.write_bytes(b'corrupt')
        with self.scoutbot(fail_engine=True):
            chosen = detector.Detector()
        self.assertEqual(chosen.model.backend, 'eager')
        self.assertFalse(self.engine.exists())
        chosen.builder.start.assert_called_once()

    def test_upgrades_once_the_build_succeeds_and_not_when_it_fails(self):
        for exitcode, backend in ((1, 'eager'), (0, 'tensorrt')):
            with self.subTest(exitcode=exitcode), self.scoutbot(), patch.object(
                detector, 'fetch_engine', return_value=False
            ):
                self.engine.unlink(missing_ok=True)
                chosen = detector.Detector()
                chosen.builder.is_alive.return_value = False
                chosen.builder.exitcode = exitcode
                self.engine.write_bytes(b'engine')
                with patch.object(detector.torch.cuda, 'empty_cache'):
                    chosen.maybe_upgrade()
                self.assertEqual(chosen.model.backend, backend)
                self.assertIsNone(chosen.builder)

    def test_a_failed_upload_keeps_the_built_engine(self):
        trt = types.ModuleType('trt')
        trt.export_onnx = lambda weights, path: path.write_bytes(b'onnx')
        trt.build = lambda onnx_path, path, batch: path.write_bytes(b'engine')
        s3 = Mock()
        s3.upload_file.side_effect = RuntimeError('access denied')
        with patch.dict(sys.modules, {'trt': trt}), patch.dict(os.environ, {'ENGINE_BUCKET': 'cache'}), patch.object(
            detector, '_s3', return_value=s3
        ):
            detector.build_engine(self.engine)
        self.assertEqual(self.engine.read_bytes(), b'engine')
        s3.upload_file.assert_called_once()


if __name__ == '__main__':
    unittest.main()
