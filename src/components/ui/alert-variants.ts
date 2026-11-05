import { cva } from 'class-variance-authority';

export const alertVariants = cva(
  'relative mb-4 w-full p-4 text-white [&_a]:text-white [&_a]:underline',
  {
    variants: {
      variant: {
        default: 'bg-primary',
        primary: 'bg-primary',
        secondary: 'bg-secondary',
        success: 'bg-success',
        info: 'bg-info',
        warning: 'bg-warning text-[#212529] [&_a]:text-[#212529]',
        danger: 'bg-danger',
        destructive: 'bg-danger',
        light: 'bg-light',
        dark: 'bg-dark',
      },
    },
    defaultVariants: {
      variant: 'primary',
    },
  },
);
