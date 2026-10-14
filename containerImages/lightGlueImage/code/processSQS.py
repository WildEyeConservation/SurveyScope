import json
import os
import random
import time
from datetime import datetime, timezone
from tempfile import NamedTemporaryFile

import boto3
from botocore.exceptions import ClientError
import cv2
import kornia as K
import kornia.feature as KF
import numpy as np
import torch
from gql import gql
from gql.client import Client
from gql.transport.requests import RequestsHTTPTransport
from requests_aws4auth import AWS4Auth
from shapely.geometry import Point, Polygon
from torchvision.io import ImageReadMode, read_image

from camera_masks import apply_camera_masks

# LoFTR is trained at 528px short side; matching quality drops sharply off that.
TARGET_SIZE = 528
MAX_SUGGESTED_POINTS = 10
SUGGESTION_GRID = (5, 3)
MIN_HOMOGRAPHY_SEED = 4
MIN_HOMOGRAPHY_INLIERS = 10

torch.set_default_device("cuda")
matcher = KF.LoFTR(pretrained="outdoor")

updateNeighbour = gql("""
mutation MyMutation($homography: [Float], $image1Id: ID!, $image2Id: ID!) {
  updateImageNeighbour(input: {homography: $homography, image1Id: $image1Id, image2Id: $image2Id}) {
    image1Id
    image2Id
  }
}
""")

# On automatic failure, persist best candidate matches as a manual-workbench seed.
updateSuggestions = gql("""
mutation SaveSuggestions($image1Id: ID!, $image2Id: ID!, $suggestedPoints1: [Float], $suggestedPoints2: [Float]) {
  updateImageNeighbour(input: {image1Id: $image1Id, image2Id: $image2Id, suggestedPoints1: $suggestedPoints1, suggestedPoints2: $suggestedPoints2}) {
    image1Id
    image2Id
  }
}
""")

# Each mutation is conditional on a precise prior state — which one succeeds
# tells us whether to bump pairsProcessed. processedAt is invariant once set;
# we never downgrade to failed.
markImageNeighbourProcessedFresh = gql("""
mutation MarkProcessedFresh($image1Id: ID!, $image2Id: ID!, $now: AWSDateTime!) {
  updateImageNeighbour(
    input: {image1Id: $image1Id, image2Id: $image2Id, registrationProcessedAt: $now}
    condition: {registrationProcessedAt: {attributeExists: false}, registrationFailedAt: {attributeExists: false}}
  ) {
    image1Id
    image2Id
  }
}
""")

markImageNeighbourProcessedAfterFail = gql("""
mutation MarkProcessedAfterFail($image1Id: ID!, $image2Id: ID!, $now: AWSDateTime!) {
  updateImageNeighbour(
    input: {image1Id: $image1Id, image2Id: $image2Id, registrationProcessedAt: $now, registrationFailedAt: null}
    condition: {registrationProcessedAt: {attributeExists: false}, registrationFailedAt: {attributeExists: true}}
  ) {
    image1Id
    image2Id
  }
}
""")

markImageNeighbourFailed = gql("""
mutation MarkFailed($image1Id: ID!, $image2Id: ID!, $now: AWSDateTime!) {
  updateImageNeighbour(
    input: {image1Id: $image1Id, image2Id: $image2Id, registrationFailedAt: $now}
    condition: {registrationProcessedAt: {attributeExists: false}, registrationFailedAt: {attributeExists: false}}
  ) {
    image1Id
    image2Id
  }
}
""")

# Composite key (imageId, source) makes duplicate creates fail loudly — swallowed by caller.
createImageProcessedBy = gql("""
mutation CreateProcessedBy($imageId: ID!, $source: String!, $projectId: ID!, $group: String) {
  createImageProcessedBy(input: {imageId: $imageId, source: $source, projectId: $projectId, group: $group}) {
    imageId
    source
  }
}
""")

incrementRegistrationProgress = gql("""
mutation IncProgress($projectId: ID!, $pairsProcessedDelta: Int, $group: String) {
  incrementRegistrationProgress(
    projectId: $projectId
    pairsProcessedDelta: $pairsProcessedDelta
    group: $group
  )
}
""")

incrementRegistrationBucketStat = gql("""
mutation IncBucket($projectId: ID!, $bucketKey: String!, $cameraPairKey: String!, $bucketIndex: Int!, $group: String) {
  incrementRegistrationBucketStat(
    projectId: $projectId
    bucketKey: $bucketKey
    cameraPairKey: $cameraPairKey
    bucketIndex: $bucketIndex
    group: $group
  )
}
""")

