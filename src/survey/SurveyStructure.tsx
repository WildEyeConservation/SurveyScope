import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button, Form, Spinner } from 'react-bootstrap';
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
};

const LIST_ROW_HEIGHT = 37;
const MAX_VISIBLE_ROWS = 10;
const DIVIDER = '1px solid rgba(255, 255, 255, 0.12)';

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
      })
    )
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
        .join(',')
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
}: SurveyStructureProps) {
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'summary' | 'list'>('summary');
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
            row.originalPath.toLowerCase().includes(query)
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

  const effectiveView = search.trim() ? 'list' : viewMode;
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
    'minmax(160px, 2fr) minmax(120px, 1fr) minmax(120px, 1fr) minmax(160px, 1.4fr) minmax(160px, 1.2fr) minmax(90px, 0.8fr)';
  const headers: ReadonlyArray<readonly [SortKey | null, string]> = [
    ['filename', 'Filename'],
    ['camera', 'Camera'],
    ['folder', 'Folder'],
    ['timestamp', 'Timestamp'],
    [null, 'GPS'],
    [null, 'Altitude'],
  ];

  return (
    <div className='d-flex flex-column gap-3'>
      <div className='d-flex justify-content-between align-items-center flex-wrap gap-2'>
        <div
          className='text-uppercase fw-semibold text-muted'
          style={{ letterSpacing: 0.5, fontSize: 12 }}
        >
          Survey Structure{' '}
          <span className='fw-normal ms-1'>
            {flatRows.length.toLocaleString()} image
            {flatRows.length === 1 ? '' : 's'}
          </span>
        </div>
        <Button
          variant='secondary'
          disabled={loading || filteredRows.length === 0}
          onClick={() =>
            downloadCsv(
              `${projectName || 'survey'}-images${
                search.trim() ? '-filtered' : ''
              }.csv`,
              filteredRows
            )
          }
        >
          Export CSV
        </Button>
      </div>
      {loading ? (
        <div className='text-muted'>
          <Spinner animation='border' size='sm' /> Loading structure...
        </div>
      ) : flatRows.length === 0 ? (
        <div className='text-muted small fst-italic'>
          No images uploaded yet.
        </div>
      ) : (
        <>
          <div className='d-flex gap-2 align-items-center flex-wrap'>
            <Form.Control
              type='search'
              placeholder='Search filename, folder, camera, or path...'
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{ maxWidth: 360, flex: '1 1 240px' }}
            />
            {!search.trim() && (
              <div className='d-flex gap-2 ms-auto'>
                <Button
                  variant={
                    viewMode === 'summary' ? 'primary' : 'outline-light'
                  }
                  active={viewMode === 'summary'}
                  onClick={() => setViewMode('summary')}
                >
                  Summary
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'primary' : 'outline-light'}
                  active={viewMode === 'list'}
                  onClick={() => setViewMode('list')}
                >
                  List
                </Button>
              </div>
            )}
            {search.trim() && (
              <>
                <small className='text-muted'>
                  {filteredRows.length} match
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

          {effectiveView === 'summary' ? (
            <div
              className='overflow-auto'
              style={{ maxHeight: 600, fontSize: 13 }}
            >
              {cameras.map((camera, index) => {
                const total = camera.folders.reduce(
                  (sum, folder) => sum + folder.images.length,
                  0
                );

                return (
                  <div key={`${camera.name}-${index}`}>
                    <div
                      className='d-flex justify-content-between align-items-center gap-3 px-3 py-2 fw-semibold'
                      style={{ borderBottom: DIVIDER }}
                    >
                      <span>{camera.name}</span>
                      <small className='text-muted text-end fw-normal'>
                        {camera.folders.length} folder
                        {camera.folders.length === 1 ? '' : 's'} · {total}{' '}
                        image{total === 1 ? '' : 's'}
                      </small>
                    </div>
                    {camera.folders.length === 0 ? (
                      <div
                        className='small fst-italic text-muted ps-4 pe-3 py-2'
                        style={{ borderBottom: DIVIDER }}
                      >
                        No folders
                      </div>
                    ) : (
                      camera.folders.map((folder) => (
                        <div
                          key={folder.path}
                          className='d-flex justify-content-between gap-3 ps-4 pe-3 py-2'
                          style={{ borderBottom: DIVIDER }}
                        >
                          <span>{folder.path}</span>
                          <span className='text-muted'>
                            {folder.imageCount} image
                            {folder.imageCount === 1 ? '' : 's'}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div>
              <div
                className='d-grid text-uppercase fw-semibold text-muted'
                style={{
                  gridTemplateColumns: gridColumns,
                  fontSize: 11,
                  letterSpacing: 0.4,
                  borderBottom: DIVIDER,
                }}
              >
                {headers.map(([key, label]) => (
                  <div
                    key={label}
                    className='px-3 py-2'
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
              <div
                ref={listScrollRef}
                className='overflow-auto'
                style={{
                  height:
                    Math.min(filteredRows.length, MAX_VISIBLE_ROWS) *
                    LIST_ROW_HEIGHT,
                }}
              >
                <div
                  style={{
                    height: rowVirtualizer.getTotalSize(),
                    position: 'relative',
                    width: '100%',
                  }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const row = filteredRows[virtualRow.index];
                    return (
                      <div
                        key={row.id}
                        ref={rowVirtualizer.measureElement}
                        data-index={virtualRow.index}
                        className='d-grid'
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${virtualRow.start}px)`,
                          gridTemplateColumns: gridColumns,
                          fontSize: 13,
                          borderBottom: DIVIDER,
                        }}
                      >
                        <div
                          className='px-3 py-2 text-truncate'
                          title={row.originalPath}
                        >
                          {row.filename}
                        </div>
                        <div className='px-3 py-2'>{row.cameraName}</div>
                        <div className='px-3 py-2'>{row.folder}</div>
                        <div className='px-3 py-2'>
                          {row.timestamp
                            ? new Date(row.timestamp * 1000).toLocaleString()
                            : ''}
                        </div>
                        <div className='px-3 py-2 text-muted'>
                          {row.latitude !== null && row.longitude !== null
                            ? `${row.latitude.toFixed(
                                5
                              )}, ${row.longitude.toFixed(5)}`
                            : '—'}
                        </div>
                        <div className='px-3 py-2 text-muted'>
                          {row.altitude !== null
                            ? `${row.altitude.toFixed(1)} m`
                            : '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <small className='d-block text-muted mt-2'>
                {filteredRows.length.toLocaleString()} row
                {filteredRows.length === 1 ? '' : 's'}
              </small>
              {filteredRows.length === 0 && (
                <div className='text-muted small fst-italic mt-2'>
                  No images match your search.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
