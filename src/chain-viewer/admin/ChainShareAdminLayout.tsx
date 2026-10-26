import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';

const LINKS = [
  { to: 'shares', label: 'Manage Shares' },
  { to: 'results', label: 'Results' },
  { to: 'disagreements', label: 'Disagreement Explorer' },
];

/**
 * Sidebar shell for the sysadmin chain-share dashboard. Renders a vertical nav
 * down the left and the active sub-page (Manage Shares / Results / Disagreement
 * Explorer) in the content area via <Outlet/>.
 */
export default function ChainShareAdminLayout() {
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 1500,
        marginTop: 16,
        marginBottom: 16,
        display: 'flex',
        gap: 16,
        alignItems: 'flex-start',
      }}
    >
      <nav
        className='flex flex-col'
        style={{ flex: '0 0 210px', position: 'sticky', top: 16 }}
      >
        <div className='uppercase text-muted-foreground text-sm font-bold mb-2 px-2'>
          Chain Shares
        </div>
        {LINKS.map((l) => (
          <NavLink
            to={l.to}
            key={l.to}
            className={({ isActive }) =>
              cn(
                'mb-1 block px-4 py-2 no-underline',
                isActive
                  ? 'bg-primary text-white'
                  : 'text-primary hover:text-primary-hover'
              )
            }
          >
            {l.label}
          </NavLink>
        ))}
      </nav>
      <div className='grow' style={{ minWidth: 0 }}>
        <Outlet />
      </div>
    </div>
  );
}
