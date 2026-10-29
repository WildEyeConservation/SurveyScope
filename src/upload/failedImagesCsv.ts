import { escapeCsvValue } from '../../shared/csv';

export interface FailedImageRow {
  originalPath: string;
  reason: string;
  /** Machine-readable failure grouping. */
  category?: string;
}

export function failedImagesCsvName(
  rows: FailedImageRow[],
  fallback: string
): string {
  const roots = new Set(rows.map((row) => row.originalPath.split(/[/\\]/)[0]));
  const base = roots.size === 1 ? [...roots][0] : fallback;
  return `failed-images_${base}_${new Date().toISOString().slice(0, 10)}.csv`;
}

export function downloadFailedImagesCsv(
  filename: string,
  rows: FailedImageRow[]
): void {
  const lines = [
    ['originalPath', 'filename', 'reason', 'category'].join(','),
    ...rows.map((row) =>
      [
        row.originalPath,
        row.originalPath.split(/[/\\]/).pop() ?? row.originalPath,
        row.reason,
        row.category ?? '',
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
