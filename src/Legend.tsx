import { useContext } from 'react';
import { ProjectContext } from './Context';
import { Card, Button } from 'react-bootstrap';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatShortcutKey } from './utils/hotkeys';

/**
 * SideLegend shows which classes correspond to which colour markers in the
 * Detweb GUI, next to the annotation view. Clicking a legend entry selects
 * that class as the currently active class, so the next click on the image
 * places a marker of that class. (The on-map legend for mobile is rendered
 * by MapLibreAnnotator itself.)
 */

interface LegendProps {
  annotationSetId?: string;
  // Optional: provide categories explicitly (e.g., when the annotation set is from another project)
  categoriesOverride?: any[];
}
interface SideLegendProps extends LegendProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function SideLegend({
  annotationSetId,
  categoriesOverride,
  collapsed = false,
  onToggleCollapse,
}: SideLegendProps) {
  const {
    categoriesHook: { data: categories },
    setCurrentCategory,
  } = useContext(ProjectContext)!;
  const cats = categoriesOverride ?? categories;

  return (
    <div className='d-none d-md-flex flex-column ms-2' style={{ position: 'relative', height: `calc(100% - 56px)` }}>
      {/* Toggle button */}
      <Button
        variant='secondary'
        size='sm'
        onClick={onToggleCollapse}
        className='d-flex align-items-center justify-content-center'
        style={{
          position: 'absolute',
          left: '-16px',
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 10,
          width: '32px',
          height: collapsed ? '100%' : '32px',
          borderRadius: collapsed ? '4px' : '50%',
          padding: 0,
        }}
        title={collapsed ? 'Expand legend' : 'Collapse legend'}
      >
        {collapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
      </Button>

      {!collapsed && (
        <Card className='d-flex flex-column h-100 overflow-hidden'>
          <Card.Header>
            <Card.Title className='d-flex flex-row align-items-center gap-2 mb-2'>
              <span>Legend</span>
            </Card.Title>
            <span className='text-muted' style={{ fontSize: '14px' }}>
              Click on a label to annotate with or use the shortcut key
            </span>
          </Card.Header>
          <Card.Body className='d-flex flex-column gap-2 overflow-auto'>
            {cats
              ?.filter((c) => c.annotationSetId === annotationSetId)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((category) => (
                <Button
                  variant={'primary'}
                  key={category.id}
                  className='d-flex flex-row align-items-center justify-content-between gap-2'
                  onClick={() => setCurrentCategory(category)}
                >
                  <div className='d-flex flex-row align-items-center gap-2'>
                    <div
                      style={{ backgroundColor: category.color || '#000' }}
                      className='rounded-circle p-2'
                    ></div>
                    <div>{category.name}</div>
                  </div>
                  <div>({formatShortcutKey(category.shortcutKey)})</div>
                </Button>
              ))}
          </Card.Body>
        </Card>
      )}
    </div>
  );
}
