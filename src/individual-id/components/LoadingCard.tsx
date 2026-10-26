import { Spinner } from '@/components/ui/spinner';
import type { LoadProgress } from '../hooks/useTransectData';

const PHASE_LABEL: Record<LoadProgress['phase'], string> = {
  idle: 'Connecting…',
  category: 'Resolving category…',
  images: 'Fetching images…',
  cameras: 'Fetching cameras…',
  annotations: 'Fetching annotations…',
  done: 'Preparing workspace…',
};

/**
 * Loading state for the Individual ID harness. Shows the live fetch counts so
 * a long transect load reads as "still working", not "stuck".
 */
export function LoadingCard({ progress }: { progress: LoadProgress }) {
  return (
    <div className='w-full h-full flex items-center justify-center'>
      <div
        style={{
          background: '#4E5D6C',
          color: '#f8f9fa',
          borderRadius: 8,
          padding: '28px 32px',
          minWidth: 320,
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.35)',
        }}
      >
        <div className='flex items-center gap-4 mb-4'>
          <Spinner animation='border' size='sm' />
          <span style={{ fontSize: 16, fontWeight: 600 }}>
            Loading transect…
          </span>
        </div>
        <div style={{ opacity: 0.85, fontSize: 13, marginBottom: 12 }}>
          {PHASE_LABEL[progress.phase]}
        </div>
        <div
          className='flex flex-col gap-1'
          style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}
        >
          <StatRow label='Images fetched' value={progress.images} />
          <StatRow label='Annotations fetched' value={progress.annotations} />
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className='flex flex-row justify-between gap-6'>
      <span style={{ opacity: 0.8 }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value.toLocaleString()}</span>
    </div>
  );
}
