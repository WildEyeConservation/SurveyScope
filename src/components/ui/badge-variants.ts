import { cva } from 'class-variance-authority';

export const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 px-[0.65em] py-[0.35em] text-center align-baseline text-[0.75em] leading-none font-bold whitespace-nowrap text-white [&>svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-primary',
        primary: 'bg-primary',
        secondary: 'bg-secondary',
        success: 'bg-success',
        info: 'bg-info',
        warning: 'bg-warning',
        danger: 'bg-danger',
        destructive: 'bg-danger',
        light: 'bg-light',
        dark: 'bg-dark',
        outline: 'border border-border bg-transparent text-foreground',
      },
    },
    defaultVariants: {
      variant: 'primary',
    },
  },
);
