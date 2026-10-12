import { useState } from 'react';
import { Button, Spinner } from 'react-bootstrap';
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
  children,
  ...fileProps
}: {
  id: string;
  fileType?: string;
  onFileChange: (file: File[]) => void;
  /** Directory handle used to resume Chromium folder uploads. */
  onDirectoryHandle?: (handle: unknown) => void;
  onReadingChange?: (reading: boolean) => void;
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
      <div className='d-flex flex-row align-items-center gap-2'>
        <Button
          style={{ width: 'fit-content' }}
          onClick={handlePick}
          disabled={disabled || reading}
        >
          {children}
        </Button>
        {reading ? (
          <span className='d-flex align-items-center gap-2'>
            <Spinner animation='border' size='sm' />
            Reading folder... {readCount} files found
          </span>
        ) : (
          fileNames.length > 0 && <i className='mb-0'>{fileNames.join(', ')}</i>
        )}
      </div>
    );
  }

  return (
    <div className='d-flex flex-row align-items-center gap-2'>
      <Button
        style={{ width: 'fit-content' }}
        as='label'
        htmlFor={id}
        disabled={disabled}
        className={disabled ? 'disabled' : undefined}
      >
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
      </Button>
      {fileNames.length > 0 && (
        <i className='mb-0'>
          {fileNames.join(', ').slice(0, 50)}
          {fileNames.join(', ').length > 50 ? '...' : ''}
        </i>
      )}
    </div>
  );
}
