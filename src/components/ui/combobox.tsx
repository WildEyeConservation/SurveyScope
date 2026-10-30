import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { fieldBase, type FieldSize } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { CheckIcon, ChevronDownIcon, XIcon } from 'lucide-react';
import * as React from 'react';

export type ComboboxOption = {
  label: string;
  value: string;
  disabled?: boolean;
};

const triggerSizes: Record<FieldSize, string> = {
  sm: 'min-h-[31px] px-2 py-1 text-sm',
  default: 'min-h-[38px] px-3 py-1.5 text-base',
  lg: 'min-h-[46px] px-4 py-2 text-xl',
};

type BaseComboboxProps = {
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  loadingMessage?: string;
  loading?: boolean;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
  contentClassName?: string;
  id?: string;
  /** Accessible name for the control (the trigger is not a form field). */
  name?: string;
  size?: FieldSize;
  'aria-label'?: string;
};

type SingleComboboxProps = BaseComboboxProps & {
  multiple?: false;
  value: ComboboxOption | null | undefined;
  onChange: (option: ComboboxOption | null) => void;
};

type MultiComboboxProps = BaseComboboxProps & {
  multiple: true;
  value: ComboboxOption[];
  onChange: (options: ComboboxOption[]) => void;
};

export type ComboboxProps = SingleComboboxProps | MultiComboboxProps;

/**
 * Searchable select built from the app's shadcn Popover + Command primitives.
 * Replaces react-select: supports single and multi selection, a clear button,
 * per-chip removal, disabled state and an async-loading message.
 */
export function Combobox(props: ComboboxProps) {
  const {
    options,
    placeholder = 'Select…',
    searchPlaceholder = 'Search…',
    emptyMessage = 'No results found.',
    loadingMessage = 'Loading…',
    loading = false,
    disabled = false,
    clearable = false,
    className,
    contentClassName,
    id,
    size = 'default',
  } = props;
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const selectedValues = props.multiple
    ? props.value.map((option) => option.value)
    : props.value
      ? [props.value.value]
      : [];
  const selectedOption = props.multiple ? null : props.value;
  const hasSelection = selectedValues.length > 0;

  function isSelected(option: ComboboxOption) {
    return selectedValues.includes(option.value);
  }

  function select(option: ComboboxOption) {
    if (props.multiple) {
      props.onChange(
        isSelected(option)
          ? props.value.filter((selected) => selected.value !== option.value)
          : [...props.value, option],
      );
      return;
    }

    props.onChange(option);
    setOpen(false);
  }

  function removeValue(value: string) {
    if (!props.multiple) return;
    props.onChange(props.value.filter((option) => option.value !== value));
  }

  function clear() {
    if (props.multiple) {
      props.onChange([]);
    } else {
      props.onChange(null);
    }
  }

  return (
    <Popover
      modal
      open={open}
      onOpenChange={(next) => !disabled && setOpen(next)}
    >
      <PopoverTrigger asChild>
        <div
          id={id}
          role='combobox'
          aria-expanded={open}
          aria-haspopup='listbox'
          aria-label={props['aria-label'] ?? props.name}
          aria-disabled={disabled || undefined}
          data-slot='combobox'
          data-size={size}
          tabIndex={disabled ? -1 : 0}
          className={cn(
            fieldBase,
            'flex w-full cursor-pointer items-center gap-2 text-left',
            triggerSizes[size],
            open && 'border-[#efb48c] ring-[0.25rem] ring-primary/25',
            disabled &&
              'cursor-not-allowed bg-[#ebebeb] text-secondary hover:bg-[#ebebeb]',
            className,
          )}
          onClick={(event) => {
            if (disabled) event.preventDefault();
          }}
          onKeyDown={(event) => {
            if (disabled) return;
            if (event.key === 'Backspace' || event.key === 'Delete') {
              if (!props.multiple || props.value.length === 0) return;
              event.preventDefault();
              props.onChange(props.value.slice(0, -1));
              return;
            }
            if (
              event.key === 'Enter' ||
              event.key === ' ' ||
              event.key === 'ArrowDown'
            ) {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          <span className='flex min-w-0 flex-1 flex-wrap items-center gap-1'>
            {props.multiple ? (
              props.value.length > 0 ? (
                props.value.map((option) => (
                  <span
                    key={option.value}
                    title={option.label}
                    className='inline-flex max-w-full items-center gap-1 bg-[#e9ecef] px-1.5 py-0.5 text-sm leading-tight text-[#212529]'
                  >
                    <span className='truncate'>{option.label}</span>
                    {!disabled && (
                      <button
                        type='button'
                        tabIndex={-1}
                        aria-label={`Remove ${option.label}`}
                        className='shrink-0 text-[#495057] hover:text-black'
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          removeValue(option.value);
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <XIcon className='size-3' aria-hidden='true' />
                      </button>
                    )}
                  </span>
                ))
              ) : (
                <span className='truncate text-[#6c757d]'>{placeholder}</span>
              )
            ) : selectedOption ? (
              <span className='truncate' title={selectedOption.label}>
                {selectedOption.label}
              </span>
            ) : (
              <span className='truncate text-[#6c757d]'>{placeholder}</span>
            )}
          </span>
          <span className='flex shrink-0 items-center gap-1'>
            {clearable && hasSelection && !disabled && (
              <button
                type='button'
                tabIndex={-1}
                aria-label='Clear selection'
                className='text-[#6c757d] hover:text-[#212529]'
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  clear();
                }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <XIcon className='size-4' aria-hidden='true' />
              </button>
            )}
            <ChevronDownIcon
              aria-hidden='true'
              className={cn(
                'size-4 shrink-0 text-[#6c757d] transition-transform',
                open && 'rotate-180',
              )}
            />
          </span>
        </div>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        sideOffset={2}
        className={cn(
          'w-(--radix-popover-trigger-width) min-w-[10rem] border-black/15 bg-white p-0 text-[#212529] shadow-lg',
          contentClassName,
        )}
        onOpenAutoFocus={(event) => {
          // Let the search field take focus so typing filters immediately.
          const input = (event.currentTarget as HTMLElement).querySelector(
            '[data-slot=command-input]',
          );
          if (input instanceof HTMLElement) {
            event.preventDefault();
            input.focus();
          }
        }}
      >
        <Command className='bg-white text-[#212529] [&_[data-slot=command-input-wrapper]]:border-black/15'>
          <CommandInput
            placeholder={searchPlaceholder}
            className='h-9 py-2 text-base placeholder:text-[#6c757d]'
            autoFocus
          />
          <CommandList>
            {loading && options.length === 0 ? (
              <div className='py-4 text-center text-sm'>{loadingMessage}</div>
            ) : (
              <CommandEmpty>{emptyMessage}</CommandEmpty>
            )}
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  keywords={[option.label]}
                  disabled={option.disabled}
                  onSelect={() => select(option)}
                  className={cn(
                    'text-base text-[#212529] data-[selected=true]:bg-[#deebff] data-[selected=true]:text-[#212529]',
                    isSelected(option) &&
                      'bg-[#2684ff] text-white data-[selected=true]:bg-[#2684ff] data-[selected=true]:text-white',
                  )}
                >
                  <CheckIcon
                    aria-hidden='true'
                    className={cn(
                      'size-4 shrink-0 text-current',
                      isSelected(option) ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className='min-w-0 leading-snug break-words whitespace-normal'>
                    {option.label}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
