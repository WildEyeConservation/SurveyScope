export const fieldBase =
  'block w-full min-w-0 border border-input bg-field leading-normal text-field-foreground transition-[border-color,box-shadow] outline-none placeholder:text-[#6c757d] focus:border-[#efb48c] focus:ring-[0.25rem] focus:ring-primary/25 disabled:cursor-not-allowed disabled:bg-[#ebebeb] disabled:text-secondary read-only:focus:ring-0 aria-invalid:border-danger aria-invalid:focus:ring-danger/25';

export const fieldSizes = {
  sm: 'px-2 py-1 text-sm',
  default: 'px-3 py-1.5 text-base',
  lg: 'px-4 py-2 text-xl',
};

export type FieldSize = keyof typeof fieldSizes;
