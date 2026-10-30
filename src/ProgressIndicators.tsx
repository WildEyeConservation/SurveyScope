import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useContext } from 'react';
import { ProgressContext } from './Context';

const SIZE = 50;
const THICKNESS = 8;

function CircularProgressWithLabel({
  value,
  detail,
}: {
  value?: number;
  detail: JSX.Element;
}) {
  const radius = (44 - THICKNESS) / 2;
  const circumference = 2 * Math.PI * radius;
  const determinate = !!value;
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        <div className='relative inline-flex'>
          <svg
            width={SIZE}
            height={SIZE}
            viewBox='22 22 44 44'
            className={determinate ? '-rotate-90' : 'animate-spin'}
            role='progressbar'
            aria-valuenow={value}
          >
            <circle
              cx={44}
              cy={44}
              r={radius}
              fill='none'
              stroke='currentColor'
              strokeWidth={THICKNESS}
              strokeDasharray={circumference}
              strokeDashoffset={
                determinate
                  ? circumference * (1 - Math.min(100, value!) / 100)
                  : circumference * 0.7
              }
              className='transition-[stroke-dashoffset] duration-300'
            />
          </svg>
          {value !== undefined && (
            <div className='absolute inset-0 flex items-center justify-center text-xs text-black/60'>
              {`${Math.round(value)}%`}
            </div>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side='bottom'>{detail}</TooltipContent>
    </Tooltip>
  );
}

export function ProgressIndicators() {
  const { progress } = useContext(ProgressContext)!;
  if (!progress) return null;
  return (
    <>
      {Object.keys(progress).map((key) => (
        <CircularProgressWithLabel
          key={key}
          value={progress[key].value}
          detail={progress[key].detail}
        />
      ))}
    </>
  );
}
