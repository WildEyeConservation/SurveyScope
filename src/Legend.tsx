import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useContext } from 'react';
import { ProjectContext } from './Context';
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
    currentCategory,
    setCurrentCategory,
  } = useContext(ProjectContext)!;
  const cats = categoriesOverride ?? categories;

  if (collapsed) {
    return (
      <Button
        variant='secondary'
        onClick={onToggleCollapse}
        className='hidden min-h-0 w-8 flex-1 items-center justify-center p-0 md:flex'
        title='Expand legend'
      >
        <ChevronLeft size={18} />
      </Button>
    );
  }

  return (
    <div className='relative ms-2 hidden min-h-0 flex-1 flex-col md:flex'>
      <Button
        variant='secondary'
        size='sm'
        onClick={onToggleCollapse}
        className='absolute top-1/2 -left-4 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full p-0'
        title='Collapse legend'
      >
        <ChevronRight size={18} />
      </Button>

      <Card className='flex h-full flex-col overflow-hidden'>
        <CardHeader>
          <CardTitle className='mb-2 flex flex-row items-center gap-2'>
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
                variant={
                  category.id === currentCategory?.id ? 'info' : 'primary'
                }
                key={category.id}
                aria-pressed={category.id === currentCategory?.id}
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
    </div>
  );
}