sqs = boto3.client("sqs", os.environ["REGION"])
queue_url = os.environ["QUEUE_URL"]

# Keep credentials refreshable: ECS task-role credentials rotate every few hours,
# so pass the live botocore credentials object (not a frozen snapshot) to AWS4Auth.
# A frozen snapshot expires mid-run and every AppSync write fails with
# ExpiredTokenException until the container restarts.
auth = AWS4Auth(
    region=os.environ["REGION"],
    service="appsync",
    refreshable_credentials=boto3.Session().get_credentials(),
)
transport = RequestsHTTPTransport(
    url=os.environ["API_ENDPOINT"],
    headers={"Accept": "application/json", "Content-Type": "application/json"},
    auth=auth,
)
client = Client(transport=transport, fetch_schema_from_transport=False)


def _resize_for_matcher(img):
    height, width = img.shape[1], img.shape[2]
    scale = min(height, width) / TARGET_SIZE
    resized = K.geometry.resize(img, TARGET_SIZE, antialias=True, align_corners=False).unsqueeze(0)
    return resized, scale


def _match(img0, img1):
    resized0, scale0 = _resize_for_matcher(img0)
    resized1, scale1 = _resize_for_matcher(img1)

    with torch.inference_mode():
        correspondences = matcher({"image0": resized0, "image1": resized1})

    # +0.5/-0.5 converts pixel-centre vs pixel-corner conventions (align_corners=False).
    matches0 = (correspondences["keypoints0"].cpu().numpy() + 0.5) * scale0 - 0.5
    matches1 = (correspondences["keypoints1"].cpu().numpy() + 0.5) * scale1 - 0.5
    confidences = correspondences.get("confidence")
    if confidences is not None:
        confidences = confidences.cpu().numpy()
    return matches0, matches1, confidences, max(scale0, scale1)


def _apply_masks(matches0, matches1, confidences, masks):
    polygons = [Polygon(m) for m in masks]
    points = [[Point(x, y) for x, y in pts] for pts in [matches0, matches1]]
    excluded = np.array([p.contains(points) for p in polygons]).any(axis=(0, 1))
    keep = ~excluded
    return matches0[keep], matches1[keep], (confidences[keep] if confidences is not None else None)


def _pick_suggested(matches0, matches1, confidences, homography_mask):
    """Pure-confidence picks cluster on textured regions; grid-binning forces
    coverage. RHO inliers seed when available — plane-consistent → better
    manual anchors than raw matches."""
    count = min(len(matches0), len(matches1))
    if count <= MAX_SUGGESTED_POINTS:
        return matches0, matches1

    picked = []
    chosen = set()

    if homography_mask is not None and int(homography_mask.sum()) >= MIN_HOMOGRAPHY_SEED:
        hom_idx = np.where(homography_mask)[0]
        if confidences is not None:
            hom_idx = hom_idx[np.argsort(-confidences[hom_idx])]
        for i in hom_idx[:MAX_SUGGESTED_POINTS]:
            picked.append(int(i))
            chosen.add(int(i))

    cols, rows = SUGGESTION_GRID
    xs, ys = matches0[:, 0], matches0[:, 1]
    x_range = max(xs.max() - xs.min(), 1e-6)
    y_range = max(ys.max() - ys.min(), 1e-6)
    bx = np.clip(((xs - xs.min()) / x_range * cols).astype(int), 0, cols - 1)
    by = np.clip(((ys - ys.min()) / y_range * rows).astype(int), 0, rows - 1)
    bins = by * cols + bx

    used_bins = {int(bins[i]) for i in picked}

    remaining = np.array([i for i in range(count) if i not in chosen], dtype=int)
    if confidences is not None and len(remaining):
        remaining = remaining[np.argsort(-confidences[remaining])]

    # One top-confidence match per empty cell — kills clustering.
    for i in remaining:
        if len(picked) >= MAX_SUGGESTED_POINTS:
            break
        b = int(bins[i])
        if b in used_bins:
            continue
        picked.append(int(i))
        chosen.add(int(i))
        used_bins.add(b)

    # Top off by raw confidence once cells are exhausted.
    if len(picked) < MAX_SUGGESTED_POINTS:
        for i in remaining:
            if len(picked) >= MAX_SUGGESTED_POINTS:
                break
            if int(i) in chosen:
                continue
            picked.append(int(i))
            chosen.add(int(i))

    idx = np.array(picked[:MAX_SUGGESTED_POINTS])
    return matches0[idx], matches1[idx]


