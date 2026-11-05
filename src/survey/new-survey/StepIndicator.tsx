import { cn } from '@/lib/utils';
// Horizontal step header for the survey-upload wizards. Completed/visited
// steps are clickable so users can jump back; future steps unlock via Next.

interface StepIndicatorProps {
  steps: string[];
  currentIndex: number;
  /** Highest step index the user has reached; earlier steps are clickable. */
  furthestIndex: number;
  onSelect: (index: number) => void;
}

export default function StepIndicator({
  steps,
  currentIndex,
  furthestIndex,
  onSelect,
}: StepIndicatorProps) {
  return (
    // Narrow modals keep only the current step's label.
    <div className='@container mb-4'>
      <div className='flex min-w-0 items-center' style={{ gap: 4 }}>
        {steps.map((title, index) => {
          const reachable = index <= furthestIndex;
          const isCurrent = index === currentIndex;
          const done = index < currentIndex;
          return (
            <div
              key={title}
              className='flex items-center'
              style={{
                flex: index === steps.length - 1 ? '0 0 auto' : '1 0 auto',
              }}
            >
              <button
                type='button'
                onClick={() => reachable && onSelect(index)}
                disabled={!reachable}
                className='flex shrink-0 items-center border-0 bg-transparent p-0'
                style={{
                  cursor: reachable && !isCurrent ? 'pointer' : 'default',
                  opacity: reachable ? 1 : 0.45,
                }}
                title={title}
              >
                <span
                  className='inline-flex items-center justify-center rounded-full'
                  style={{
                    width: 26,
                    height: 26,
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#fff',
                    backgroundColor: isCurrent
                      ? '#DF6919'
                      : done
                        ? '#198754'
                        : 'rgba(255,255,255,0.25)',
                    flex: '0 0 auto',
                  }}
                >
                  {done ? '✓' : index + 1}
                </span>
                <span
                  className={cn(
                    'ms-1 text-nowrap',
                    !isCurrent && 'hidden @5xl:inline',
                  )}
                  style={{
                    fontSize: 13,
                    fontWeight: isCurrent ? 600 : 400,
                    color: '#fff',
                  }}
                >
                  {title}
                </span>
              </button>
              {index < steps.length - 1 && (
                <div
                  className='mx-1 grow @5xl:mx-2'
                  style={{
                    height: 2,
                    backgroundColor:
                      index < currentIndex
                        ? '#198754'
                        : 'rgba(255,255,255,0.2)',
                    minWidth: 6,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
