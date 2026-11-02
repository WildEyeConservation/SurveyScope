import { Spinner } from '@/components/ui/spinner';
import { CheckIcon } from 'lucide-react';

// One row per fetch with its live count, so a slow load reads as working.
export type LoadProgressRow = {
  label: string;
  count: number;
  done: boolean;
};

export function LoadingProgressCard({
  title,
  rows,
}: {
  title: string;
  rows: LoadProgressRow[];
}) {
  return (
    <div className='flex flex-col gap-2 border border-white/15 bg-white/[0.07] px-4 py-3 text-sm'>
      <span className='flex items-center gap-2'>
        <Spinner animation='border' size='sm' />
        {title}
      </span>
      <div className='flex flex-col gap-1 text-xs tabular-nums'>
        {rows.map(({ label, count, done }) => (
          <div key={label} className='flex items-center justify-between gap-6'>
            <span className='flex items-center gap-2 text-muted-foreground'>
              {done ? (
                <CheckIcon className='size-3.5 text-success' />
              ) : (
                <Spinner
                  animation='border'
                  style={{ width: 12, height: 12, borderWidth: 2 }}
                />
              )}
              {label}
            </span>
            <span className='font-semibold'>{count.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
