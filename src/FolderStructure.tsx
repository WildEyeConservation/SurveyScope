import React, { useState, useEffect, useRef } from 'react';
import { Button, Form } from 'react-bootstrap';

interface FolderStructureProps {
  files: File[];
  onCameraLevelChange: (selection: [string, string[]]) => void;
}

export default function FolderStructure({
  files,
  onCameraLevelChange,
}: FolderStructureProps) {
  const [segments, setSegments] = useState<string[]>([]);
  const [selectedLevel, setSelectedLevel] = useState<number>(0);
  const userLevelRef = useRef<number | null>(null);

  useEffect(() => {
    if (files && files.length > 0) {
      const paths = files.map((f) => f.webkitRelativePath || '');
      const dirArrays = paths.map((path) => {
        const parts = path.split('/');
        if (parts.length > 1) parts.pop();
        return parts;
      });
      const deepest = dirArrays.reduce(
        (prev, curr) => (curr.length > prev.length ? curr : prev),
        [] as string[]
      );
      setSegments(deepest);
      const initialIdx =
        userLevelRef.current !== null && userLevelRef.current < deepest.length
          ? userLevelRef.current
          : deepest.length - 1;
      setSelectedLevel(initialIdx);
      const cameras = dirArrays
        .filter((arr) => arr.length > initialIdx)
        .map((arr) => arr[initialIdx]);
      const uniqueCameras = Array.from(new Set(cameras));
      const folderName = deepest[initialIdx];
      onCameraLevelChange([folderName, uniqueCameras]);
    } else {
      setSegments([]);
      setSelectedLevel(0);
    }
  }, [files, onCameraLevelChange]);

  const handleClick = (idx: number) => {
    userLevelRef.current = idx;
    setSelectedLevel(idx);
    const dirArrays = files.map((f) => {
      const parts = f.webkitRelativePath.split('/');
      if (parts.length > 1) parts.pop();
      return parts;
    });
    const cameras = dirArrays
      .filter((arr) => arr.length > idx)
      .map((arr) => arr[idx]);
    const uniqueCameras = Array.from(new Set(cameras));
    const folderName = segments[idx];
    onCameraLevelChange([folderName, uniqueCameras]);
  };

  if (segments.length === 0) return null;

  return (
    <Form.Group className='mt-2'>
      <Form.Label className='mb-0'>Folder Structure</Form.Label>
      <span className='text-muted d-block mb-2' style={{ fontSize: '12px' }}>
        Select the camera folder level.
      </span>
      <div>
        {segments.map((seg, idx) => (
          <React.Fragment key={idx}>
            <Button
              variant='outline-primary'
              type='button'
              size='sm'
              onClick={() => handleClick(idx)}
              style={{
                borderRadius: '5px',
                color: idx === selectedLevel ? '#fff' : '',
                backgroundColor:
                  idx === selectedLevel ? 'var(--bs-primary)' : '',
                padding: '2px 8px',
              }}
            >
              {seg}
            </Button>
            {idx < segments.length - 1 && <span className='mx-1'>/</span>}
          </React.Fragment>
        ))}
      </div>
    </Form.Group>
  );
}
