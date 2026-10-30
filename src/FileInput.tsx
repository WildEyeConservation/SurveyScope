import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import {
  collectFilesFromHandle,
  pickDirectory,
  supportsDirectoryPicker,
} from './upload/core/dirHandles';

/** Button-styled file picker that returns selected files as an array. */
// React's DOM types omit Chromium's webkitdirectory attribute.
declare module 'react' {
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    webkitdirectory?: string;
  }
}

export default function FileInput({
  id,
  fileType,
  onFileChange,
  onDirectoryHandle,
  onReadingChange,
  variant,
  buttonSize,
  showSelection = true,
  children,
  ...fileProps
}: {
  id: string;
  fileType?: string;
  onFileChange: (file: File[]) => void;
  /** Directory handle used to resume Chromium folder uploads. */
  onDirectoryHandle?: (handle: unknown) => void;
  onReadingChange?: (reading: boolean) => void;
  variant?: React.ComponentProps<typeof Button>['variant'];
  buttonSize?: React.ComponentProps<typeof Button>['size'];
  showSelection?: boolean;
  children: React.ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const [fileNames, setFileNames] = useState<string[]>([]);
  // null when idle.
  const [readCount, setReadCount] = useState<number | null>(null);

  const {
    onChange: additionalOnChange,
    style: additionalStyle,
    disabled,
    ...otherProps
  } = fileProps;

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const filesArray = Array.from(event.target.files);
      setFileNames(filesArray.map((file) => file.name));
      onFileChange(filesArray);
    }
    if (typeof additionalOnChange === 'function') {
      additionalOnChange(event);
    }
  };

  // Use showDirectoryPicker when possible so callers can persist the handle.
  const isDirectoryPick = fileProps.webkitdirectory !== undefined;
  if (isDirectoryPick && supportsDirectoryPicker()) {
    const handlePick = async () => {
      try {
        const handle = await pickDirectory();
        if (!handle) return;
        setReadCount(0);
        onReadingChange?.(true);
        const files = await collectFilesFromHandle(handle, setReadCount);
        setFileNames([handle.name]);
        onFileChange(files);
        onDirectoryHandle?.(handle);
      } catch (err) {
        console.error('Directory pick failed:', err);
      } finally {
        setReadCount(null);
        onReadingChange?.(false);
      }
    };
    const reading = readCount !== null;
    return (
      <div className='flex flex-row items-center gap-2'>
        <Button
          variant={variant}
          size={buttonSize}
          style={{ width: 'fit-content' }}
          onClick={handlePick}
          disabled={disabled || reading}
        >
          {children}
        </Button>
        {reading ? (
          <span className='flex items-center gap-2'>
            <Spinner animation='border' size='sm' />
            Reading folder... {readCount} files found
          </span>
        ) : (
          showSelection &&
          fileNames.length > 0 && <i className='mb-0'>{fileNames.join(', ')}</i>
        )}
      </div>
    );
  }

  return (
    <div className='flex flex-row items-center gap-2'>
      <Button
        asChild
        variant={variant}
        size={buttonSize}
        style={{ width: 'fit-content' }}
        className={cn(
          'cursor-pointer',
          disabled && 'pointer-events-none opacity-65',
        )}
      >
        <label htmlFor={id} className='mb-0' aria-disabled={disabled}>
          {children}
          <input
            id={id}
            type='file'
            accept={fileType || '*'}
            multiple={true}
            onChange={handleChange}
            disabled={disabled}
            style={{ display: 'none', ...additionalStyle }}
            {...otherProps}
          />
        </label>
      </Button>
      {showSelection && fileNames.length > 0 && (
        <i className='mb-0'>
          {fileNames.join(', ').slice(0, 50)}
          {fileNames.join(', ').length > 50 ? '...' : ''}
        </i>
      )}
    </div>
  );
}
