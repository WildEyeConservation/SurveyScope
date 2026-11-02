import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useVirtualizer } from '@tanstack/react-virtual';
import { DownloadIcon, SearchIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { escapeCsvValue } from '../../shared/csv';

export type ImageInfo = {
  id: string;
  originalPath: string;
  cameraId?: string;
  latitude?: number | null;
  longitude?: number | null;
  altitude_agl?: number | null;
  altitude_wgs84?: number | null;
  timestamp?: number | null;
};

export type Folder = {
  path: string;
  imageCount: number;
  images: ImageInfo[];
};

export type Camera = {
  name: string;
  folders: Folder[];
};

type FlatRow = {
  id: string;
  cameraName: string;
  folder: string;
  filename: string;
  originalPath: string;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  timestamp: number | null;
};

type SortKey = 'filename' | 'camera' | 'folder' | 'timestamp';

type SurveyStructureProps = {
  cameras: Camera[];
  projectName: string;
  loading: boolean;
  loadedCount?: number;
};

const LIST_ROW_HEIGHT = 37;
const MAX_VISIBLE_ROWS = 10;
const FOLDER_COLOURS = [
  '#f28c3c',
  '#4fc3c9',
  '#e5c454',
  '#9b8ce0',
  '#7cc576',
  '#ef7aa1',
  '#6fa8e8',
  '#c9a27a',
];

function flattenRows(cameras: Camera[]): FlatRow[] {
  return cameras.flatMap((camera) =>
    camera.folders.flatMap((folder) =>
      folder.images.map((image) => {
        const pathParts = image.originalPath
          .split(/[/\\]/)
          .filter((part) => part.length > 0);

        return {
          id: image.id,
          cameraName: camera.name,
          folder: folder.path,
          filename: pathParts[pathParts.length - 1] ?? image.originalPath,
          originalPath: image.originalPath,
          latitude: Number.isFinite(image.latitude)
            ? (image.latitude as number)
            : null,
          longitude: Number.isFinite(image.longitude)
            ? (image.longitude as number)
            : null,
          altitude: Number.isFinite(image.altitude_agl)
            ? (image.altitude_agl as number)
            : Number.isFinite(image.altitude_wgs84)
              ? (image.altitude_wgs84 as number)
              : null,
          timestamp: image.timestamp ?? null,
        };
      }),
    ),
  );
}

function downloadCsv(filename: string, rows: FlatRow[]) {
  const lines = [
    [
      'id',
      'camera',
      'folder',
      'filename',
      'originalPath',
      'latitude',
      'longitude',
      'altitude_m',
      'timestamp',
    ].join(','),
    ...rows.map((row) =>
      [
        row.id,
        row.cameraName,
        row.folder,
        row.filename,
        row.originalPath,
        row.latitude,
        row.longitude,
        row.altitude,
        row.timestamp ? new Date(row.timestamp * 1000).toISOString() : '',
      ]
        .map(escapeCsvValue)
        .join(','),
    ),
  ];
  const blob = new Blob([lines.join('\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export default function SurveyStructure({
  cameras,
  projectName,
  loading,
  loadedCount = 0,
}: SurveyStructureProps) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('filename');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const listScrollRef = useRef<HTMLDivElement | null>(null);

  const flatRows = useMemo(() => flattenRows(cameras), [cameras]);
  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matchingRows = query
      ? flatRows.filter(
          (row) =>
            row.filename.toLowerCase().includes(query) ||
            row.folder.toLowerCase().includes(query) ||
            row.cameraName.toLowerCase().includes(query) ||
            row.originalPath.toLowerCase().includes(query),
        )
      : flatRows;

    return [...matchingRows].sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'filename') {
        comparison = a.filename.localeCompare(b.filename);
      } else if (sortBy === 'camera') {
        comparison =
          a.cameraName.localeCompare(b.cameraName) ||
          a.filename.localeCompare(b.filename);
      } else if (sortBy === 'folder') {
        comparison =
          a.folder.localeCompare(b.folder) ||
          a.filename.localeCompare(b.filename);
      } else {
        comparison = (a.timestamp ?? 0) - (b.timestamp ?? 0);
      }

      return sortDir === 'asc' ? comparison : -comparison;
    });
  }, [flatRows, search, sortBy, sortDir]);

  const searching = search.trim().length > 0;
  const folderColour = useMemo(() => {
    const colours = new Map<string, string>();
    for (const camera of cameras) {
      for (const folder of camera.folders) {
        if (!colours.has(folder.path)) {
          colours.set(
            folder.path,
            FOLDER_COLOURS[colours.size % FOLDER_COLOURS.length],
          );
        }
      }
    }
    return colours;
  }, [cameras]);
  const rowVirtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => LIST_ROW_HEIGHT,
    overscan: 12,
  });

  useEffect(() => {
    rowVirtualizer.scrollToIndex(0);
  }, [search, sortBy, sortDir, rowVirtualizer]);

  const changeSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir('asc');
    }
  };

  const gridColumns =
    'minmax(0, 2fr) minmax(0, 1.2fr) minmax(0, 1.2fr) 180px 170px 84px';
  const headers: ReadonlyArray<readonly [SortKey | null, string]> = [
    ['filename', 'Filename'],
    ['camera', 'Camera'],
    ['folder', 'Folder'],
    ['timestamp', 'Timestamp'],
    [null, 'GPS'],
    [null, 'Altitude'],
  ];

  return (
    <div className='mt-6 flex flex-col gap-3'>
      <SectionTitle
        action={
          <Button
            variant='outline-light'
            size='sm'
            disabled={loading || filteredRows.length === 0}
            onClick={() =>
              downloadCsv(
                `${projectName || 'survey'}-images${
                  searching ? '-filtered' : ''
                }.csv`,
                filteredRows,
              )
            }
          >
            <DownloadIcon className='size-3.5' />
            Export CSV
          </Button>
        }
      >
        Cameras and folders
      </SectionTitle>
      {loading ? (
        <div className='text-muted-foreground'>
          <Spinner animation='border' size='sm' /> Loading images
          {loadedCount > 0 && ` · ${loadedCount.toLocaleString()} loaded`}...
        </div>
      ) : flatRows.length === 0 ? (
        <div className='text-sm text-muted-foreground italic'>
          No images uploaded yet.
        </div>
      ) : (
        <>
          <div className='flex items-center gap-3'>
            <div className='relative flex-1'>
              <SearchIcon className='pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-[#6c757d]' />
              <Input
                type='search'
                aria-label='Find an image'
                placeholder='Find an image by name, folder or path…'
                className='pl-9'
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            {searching && (
              <>
                <small className='text-muted-foreground'>
                  {filteredRows.length.toLocaleString()} match
                  {filteredRows.length === 1 ? '' : 'es'}
                </small>
                <Button
                  variant='link'
                  size='sm'
                  className='p-0'
                  onClick={() => setSearch('')}
                >
                  Clear
                </Button>
              </>
            )}
          </div>

          {!searching ? (
            <div className='flex flex-col gap-2'>
              {cameras.map((camera, index) => (
                <CameraSplit
                  key={`${camera.name}-${index}`}
                  camera={camera}
                  colourFor={(path) => folderColour.get(path) ?? '#adb5bd'}
                />
              ))}
            </div>
          ) : (
            <div className='border border-white/15 bg-white/[0.07] text-[13px]'>
              <div
                className='grid [scrollbar-gutter:stable] overflow-hidden border-b border-white/15 bg-black/15 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase'
                style={{ gridTemplateColumns: gridColumns }}
              >
                {headers.map(([key, label]) => (
                  <div
                    key={label}
                    className={cn(
                      'truncate px-3 py-2',
                      key && 'cursor-pointer hover:text-foreground',
                      label === 'Altitude' && 'text-right',
                    )}
                    role={key ? 'button' : undefined}
                    tabIndex={key ? 0 : undefined}
                    onClick={key ? () => changeSort(key) : undefined}
                    onKeyDown={
                      key
                        ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              changeSort(key);
                            }
                          }
                        : undefined
                    }
                  >
                    {label}
                    {key && sortBy === key
                      ? sortDir === 'asc'
                        ? ' ▲'
                        : ' ▼'
                      : ''}
                  </div>
                ))}
              </div>
              {filteredRows.length === 0 ? (
                <div className='px-3 py-4 text-muted-foreground italic'>
                  No images match your search.
                </div>
              ) : (
                <div
                  ref={listScrollRef}
                  className='[scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.3)_transparent] [scrollbar-gutter:stable] overflow-auto'
                  style={{
                    height:
                      Math.min(filteredRows.length, MAX_VISIBLE_ROWS) *
                      LIST_ROW_HEIGHT,
                  }}
                >
                  <div
                    className='relative w-full'
                    style={{ height: rowVirtualizer.getTotalSize() }}
                  >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const row = filteredRows[virtualRow.index];
                      return (
                        <div
                          key={row.id}
                          ref={rowVirtualizer.measureElement}
                          data-index={virtualRow.index}
                          className='absolute top-0 left-0 grid w-full border-b border-white/[0.08] whitespace-nowrap hover:bg-white/5 [&>div]:truncate [&>div]:px-3 [&>div]:py-2'
                          style={{
                            transform: `translateY(${virtualRow.start}px)`,
                            gridTemplateColumns: gridColumns,
                          }}
                        >
                          <div title={row.originalPath}>{row.filename}</div>
                          <div title={row.cameraName}>{row.cameraName}</div>
                          <div title={row.folder}>{row.folder}</div>
                          <div className='tabular-nums'>
                            {row.timestamp
                              ? new Date(row.timestamp * 1000).toLocaleString()
                              : '—'}
                          </div>
                          <div className='text-muted-foreground tabular-nums'>
                            {row.latitude !== null && row.longitude !== null
                              ? `${row.latitude.toFixed(
                                  5,
                                )}, ${row.longitude.toFixed(5)}`
                              : '—'}
                          </div>
                          <div className='text-right text-muted-foreground tabular-nums'>
                            {row.altitude !== null
                              ? `${row.altitude.toFixed(1)} m`
                              : '—'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function SectionTitle({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mt-3 mb-1 flex items-center border-b border-white/10 pb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase first:mt-0',
        className,
      )}
    >
      {children}
      {action && <div className='ml-auto normal-case'>{action}</div>}
    </div>
  );
}

function CameraSplit({
  camera,
  colourFor,
}: {
  camera: Camera;
  colourFor: (path: string) => string;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [barWidth, setBarWidth] = useState(0);
  const total = camera.folders.reduce(
    (sum, folder) => sum + folder.imageCount,
    0,
  );

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const observer = new ResizeObserver(([entry]) =>
      setBarWidth(entry.contentRect.width),
    );
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  return (
    <div className='flex flex-col gap-2 border border-white/15 bg-white/[0.07] px-4 py-3'>
      <span className='truncate font-semibold' title={camera.name}>
        {camera.name}
      </span>
      {total === 0 ? (
        <span className='text-sm text-muted-foreground italic'>No images</span>
      ) : (
        <div ref={barRef} className='flex h-6 gap-0.5'>
          {camera.folders
            .filter((folder) => folder.imageCount > 0)
            .map((folder) => {
              const label = folder.imageCount.toLocaleString();
              const width = (folder.imageCount / total) * barWidth;
              return (
                <div
                  key={folder.path}
                  className='flex min-w-1 items-center justify-center overflow-hidden text-xs font-bold whitespace-nowrap text-[#1d2731]'
                  style={{
                    flex: folder.imageCount,
                    backgroundColor: colourFor(folder.path),
                  }}
                  title={`${folder.path} · ${label} image${
                    folder.imageCount === 1 ? '' : 's'
                  }`}
                >
                  {width >= label.length * 7 + 12 && label}
                </div>
              );
            })}
        </div>
      )}
      <div className='flex items-start gap-4'>
        <div className='flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1 text-sm'>
          {camera.folders.map((folder) => (
            <span key={folder.path} className='flex items-center gap-1.5'>
              <span
                className='size-2.5 shrink-0'
                style={{ backgroundColor: colourFor(folder.path) }}
              />
              {folder.path}
            </span>
          ))}
        </div>
        <span className='shrink-0 text-xs text-muted-foreground'>
          {total.toLocaleString()} image{total === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}
