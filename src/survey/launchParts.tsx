import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { CheckIcon, ChevronRightIcon } from 'lucide-react';
import { Children, useId, useState, type ReactNode } from 'react';

export function LaunchSummary({
  value,
  children,
}: {
  value: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className='flex items-center gap-4 border border-white/15 bg-white/[0.07] px-4 py-3'>
      <span className='text-2xl font-bold tabular-nums'>{value}</span>
      <span className='text-xs leading-snug text-muted-foreground'>
        {children}
      </span>
    </div>
  );
}

export function AdvancedOptions({
  children,
  disabled,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (Children.toArray(children).length === 0) return null;
  return (
    <div className='border-t border-white/10'>
      <button
        type='button'
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className='flex w-full items-center gap-2 py-2 text-left text-sm text-muted-foreground hover:text-foreground disabled:opacity-60'
      >
        <ChevronRightIcon
          className={cn('size-4 transition-transform', open && 'rotate-90')}
        />
        Advanced options
      </button>
      {open && (
        <div className='mb-2 divide-y divide-white/10 border border-white/15 bg-white/[0.07]'>
          {children}
        </div>
      )}
    </div>
  );
}

export function Banner({
  tone,
  children,
}: {
  tone: 'warning' | 'danger' | 'info';
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'border px-3 py-2 text-sm',
        tone === 'warning' && 'border-warning bg-warning/15',
        tone === 'danger' && 'border-danger bg-danger/15',
        tone === 'info' && 'border-white/15 bg-white/[0.07]',
      )}
    >
      {children}
    </div>
  );
}

function RowLabel({
  label,
  hint,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className='mb-0 flex min-w-0 flex-1 cursor-pointer flex-col'
    >
      <span>{label}</span>
      {hint && <span className='text-xs text-muted-foreground'>{hint}</span>}
    </label>
  );
}

// A row inside AdvancedOptions: label on the left, control on the right.
export function SettingRow({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className='flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5'>
      <RowLabel label={label} hint={hint} htmlFor={htmlFor} />
      <div className='w-full sm:w-64'>{children}</div>
    </div>
  );
}

export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className='flex items-center gap-4 px-3 py-2.5'>
      <RowLabel label={label} hint={hint} htmlFor={id} />
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}

export function ChoiceCards<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; title: string; detail: ReactNode }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role='radiogroup'
      aria-label={label}
      className='grid gap-2 sm:grid-cols-2'
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type='button'
            role='radio'
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-center gap-3 border px-4 py-3 text-left transition-colors disabled:opacity-60',
              selected
                ? 'border-primary bg-primary/15'
                : 'border-white/15 bg-white/[0.07] hover:border-white/40',
            )}
          >
            <span className='flex min-w-0 flex-1 flex-col'>
              <span className='font-semibold'>{option.title}</span>
              <span className='text-sm text-muted-foreground'>
                {option.detail}
              </span>
            </span>
            {selected && <CheckIcon className='size-5 shrink-0 text-primary' />}
          </button>
        );
      })}
    </div>
  );
}
