import { CardHeader, CardTitle } from '@/components/ui/card';
import type { ReactNode } from 'react';

// Fixed height so moving between nav pages doesn't shift the layout.
export default function PageHeader({
  title,
  children,
}: {
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <CardHeader className='flex min-h-[55px] flex-col gap-4 lg:flex-row lg:items-center'>
      <CardTitle className='mb-0 shrink-0 whitespace-nowrap'>
        <h4 className='mb-0'>{title}</h4>
      </CardTitle>
      {children && (
        <div className='flex w-full flex-col gap-2 lg:ms-auto lg:flex-row lg:items-center lg:justify-end'>
          {children}
        </div>
      )}
    </CardHeader>
  );
}