def _save_suggestions(body, matches0, matches1, confidences, homography_mask):
    if len(matches0) == 0 or len(matches1) == 0:
        return
    try:
        matches0, matches1 = _pick_suggested(matches0, matches1, confidences, homography_mask)
        client.execute(updateSuggestions, variable_values={
            "image1Id": body["image1Id"],
            "image2Id": body["image2Id"],
            "suggestedPoints1": matches0.reshape(-1).astype(float).tolist(),
            "suggestedPoints2": matches1.reshape(-1).astype(float).tolist(),
        })
        print(f'Saved {len(matches0)} suggested points for {body["image1Id"]}/{body["image2Id"]}')
    except Exception as e:
        print(f'Failed to persist suggested points for {body["image1Id"]}/{body["image2Id"]}: {e}')


# Below this at 0°, LoFTR is signalling "no visual similarity" — rotating won't recover it.
MIN_RAW_MATCHES_FOR_ROTATION_RETRY = 20


def _unrotate_points(points, rot_k, original_h, original_w):
    if rot_k == 0 or len(points) == 0:
        return points
    x = points[:, 0]
    y = points[:, 1]
    if rot_k == 1:
        new_x = original_w - 1 - y
        new_y = x
    elif rot_k == 2:
        new_x = original_w - 1 - x
        new_y = original_h - 1 - y
    else:  # rot_k == 3
        new_x = y
        new_y = original_h - 1 - x
    return np.stack([new_x, new_y], axis=-1)


def _match_with_rotation(img0, img1, rot_k):
    rotated1 = torch.rot90(img1, rot_k, dims=[-2, -1]) if rot_k else img1
    matches0, matches1, confidences, scale = _match(img0, rotated1)
    if rot_k:
        h, w = img1.shape[1], img1.shape[2]
        matches1 = _unrotate_points(matches1, rot_k, h, w)
    return matches0, matches1, confidences, scale


def _evaluate_attempt(body, matches0, matches1, confidences, scale, shapes):
    """Returns None on degenerate inputs so the rotation loop can move on cleanly."""
    if "masks" in body:
        matches0, matches1, confidences = _apply_masks(matches0, matches1, confidences, body["masks"])
    if body.get("cameraMasks") and len(matches0) > 0:
        matches0, matches1, confidences = apply_camera_masks(
            matches0, matches1, confidences, body["cameraMasks"], shapes
        )
    if len(matches0) < 8:
        return None

    _, epipolar_inliers = cv2.findFundamentalMat(matches0, matches1, cv2.USAC_MAGSAC, scale, 0.999, 100000)
    if epipolar_inliers is None:
        return None
    epipolar_mask = (epipolar_inliers > 0).squeeze()
    inliers0 = matches0[epipolar_mask, :]
    inliers1 = matches1[epipolar_mask, :]
    inlier_confidences = confidences[epipolar_mask] if confidences is not None else None
    if len(inliers0) < 4:
        return None

    homography, homography_inliers = cv2.findHomography(inliers0, inliers1, cv2.RHO, scale * 2)
    if homography is None or homography_inliers is None:
        return None
    homography_mask = homography_inliers.ravel().astype(bool)
    return {
        "homography": homography,
        "inlier_count": int(homography_mask.sum()),
        "inliers0": inliers0,
        "inliers1": inliers1,
        "inlier_confidences": inlier_confidences,
        "homography_mask": homography_mask,
    }


def alignImages(body, img0, img1):
    """Tries img1 at four 90° steps to handle cross-track cameras mounted
    sideways. First attempt clearing MIN_HOMOGRAPHY_INLIERS wins; otherwise
    best-by-inlier-count is saved as suggestions. Returns True iff a homography
    was written."""
    pair_label = f'{body["image1Id"]}/{body["image2Id"]}'
    best_attempt = None
    best_score = None
    best_rot = 0

    shapes = (img0.shape[1:3], img1.shape[1:3])
    for rot_k in range(4):
        matches0, matches1, confidences, scale = _match_with_rotation(img0, img1, rot_k)
        attempt = _evaluate_attempt(body, matches0, matches1, confidences, scale, shapes)

        if attempt is not None:
            if attempt["inlier_count"] > MIN_HOMOGRAPHY_INLIERS:
                client.execute(updateNeighbour, variable_values={
                    "image1Id": body["image1Id"],
                    "image2Id": body["image2Id"],
                    "homography": attempt["homography"].reshape(-1).tolist(),
                })
                print(f'Linked {pair_label} (rotation {rot_k * 90}°, {attempt["inlier_count"]} inliers)')
                return True

            mean_conf = (
                float(attempt["inlier_confidences"].mean())
                if attempt["inlier_confidences"] is not None and len(attempt["inlier_confidences"]) > 0
                else 0.0
            )
            score = (attempt["inlier_count"], mean_conf)
            if best_score is None or score > best_score:
                best_score, best_attempt, best_rot = score, attempt, rot_k

        if rot_k == 0 and len(matches0) < MIN_RAW_MATCHES_FOR_ROTATION_RETRY:
            print(f'Too few raw matches at 0° ({len(matches0)}) for {pair_label}; skipping rotation retries')
            break

    if best_attempt is not None:
        print(f'Failed to link {pair_label} (best: rotation {best_rot * 90}°, {best_attempt["inlier_count"]} inliers)')
        _save_suggestions(
            body,
            best_attempt["inliers0"],
            best_attempt["inliers1"],
            best_attempt["inlier_confidences"],
            best_attempt["homography_mask"],
        )
    else:
        print(f'Failed to link {pair_label} (no usable matches at any rotation)')
    return False


