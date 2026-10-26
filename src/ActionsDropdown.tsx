import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function ActionsDropdown({
  actions,
}: {
  actions: { label: string; onClick: () => void }[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='info' className='me-2 w-[200px]'>
          {'Open'} <ChevronDown className='size-3' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
        {actions.map((action, index) => (
          <DropdownMenuItem key={index} onSelect={action.onClick}>
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
