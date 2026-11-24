import { Spinner } from '@/components/ui/spinner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { CropView } from './CropView';
import { cropQuery } from './data';
import { EmptyNotice } from './EmptyNotice';
import { useLabelGallery, useNotebookScope } from './hooks';
import type { LabelRef, NotebookExample } from './types';

const BEHIND = 1;
const AHEAD = 3;

function Badge({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`${className} px-1.5 text-xs leading-5 font-bold text-white`}
    >
      {children}
    </span>
  );
}

export function ExamplePager({
  label,
  scale,
  onScale,
  viewerRef,
  onCurrent,
  onViewerKey,
}: {
  label: LabelRef;
  scale: number | null;
  onScale: (scale: number) => void;
  viewerRef: React.MutableRefObject<HTMLDivElement | null>;
  onCurrent: (item: NotebookExample | null) => void;
  onViewerKey: (event: React.KeyboardEvent) => void;
}) {
  const scope = useNotebookScope();
  const queryClient = useQueryClient();
  const gallery = useLabelGallery(label);
  const key = `${label.projectId}/${label.name}`;
  const [position, setPosition] = useState({ key, index: 0 });
  const [zoomKey, setZoomKey] = useState(0);
  const items = gallery.items;
  const index =
    position.key === key ? Math.min(position.index, items.length - 1) : 0;
  const item = items[index] ?? null;
  useEffect(() => onCurrent(item), [onCurrent, item]);

  const crop = useQuery({
    ...cropQuery(scope, item?.token ?? ''),
    enabled: Boolean(item),
  });
  useEffect(() => {
    for (let i = index - BEHIND; i <= index + AHEAD; i++) {
      const near = items[i];
      if (near && i !== index)
        void queryClient.prefetchQuery(cropQuery(scope, near.token));
    }
  }, [items, index, scope, queryClient]);

  const step = (delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= items.length) return;
    setPosition({ key, index: next });
  };

  const status = gallery.error
    ? 'Could not load examples for this label.'
    : !item
      ? !gallery.loading && gallery.empty
        ? 'No examples to show.'
        : null
      : crop.isError || (crop.isSuccess && !crop.data)
        ? 'This image is unavailable.'
        : null;
  const loading = !status && (gallery.loading || crop.isLoading);

  return (
    <div className='flex min-h-0 min-w-0 flex-1 flex-col gap-3'>
      {gallery.empty && (
        <EmptyNotice
          name={label.name}
          loading={gallery.loading}
          borrowedSurveys={gallery.borrowedSurveys}
          hasExamples={items.length > 0}
        />
      )}
      <div
        ref={viewerRef}
        tabIndex={0}
        role='group'
        aria-roledescription='example viewer'
        aria-label={`${label.name} examples`}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            step(event.key === 'ArrowLeft' ? -1 : 1);
          } else if (event.key === '+' || event.key === '=') {
            setZoomKey((k) => k + 1);
          } else if (event.key === '-') {
            setZoomKey((k) => k - 1);
          } else {
            onViewerKey(event);
          }
        }}
        className='relative min-h-0 flex-1 overflow-hidden bg-[#1f2933] outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        {(status || loading) && (
          <div className='absolute inset-0 flex items-center justify-center gap-2 text-sm text-[#bcccdc]'>
            {status ?? <Spinner size='sm' />}
          </div>
        )}
        {item && crop.data && (
          <CropView
            crop={crop.data}
            color={gallery.color}
            scale={scale}
            onScale={onScale}
            zoomKey={zoomKey}
          />
        )}
        {item && (
          <div className='pointer-events-none absolute bottom-2.5 left-2.5 z-10 flex gap-1'>
            {item.reviewed && <Badge className='bg-success'>QC ✓</Badge>}
            {item.model && <Badge className='bg-secondary'>Model</Badge>}
            {item.borrowed && <Badge className='bg-info'>Other survey</Badge>}
          </div>
        )}
        {items.length > 0 && (
          <div className='pointer-events-none absolute right-2.5 bottom-2.5 z-10 bg-black/50 px-1.5 text-xs leading-5 text-white'>
            {index + 1} / {items.length}
          </div>
        )}
      </div>
    </div>
  );
}
