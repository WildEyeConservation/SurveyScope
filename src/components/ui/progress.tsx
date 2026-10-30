import { cn } from '@/lib/utils';
import * as React from 'react';

const barColors = {
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  danger: 'bg-danger',
  light: 'bg-light',
  dark: 'bg-dark',
};

type ProgressVariant = keyof typeof barColors;

type ProgressBarProps = {
  value?: number;
  max?: number;
  min?: number;
  label?: React.ReactNode;
  variant?: ProgressVariant;
  striped?: boolean;
  animated?: boolean;
  className?: string;
  style?: React.CSSProperties;
};

function ProgressBar({
  value = 0,
  max = 100,
  min = 0,
  label,
  variant = 'primary',
  striped = false,
  animated = false,
  className,
  style,
}: ProgressBarProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div
      data-slot='progress-bar'
      role='progressbar'
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      className={cn(
        'flex flex-col justify-center overflow-hidden text-center whitespace-nowrap text-white transition-[width] duration-500',
        barColors[variant],
        (striped || animated) &&
          'bg-[linear-gradient(45deg,rgba(255,255,255,0.15)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.15)_50%,rgba(255,255,255,0.15)_75%,transparent_75%,transparent)] bg-[length:1rem_1rem]',
        animated && 'animate-[progress-stripes_1s_linear_infinite]',
        className,
      )}
      style={{ width: `${Math.max(0, Math.min(100, pct))}%`, ...style }}
    >
      {label}
    </div>
  );
}

function Progress({
  className,
  children,
  style,
  ...barProps
}: ProgressBarProps & { children?: React.ReactNode }) {
  return (
    <div
      data-slot='progress'
      className={cn(
        'flex h-4 overflow-hidden bg-secondary text-xs leading-none',
        className,
      )}
      style={style}
    >
      {children ?? <ProgressBar {...barProps} />}
    </div>
  );
}

export { Progress, ProgressBar, type ProgressVariant };
