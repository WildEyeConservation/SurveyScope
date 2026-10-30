import { useEffect, useState, type ReactNode } from 'react';
import { PencilIcon } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

/** done: false greys out a step that was skipped. */
export interface ChecklistLine {
  text: ReactNode;
  done?: boolean;
}

export interface ChecklistItem {
  key: string;
  title: string;
  lines: ChecklistLine[];
  /** Shown in red; the step needs another look. */
  problem?: ReactNode;
  onEdit?: () => void;
}

export default function UploadChecklist({
  items,
  onCompleteChange,
}: {
  items: ChecklistItem[];
  onCompleteChange?: (complete: boolean) => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const done = items.filter((item) => checked.has(item.key)).length;
  const complete = items.length > 0 && done === items.length;

  useEffect(() => {
    onCompleteChange?.(complete);
  }, [complete, onCompleteChange]);

  const toggle = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center gap-3'>
        <span className='text-sm'>
          Check each step before you continue.
        </span>
        <span className='ml-auto text-xs text-muted-foreground'>
          {done} of {items.length} checked
        </span>
      </div>
      <div className='h-1 bg-white/15'>
        <div
          className='h-full bg-success transition-[width]'
          style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }}
        />
      </div>
      <div className='grid gap-3 md:grid-cols-2'>
        {items.map((item) => {
          const isChecked = checked.has(item.key);
          const id = `checklist-${item.key}`;
          return (
            <div
              key={item.key}
              className={cn(
                'flex gap-3 border p-3 transition-colors',
                isChecked
                  ? 'border-success/70 bg-success/10'
                  : 'border-white/15 bg-white/[0.07]'
              )}
            >
              <Checkbox
                id={id}
                className='mt-0.5'
                checked={isChecked}
                onCheckedChange={() => toggle(item.key)}
              />
              <div className='flex min-w-0 flex-1 flex-col gap-1'>
                <div className='flex items-center gap-2'>
                  <label
                    htmlFor={id}
                    className='mb-0 flex-1 cursor-pointer font-semibold'
                  >
                    {item.title}
                  </label>
                  {item.onEdit && (
                    <button
                      type='button'
                      onClick={item.onEdit}
                      className='flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground'
                    >
                      <PencilIcon className='size-3' />
                      Edit
                    </button>
                  )}
                </div>
                <ul className='m-0 flex list-disc flex-col gap-1 pl-5 text-sm marker:text-muted-foreground'>
                  {item.lines.map((line, index) => (
                    <li
                      key={index}
                      className={cn(line.done === false && 'text-muted-foreground')}
                    >
                      {line.text}
                    </li>
                  ))}
                </ul>
                {item.problem && (
                  <div className='text-sm text-danger'>{item.problem}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