def _is_already_processed_error(exc):
    msg = str(exc)
    return 'ConditionalCheckFailedException' in msg or 'conditional' in msg.lower()


def _is_duplicate_create_error(exc):
    msg = str(exc).lower()
    return (
        'conditionalcheckfailed' in msg.replace(' ', '')
        or 'already exists' in msg
        or 'conflict' in msg
    )


def _is_terminal_for_retry(exc):
    msg = str(exc).lower()
    return (
        'conditionalcheckfailed' in msg.replace(' ', '')
        or 'conditional' in msg
        or 'already exists' in msg
        or 'conflict' in msg
    )


def _exec_with_retry(query, variables, attempts=3):
    last_err = None
    for attempt in range(attempts):
        try:
            return client.execute(query, variable_values=variables)
        except Exception as e:
            if _is_terminal_for_retry(e):
                raise
            last_err = e
            if attempt < attempts - 1:
                time.sleep(0.3 * (2 ** attempt) + random.random() * 0.2)
    raise last_err


def _track_processed(body, homography_written):
    """Two transitions: fresh (bump counter), or upgrade-from-failed (no
    bump — counter was already bumped on the failed mark). Already-processed
    is a no-op."""
    image1Id = body["image1Id"]
    image2Id = body["image2Id"]
    project_id = body.get("projectId")
    group = body.get("group")
    camera_pair_key = body.get("cameraPairKey")
    bucket_index = body.get("bucketIndex")

    if not project_id:
        # Pre-rollout messages lack projectId; skip rather than fail.
        print(f'No projectId in message for {image1Id}/{image2Id}; skipping registration tracking')
        return

    now_iso = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ')

    bump_counter = False
    try:
        _exec_with_retry(markImageNeighbourProcessedFresh, variables={
            "image1Id": image1Id,
            "image2Id": image2Id,
            "now": now_iso,
        })
        bump_counter = True
    except Exception as e:
        if _is_already_processed_error(e):
            # Try upgrade-from-failed; if that also CAS-fails, pair is already processed.
            try:
                _exec_with_retry(markImageNeighbourProcessedAfterFail, variables={
                    "image1Id": image1Id,
                    "image2Id": image2Id,
                    "now": now_iso,
                })
                print(f'Upgraded pair {image1Id}/{image2Id} from failed to processed (no counter bump)')
            except Exception as e2:
                if _is_already_processed_error(e2):
                    print(f'Pair {image1Id}/{image2Id} already processed (SQS redelivery); skipping increments')
                    return
                print(f'Failed to upgrade {image1Id}/{image2Id} from failed to processed: {e2}')
                return
        else:
            print(f'Failed to mark {image1Id}/{image2Id} processed: {e}')
            return

    if bump_counter:
        try:
            _exec_with_retry(incrementRegistrationProgress, variables={
                "projectId": project_id,
                "pairsProcessedDelta": 1,
                "group": group,
            })
        except Exception as e:
            print(f'Failed to increment RegistrationProgress for {project_id}: {e}')

    for img_id in (image1Id, image2Id):
        try:
            _exec_with_retry(createImageProcessedBy, variables={
                "imageId": img_id,
                "source": "registration",
                "projectId": project_id,
                "group": group,
            })
        except Exception as e:
            if not _is_duplicate_create_error(e):
                print(f'Failed to create ImageProcessedBy for image {img_id}: {e}')

    # skipBucketStat locks in an established winner on re-runs — don't drift.
    skip_bucket_stat = bool(body.get("skipBucketStat"))
    if (
        homography_written
        and camera_pair_key is not None
        and bucket_index is not None
        and not skip_bucket_stat
    ):
        bucket_key = f'{camera_pair_key}#{bucket_index}'
        try:
            _exec_with_retry(incrementRegistrationBucketStat, variables={
                "projectId": project_id,
                "bucketKey": bucket_key,
                "cameraPairKey": camera_pair_key,
                "bucketIndex": bucket_index,
                "group": group,
            })
        except Exception as e:
            print(
                f'Failed to increment RegistrationBucketStat '
                f'({project_id}, {bucket_key}): {e}'
            )


