import { cn } from '@/lib/utils';
import React, { useEffect, useRef, useState } from 'react';

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
        [] as string[],
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
    <div className='flex flex-wrap items-center gap-1 text-sm'>
      {segments.map((seg, idx) => (
        <React.Fragment key={idx}>
          <button
            type='button'
            aria-pressed={idx === selectedLevel}
            onClick={() => handleClick(idx)}
            className={cn(
              'border px-2 py-0.5 transition-colors',
              idx === selectedLevel
                ? 'border-primary bg-primary text-white'
                : 'border-white/30 text-muted-foreground hover:bg-white/10',
            )}
          >
            {seg}
          </button>
          {idx < segments.length - 1 && (
            <span className='text-muted-foreground'>/</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
