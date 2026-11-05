import { Card } from '@/components/ui/card';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

export function SidebarCollapseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type='button'
      aria-label='Hide side panel'
      title='Hide side panel'
      onClick={onClick}
      className='hidden text-muted-foreground hover:text-foreground sm:block'
    >
      <PanelLeftClose className='size-5' />
    </button>
  );
}

export function CollapsedSidebar({ onExpand }: { onExpand: () => void }) {
  return (
    <Card className='hidden flex-none sm:flex'>
      <button
        type='button'
        aria-label='Show side panel'
        title='Show side panel'
        onClick={onExpand}
        className='flex h-full w-10 items-start justify-center pt-3 text-muted-foreground hover:text-foreground'
      >
        <PanelLeftOpen className='size-5' />
      </button>
    </Card>
  );
}
