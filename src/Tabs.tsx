import React, {
  useState,
  useRef,
  useLayoutEffect,
  useEffect,
  useCallback,
  useMemo,
  ReactElement,
} from 'react';
import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import './Tabs.css';

interface TabProps {
  label: string;
  children: React.ReactNode;
  className?: string;
}

interface TabsProps {
  children:
    | ReactElement<TabProps>
    | (ReactElement<TabProps> | false | null | undefined)[];
  defaultTab?: number;
  onTabChange?: (tab: number) => void;
  className?: string;
  sharedChild?: React.ReactNode;
  disableSwitching?: boolean;
}

export const Tab: React.FC<TabProps> = ({ children, className }) => {
  return (
    <div className={`flex flex-col w-full h-full ${className ?? ''}`}>
      {children}
    </div>
  );
};

export const Tabs: React.FC<TabsProps> = ({
  children,
  defaultTab = 0,
  onTabChange,
  className,
  sharedChild,
  disableSwitching = false,
}) => {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const childrenArray = React.Children.toArray(
    children
  ) as ReactElement<TabProps>[];

  const [tabWidths, setTabWidths] = useState<number[]>([]);
  const [moreButtonWidth, setMoreButtonWidth] = useState(0);
  const [visibleCount, setVisibleCount] = useState(childrenArray.length);

  const headerRef = useRef<HTMLDivElement>(null);
  const hiddenRowRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLDivElement | null)[]>([]);
  const moreRef = useRef<HTMLDivElement>(null);

  // Measure tab widths from the hidden row
  useLayoutEffect(() => {
    if (!hiddenRowRef.current) return;
    const widths = tabRefs.current
      .slice(0, childrenArray.length)
      .map((el) => el?.offsetWidth ?? 0);
    const moreW = moreRef.current?.offsetWidth ?? 0;
    setTabWidths(widths);
    setMoreButtonWidth(moreW);
  }, [childrenArray.length]);

  // Calculate how many tabs fit
  const recalculate = useCallback(() => {
    if (!headerRef.current || tabWidths.length === 0) return;
    const available = headerRef.current.offsetWidth;
    const totalWidth = tabWidths.reduce((a, b) => a + b, 0);

    if (totalWidth <= available) {
      setVisibleCount(childrenArray.length);
      return;
    }

    let used = 0;
    let count = 0;
    for (let i = 0; i < tabWidths.length; i++) {
      if (used + tabWidths[i] + moreButtonWidth <= available) {
        used += tabWidths[i];
        count++;
      } else {
        break;
      }
    }
    setVisibleCount(Math.max(1, count));
  }, [tabWidths, moreButtonWidth, childrenArray.length]);

  // ResizeObserver to recalculate on container resize
  useEffect(() => {
    recalculate();
    if (!headerRef.current) return;
    const observer = new ResizeObserver(recalculate);
    observer.observe(headerRef.current);
    return () => observer.disconnect();
  }, [recalculate]);

  // Compute visible and overflow index arrays with active-tab promotion
  const { visibleIndices, overflowIndices } = useMemo(() => {
    if (visibleCount >= childrenArray.length) {
      return {
        visibleIndices: childrenArray.map((_, i) => i),
        overflowIndices: [] as number[],
      };
    }

    const visible = childrenArray.slice(0, visibleCount).map((_, i) => i);
    const overflow = childrenArray
      .slice(visibleCount)
      .map((_, i) => i + visibleCount);

    // Promote active tab if it's in the overflow set
    if (overflow.includes(activeTab) && visible.length > 0) {
      const lastVisible = visible[visible.length - 1];
      visible[visible.length - 1] = activeTab;
      overflow[overflow.indexOf(activeTab)] = lastVisible;
      overflow.sort((a, b) => a - b);
    }

    return { visibleIndices: visible, overflowIndices: overflow };
  }, [visibleCount, activeTab, childrenArray.length]);

  const handleTabClick = (index: number) => {
    if (disableSwitching) return;
    setActiveTab(index);
    onTabChange?.(index);
  };

  return (
    <div className={`w-full h-full flex flex-col ${className ?? ''}`}>
      <div
        ref={headerRef}
        className='tabs-header border-b border-dark'
      >
        {/* Hidden measurement row */}
        {tabWidths.length === 0 && (
          <div ref={hiddenRowRef} className='tabs-measure-row' aria-hidden='true'>
            {childrenArray.map((child, i) => (
              <div
                key={i}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                className='tab-label py-2! px-4!'
              >
                {child.props.label}
              </div>
            ))}
            <div
              ref={moreRef}
              className='tab-label py-2! px-4!'
            >
              More <ChevronDown size={14} />
            </div>
          </div>
        )}

        {/* Visible tabs */}
        {visibleIndices.map((index) => (
          <div
            key={index}
            className={`tab-label py-2! px-4! ${
              activeTab === index ? 'bg-primary!' : ''
            }`}
            onClick={() => handleTabClick(index)}
          >
            {childrenArray[index].props.label}
          </div>
        ))}

        {/* More dropdown */}
        {overflowIndices.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div
                className={cn(
                  'tab-label tab-more-toggle py-2! px-4!',
                  overflowIndices.includes(activeTab) && 'bg-primary!'
                )}
              >
                More <ChevronDown size={14} style={{ verticalAlign: 'middle' }} />
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start'>
              {overflowIndices.map((index) => (
                <DropdownMenuItem
                  key={index}
                  className={cn(activeTab === index && 'bg-primary! text-white!')}
                  onSelect={() => handleTabClick(index)}
                >
                  {childrenArray[index].props.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className='grow flex flex-col w-full h-full'>
        {sharedChild}
        {childrenArray[activeTab]}
      </div>
    </div>
  );
};
