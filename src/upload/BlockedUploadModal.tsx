import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table } from '@/components/ui/table';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { BlockedItem } from './core/types';
import {
  downloadFailedImagesCsv,
  failedImagesCsvName,
} from './failedImagesCsv';

const PREVIEW_ROWS = 20;

interface BlockedUploadModalProps {
  show: boolean;
  blocked: BlockedItem[];
  /** CSV filename fallback when the paths have no common root. */
  projectId: string;
  onClose: () => void;
  onRetry: () => void;
  onContinueWithout: () => void;
}

export default function BlockedUploadModal({
  show,
  blocked,
  projectId,
  onClose,
  onRetry,
  onContinueWithout,
}: BlockedUploadModalProps) {
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  const [exported, setExported] = useState(false);

  const count = blocked.length;
  const plural = count === 1 ? '' : 's';

  useEffect(() => {
    if (!show) {
      setConfirmingSkip(false);
      setExported(false);
    }
  }, [show]);

  const handleClose = () => {
    setConfirmingSkip(false);
    setExported(false);
    onClose();
  };

  const handleExport = () => {
    const rows = blocked.map((item) => ({
      originalPath: item.originalPath,
      reason: item.reason,
      category: item.kind,
    }));
    downloadFailedImagesCsv(failedImagesCsvName(rows, projectId), rows);
    setExported(true);
  };

  return (
    <Dialog open={show} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent size='lg' static>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <AlertTriangle className='text-warning' />
            {`${count} image${plural} could not be uploaded`}
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p>
            The rest of this survey is uploaded. These {count} file{plural}{' '}
            could not be transferred - they are usually corrupt, unreadable, or
            missing from the folder that was selected.
          </p>
          <p className='mb-2'>
            Download the list first if you want to check them. Continuing
            removes them from the survey and starts processing on everything
            else; you can add them later by uploading to this survey again.
          </p>

          <div
            style={{ maxHeight: 260, overflowY: 'auto' }}
            className='border border-secondary'
          >
            <Table size='sm' variant='dark' className='m-0'>
              <thead>
                <tr>
                  <th>Image</th>
                  <th style={{ width: '45%' }}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {blocked.slice(0, PREVIEW_ROWS).map((item) => (
                  <tr key={item.originalPath}>
                    <td style={{ wordBreak: 'break-all', fontSize: 12 }}>
                      {item.originalPath}
                    </td>
                    <td style={{ fontSize: 12 }}>{item.reason}</td>
                  </tr>
                ))}
                {count > PREVIEW_ROWS && (
                  <tr>
                    <td
                      colSpan={2}
                      className='text-secondary'
                      style={{ fontSize: 12 }}
                    >
                      …and {count - PREVIEW_ROWS} more - download the CSV for
                      the full list.
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </div>

          {confirmingSkip && (
            <p className='mt-4 mb-0 text-warning'>
              {`Remove ${count} image${plural} from this survey and finish the upload without ${
                count === 1 ? 'it' : 'them'
              }?`}
              {!exported && ' The list has not been downloaded yet.'}
            </p>
          )}
        </DialogBody>
        <DialogFooter className='flex justify-between'>
          <div className='flex gap-2'>
            <Button variant='ghost' onClick={handleClose}>
              Close
            </Button>
            <Button variant='light' onClick={handleExport}>
              Download CSV
            </Button>
          </div>
          <div className='flex gap-2'>
            <Button
              variant='secondary'
              onClick={() => {
                setConfirmingSkip(false);
                onRetry();
              }}
            >
              Try again
            </Button>
            {confirmingSkip ? (
              <Button variant='warning' onClick={onContinueWithout}>
                {`Yes, continue without ${count === 1 ? 'it' : 'them'}`}
              </Button>
            ) : (
              <Button variant='primary' onClick={() => setConfirmingSkip(true)}>
                {`Continue without ${
                  count === 1 ? 'this image' : `these ${count} images`
                }`}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
