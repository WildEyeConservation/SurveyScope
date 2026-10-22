import { Form, Button } from 'react-bootstrap';
import { useMemo, useEffect, Dispatch, SetStateAction } from 'react';

export default function CameraOverlap({
  cameraSelection,
  overlaps,
  setOverlaps,
  lockedOverlaps = [],
}: {
  cameraSelection: [string, string[]];
  overlaps: { cameraA: string; cameraB: string }[];
  setOverlaps: Dispatch<SetStateAction<{ cameraA: string; cameraB: string }[]>>;
  // Saved overlaps, shown read-only.
  lockedOverlaps?: { cameraA: string; cameraB: string }[];
}) {
  const cameraList = useMemo(() => cameraSelection[1], [cameraSelection]);

  useEffect(() => {
    if (cameraSelection) {
      setOverlaps([]);
    }
  }, [cameraSelection]);

  return (
    <div>
      <Form.Group className='mt-3'>
        <Form.Label className='mb-0'>Define Overlap Between Cameras</Form.Label>
        <span className='text-muted d-block mb-2' style={{ fontSize: '12px' }}>
          Leave blank if cameras are not overlapping.
          {lockedOverlaps.length > 0 &&
            ' Overlaps saved on this survey cannot be changed here.'}
        </span>
        {lockedOverlaps.map(({ cameraA, cameraB }) => (
          <div
            className='d-flex align-items-center mb-2'
            key={`saved-${cameraA}-${cameraB}`}
          >
            <Form.Select
              aria-label={`Saved overlap camera ${cameraA}`}
              value={cameraA}
              disabled
              className='me-2'
            >
              <option value={cameraA}>{cameraA}</option>
            </Form.Select>
            <Form.Select
              aria-label={`Saved overlap camera ${cameraB}`}
              value={cameraB}
              disabled
            >
              <option value={cameraB}>{cameraB}</option>
            </Form.Select>
          </div>
        ))}
        {overlaps.map((pair, idx) => {
          const usedPairs = [
            ...lockedOverlaps,
            ...overlaps.filter(
              (_, j) => j !== idx && overlaps[j].cameraA && overlaps[j].cameraB
            ),
          ].map(({ cameraA, cameraB }) => [cameraA, cameraB].sort().join('-'));
          const bOptions = cameraList.filter(
            (cam) =>
              cam !== pair.cameraA &&
              !usedPairs.includes([pair.cameraA, cam].sort().join('-'))
          );
          return (
            <div className='d-flex align-items-center mb-2' key={idx}>
              <Form.Select
                aria-label={`Camera A for overlap ${idx + 1}`}
                value={pair.cameraA}
                onChange={(e) => {
                  const newA = e.target.value;
                  setOverlaps((ov) => {
                    const newOv = [...ov];
                    newOv[idx] = { cameraA: newA, cameraB: '' };
                    return newOv;
                  });
                }}
                className='me-2'
              >
                <option value=''>Select camera</option>
                {cameraList.map((cam) => (
                  <option key={cam} value={cam}>
                    {cam}
                  </option>
                ))}
              </Form.Select>
              <Form.Select
                aria-label={`Camera B for overlap ${idx + 1}`}
                value={pair.cameraB}
                onChange={(e) => {
                  const newB = e.target.value;
                  setOverlaps((ov) => {
                    const newOv = [...ov];
                    newOv[idx] = { ...newOv[idx], cameraB: newB };
                    return newOv;
                  });
                }}
              >
                <option value=''>Select camera</option>
                {bOptions.map((cam) => (
                  <option key={cam} value={cam}>
                    {cam}
                  </option>
                ))}
              </Form.Select>
              <Button
                variant='danger'
                onClick={() =>
                  setOverlaps((ov) => ov.filter((_, j) => j !== idx))
                }
                className='ms-2'
              >
                Remove
              </Button>
            </div>
          );
        })}
        <Button
          variant='info'
          size='sm'
          disabled={
            overlaps.length > 0 &&
            (!overlaps[overlaps.length - 1].cameraA ||
              !overlaps[overlaps.length - 1].cameraB)
          }
          onClick={() =>
            setOverlaps((ov) => [...ov, { cameraA: '', cameraB: '' }])
          }
        >
          Add Overlap
        </Button>
      </Form.Group>
    </div>
  );
}
