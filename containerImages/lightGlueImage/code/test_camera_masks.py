import unittest

import numpy as np

from camera_masks import apply_camera_masks

BOTTOM_RIGHT = [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1]]


class CameraMaskTests(unittest.TestCase):
    def test_each_image_uses_its_own_mask_and_shape(self):
        shapes = ((2000, 4000), (4000, 2000))
        matches0 = np.array([[3000.0, 1500.0], [1000.0, 500.0], [1000.0, 500.0], [1000.0, 500.0]])
        matches1 = np.array([[100.0, 100.0], [1500.0, 3000.0], [100.0, 100.0], [1500.0, 1000.0]])
        confidences = np.array([0.1, 0.2, 0.3, 0.4])
        masks = [{"landscape": [BOTTOM_RIGHT]}, {"portrait": [BOTTOM_RIGHT], "landscape": [[[0, 0], [1, 0], [1, 1]]]}]

        kept0, kept1, kept_conf = apply_camera_masks(matches0, matches1, confidences, masks, shapes)

        np.testing.assert_array_equal(kept0, matches0[2:])
        np.testing.assert_array_equal(kept1, matches1[2:])
        np.testing.assert_array_equal(kept_conf, confidences[2:])

    def test_unmasked_side_and_missing_confidences(self):
        shapes = ((2000, 4000), (2000, 4000))
        matches0 = np.array([[3000.0, 1500.0], [100.0, 100.0]])
        matches1 = np.array([[3000.0, 1500.0], [3000.0, 1500.0]])

        kept0, kept1, kept_conf = apply_camera_masks(
            matches0, matches1, None, [{"landscape": [BOTTOM_RIGHT]}, None], shapes
        )

        np.testing.assert_array_equal(kept0, matches0[1:])
        np.testing.assert_array_equal(kept1, matches1[1:])
        self.assertIsNone(kept_conf)


if __name__ == "__main__":
    unittest.main()