def _track_failed(body, error_msg):
    """Bumps pairsProcessed on first failure so the cleanup gate doesn't
    stall even if the message eventually DLQs. CAS prevents double-bumping."""
    image1Id = body["image1Id"]
    image2Id = body["image2Id"]
    project_id = body.get("projectId")
    group = body.get("group")

    if not project_id:
        print(f'No projectId in message for {image1Id}/{image2Id}; skipping failure tracking')
        return

    now_iso = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ')

    try:
        _exec_with_retry(markImageNeighbourFailed, variables={
            "image1Id": image1Id,
            "image2Id": image2Id,
            "now": now_iso,
        })
    except Exception as e:
        if _is_already_processed_error(e):
            print(f'Pair {image1Id}/{image2Id} already tracked; skipping failure bump')
            return
        print(f'Failed to mark {image1Id}/{image2Id} as failed: {e}')
        return

    try:
        _exec_with_retry(incrementRegistrationProgress, variables={
            "projectId": project_id,
            "pairsProcessedDelta": 1,
            "group": group,
        })
    except Exception as e:
        print(f'Failed to increment RegistrationProgress (on failed path) for {project_id}: {e}')

    # Truncate to avoid flooding logs with a poison-pill traceback.
    print(f'Marked pair {image1Id}/{image2Id} as failed: {error_msg[:300]}')


def process(body):
    # Wrap the processing path so any pre-tracking exception (S3, decode,
    # LightGlue) routes through _track_failed — keeps the cleanup gate honest
    # even when a message ends up in the DLQ.
    try:
        s3_client = boto3.client("s3", os.environ["REGION"])
        key0, key1 = body["keys"]
        with NamedTemporaryFile(suffix=os.path.splitext(key0)[1]) as file0, \
             NamedTemporaryFile(suffix=os.path.splitext(key1)[1]) as file1:
            s3_client.download_file(os.environ["BUCKET"], "images/" + key0, file0.name)
            s3_client.download_file(os.environ["BUCKET"], "images/" + key1, file1.name)
            img0 = read_image(file0.name, mode=ImageReadMode.GRAY, apply_exif_orientation=True).to("cuda", dtype=torch.float32) / 255
            img1 = read_image(file1.name, mode=ImageReadMode.GRAY, apply_exif_orientation=True).to("cuda", dtype=torch.float32) / 255
        homography_written = alignImages(body, img0, img1)
    except Exception as e:
        print(f'Processing error for {body.get("image1Id")}/{body.get("image2Id")}: {e}')
        try:
            _track_failed(body, str(e))
        except Exception as track_err:
            print(f'Also failed to track failure: {track_err}')
        # Returning False keeps the message; SQS redelivers up to
        # maxReceiveCount before DLQ.
        return False

    try:
        _track_processed(body, homography_written)
    except Exception as e:
        print(f'Tracking error for {body.get("image1Id")}/{body.get("image2Id")}: {e}')
    return True


# Bump on container-code changes that the deploy diff might consider a no-op.
print("processSQS build: registration-bucketing v6 (rotation-retry on alignImages)")

while True:
    response = sqs.receive_message(
        QueueUrl=queue_url,
        AttributeNames=["SentTimestamp"],
        MaxNumberOfMessages=1,
        MessageAttributeNames=["All"],
        VisibilityTimeout=120,
        WaitTimeSeconds=0,
    )
    try:
        for message in response["Messages"]:
            body = json.loads(message["Body"])
            if process(body):
                sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=message["ReceiptHandle"])
            else:
                # Without a DLQ this can infinite-loop on a poison message.
                print(f'Task {message["Body"]} could not be completed.')
                # Reset visibility to 0 so a failed message retries / reaches the DLQ
                # promptly instead of squatting in flight for the full timeout.
                try:
                    sqs.change_message_visibility(
                        QueueUrl=queue_url,
                        ReceiptHandle=message["ReceiptHandle"],
                        VisibilityTimeout=0,
                    )
                except ClientError as visibility_error:
                    print(f'Failed to reset message visibility: {visibility_error}')
    except KeyError:
        print("Queue empty.")
        time.sleep(60)
