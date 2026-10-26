import { useContext } from 'react';
import { ProjectContext } from './Context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <div className='hidden md:flex flex-col ms-2' style={{ position: 'relative', height: `calc(100% - 56px)` }}>
      {/* Toggle button */}
      <Button
        variant='secondary'
        size='sm'
        onClick={onToggleCollapse}
        className='flex items-center justify-center'
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
        <Card className='flex flex-col h-full overflow-hidden'>
          <CardHeader>
            <CardTitle className='flex flex-row items-center gap-2 mb-2'>
              <span>Legend</span>
            </CardTitle>
            <span className='text-muted-foreground' style={{ fontSize: '14px' }}>
              Click on a label to annotate with or use the shortcut key
            </span>
          </CardHeader>
          <CardContent className='flex flex-col gap-2 overflow-auto'>
            {cats
              ?.filter((c) => c.annotationSetId === annotationSetId)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((category) => (
                <Button
                  variant={'primary'}
                  key={category.id}
                  className='flex flex-row items-center justify-between gap-2'
                  onClick={() => setCurrentCategory(category)}
                >
                  <div className='flex flex-row items-center gap-2'>
                    <div
                      style={{ backgroundColor: category.color || '#000' }}
                      className='rounded-full p-2'
                    ></div>
                    <div>{category.name}</div>
                  </div>
                  <div>({formatShortcutKey(category.shortcutKey)})</div>
                </Button>
              ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
