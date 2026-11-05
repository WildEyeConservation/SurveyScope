import DataTable, { type DataColumn } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ExternalLink, Share2 } from 'lucide-react';
import { useContext } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ChainShareResults from './chain-viewer/admin/ChainShareResults';
import DisagreementExplorer from './chain-viewer/admin/DisagreementExplorer';
import ManageShares from './chain-viewer/admin/ManageShares';
import {
  useActiveShares,
  type ActiveShare,
} from './chain-viewer/admin/useActiveShares';
import { UserContext } from './Context';
import PageHeader from './PageHeader';
import { Tab, Tabs } from './Tabs';

const ADMIN_TABS = ['reviews', 'manage', 'results', 'disagreements'];

function ReviewList() {
  const navigate = useNavigate();
  const { data: shares = [], isLoading } = useActiveShares();

  const columns: DataColumn<ActiveShare>[] = [
    {
      id: 'survey',
      header: 'Survey',
      accessorFn: (share) => share.surveyName ?? '',
      cell: ({ getValue }) => (
        <span className='font-medium'>{getValue<string>() || '—'}</span>
      ),
    },
    {
      id: 'set',
      header: 'Annotation set',
      accessorFn: (share) => share.annotationSetName ?? share.annotationSetId,
    },
    {
      id: 'open',
      header: 'Actions',
      enableSorting: false,
      cell: ({ row }) => (
        <Button
          variant='primary'
          onClick={() => navigate(`/shared-chains/${row.original.shareId}`)}
        >
          <ExternalLink size={16} />
          Open viewer
        </Button>
      ),
      meta: { className: 'w-px text-center' },
    },
  ];

  return (
    <DataTable
      storageKey='shared-chain-reviews'
      columns={columns}
      data={shares}
      getRowId={(share) => share.shareId}
      initialSorting={[{ id: 'survey', desc: false }]}
      loading={isLoading}
      loadingMessage='Loading shared reviews…'
      emptyIcon={Share2}
      emptyMessage='No chain reviews have been shared with you'
    />
  );
}

export default function SharedChains() {
  const { cognitoGroups } = useContext(UserContext)!;
  const isSysadmin = cognitoGroups.includes('sysadmin');
  const [params, setParams] = useSearchParams();
  const shareId = params.get('share') ?? undefined;
  const activeTab = Math.max(0, ADMIN_TABS.indexOf(params.get('tab') ?? ''));

  const show = (tab: string, share: string | undefined) =>
    setParams({ tab, ...(share ? { share } : {}) }, { replace: true });
  const setShare = (share: string | undefined) =>
    show(ADMIN_TABS[activeTab], share);

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '1555px',
        marginTop: '16px',
        paddingBottom: '16px',
        alignSelf: 'flex-start',
      }}
    >
      <Card>
        <PageHeader title='Shared Chains' />
        <CardContent>
          {isSysadmin ? (
            <Tabs
              activeTab={activeTab}
              onTabChange={(index) => show(ADMIN_TABS[index], shareId)}
            >
              <Tab label='Reviews'>
                <div className='mx-2 mt-4 mb-2'>
                  <ReviewList />
                </div>
              </Tab>
              <Tab label='Manage'>
                <div className='mx-2 mt-4 mb-2'>
                  <ManageShares
                    onShowResults={(share) => show('results', share)}
                  />
                </div>
              </Tab>
              <Tab label='Results'>
                <div className='mx-2 mt-4 mb-2'>
                  <ChainShareResults
                    shareId={shareId}
                    onShareChange={setShare}
                  />
                </div>
              </Tab>
              <Tab label='Disagreements'>
                <div className='mx-2 mt-4 mb-2'>
                  <DisagreementExplorer
                    shareId={shareId}
                    onShareChange={setShare}
                  />
                </div>
              </Tab>
            </Tabs>
          ) : (
            <ReviewList />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
