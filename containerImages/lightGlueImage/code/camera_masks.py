import numpy as np
from shapely.geometry import Point, Polygon


def camera_mask_polygons(camera_masks, shape):
    """Camera masks are fractions of the image, keyed by landscape/portrait."""
    height, width = shape
    polygons = (camera_masks or {}).get("portrait" if height > width else "landscape") or []
    return [Polygon([(x * width, y * height) for x, y in polygon]) for polygon in polygons]


def apply_camera_masks(matches0, matches1, confidences, camera_masks, shapes):
    keep = np.ones(len(matches0), dtype=bool)
    for matches, masks, shape in zip([matches0, matches1], camera_masks, shapes):
        for polygon in camera_mask_polygons(masks, shape):
            keep &= ~np.array([polygon.contains(Point(x, y)) for x, y in matches], dtype=bool)
    return matches0[keep], matches1[keep], (confidences[keep] if confidences is not None else None)
