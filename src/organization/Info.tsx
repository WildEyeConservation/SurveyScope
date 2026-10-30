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

  return (
    <div className='mt-6 w-full' style={{ maxWidth: '800px' }}>
      <div className='mb-12'>
        <h6
          className='mb-2 font-bold uppercase'
          style={{
            fontSize: '0.75rem',
            letterSpacing: '0.1em',
            color: '#adb5bd',
          }}
        >
          Organisation Name
        </h6>
        <h2 className='mb-0 font-bold' style={{ color: '#ffffff' }}>
          {organization?.name || '---'}
        </h2>
      </div>

      <div className='mb-12'>
        <h6
          className='mb-2 font-bold uppercase'
          style={{
            fontSize: '0.75rem',
            letterSpacing: '0.1em',
            color: '#adb5bd',
          }}
        >
          Description
        </h6>
        <p
          className='mb-0'
          style={{
            whiteSpace: 'pre-wrap',
            lineHeight: '1.6',
            fontSize: '1.1rem',
            color: '#e9ecef',
          }}
        >
          {organization?.description || 'No description provided.'}
        </p>
      </div>

      <div
        className='mt-12 border-t pt-6'
        style={{ borderColor: 'rgba(255,255,255,0.1) !important' }}
      >
        <div
          className='flex items-start gap-4 p-4'
          style={{ backgroundColor: '#ffffff', border: '1px solid #dee2e6' }}
        >
          <InfoIcon size={20} className='mt-1 text-primary' />
          <div>
            <p
              className='mb-1 font-bold text-dark'
              style={{ fontSize: '1rem' }}
            >
              Want to update your organisation details?
            </p>
            <p
              className='mb-0 text-dark'
              style={{ fontSize: '0.95rem', opacity: 0.85 }}
            >
              Please contact <strong>WildEye support</strong> if you would like
              to make changes to this information.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
