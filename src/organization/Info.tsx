import { Spinner } from '@/components/ui/spinner';
import { Info as InfoIcon } from 'lucide-react';
import { useContext, useEffect, useState } from 'react';
import { GlobalContext } from '../Context';
import { Schema } from '../amplify/client-schema';

export default function Info({ organizationId }: { organizationId: string }) {
  const { client } = useContext(GlobalContext);

  const [organization, setOrganization] = useState<
    Schema['Organization']['type'] | null
  >(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    const fetchOrganization = async () => {
      setLoading(true);
      const { data: organization } = await client.models.Organization.get({
        id: organizationId!,
      });
      setOrganization(organization);
      setLoading(false);
    };

    fetchOrganization();
  }, [organizationId]);

  if (loading) {
    return (
      <div className='flex justify-center p-12'>
        <Spinner animation='border' variant='primary' />
      </div>
    );
  }

  const name = organization?.name || 'Unnamed organisation';
  return (
    <div className='mt-4 flex max-w-3xl flex-col gap-3'>
      <div className='flex items-start gap-4 border border-white/15 bg-white/[0.07] p-4'>
        <span className='flex size-14 flex-none items-center justify-center bg-primary text-2xl font-semibold text-white'>
          {name.charAt(0).toUpperCase()}
        </span>
        <div className='flex min-w-0 flex-col gap-1'>
          <span className='text-xl font-semibold'>{name}</span>
          {organization?.createdAt && (
            <span className='text-xs text-muted-foreground'>
              Created {new Date(organization.createdAt).toLocaleDateString()}
            </span>
          )}
          <p className='mt-2 mb-0 whitespace-pre-wrap'>
            {organization?.description || (
              <span className='text-muted-foreground italic'>
                No description provided.
              </span>
            )}
          </p>
        </div>
      </div>
      <span className='flex items-center gap-2 text-sm text-muted-foreground'>
        <InfoIcon className='size-4 flex-none' />
        To change these details, contact WildEye support.
      </span>
    </div>
  );
}
