import * as React from "react"
import { cn } from "@/lib/utils"

const fieldBase =
  "block w-full min-w-0 border border-input bg-field leading-normal text-field-foreground transition-[border-color,box-shadow] outline-none placeholder:text-[#6c757d] focus:border-[#efb48c] focus:ring-[0.25rem] focus:ring-primary/25 disabled:cursor-not-allowed disabled:bg-[#ebebeb] disabled:text-secondary read-only:focus:ring-0 aria-invalid:border-danger aria-invalid:focus:ring-danger/25"

const fieldSizes = {
  sm: "px-2 py-1 text-sm",
  default: "px-3 py-1.5 text-base",
  lg: "px-4 py-2 text-xl",
}

type FieldSize = keyof typeof fieldSizes

const fileSizes = {
  sm: "file:-my-1 file:-ml-2 file:mr-2 file:px-2 file:py-1",
  default: "file:-my-1.5 file:-ml-3 file:mr-3 file:px-3 file:py-1.5",
  lg: "file:-my-2 file:-ml-4 file:mr-4 file:px-4 file:py-2",
}

const Input = React.forwardRef(function Input({
  className,
  type,
  size = "default",
  htmlSize,
  ...props
}: Omit<React.ComponentProps<"input">, "size"> & {
  size?: FieldSize
  htmlSize?: number
}, ref: React.ForwardedRef<any>) {
  return (
    <input
      type={type}
      size={htmlSize}
      data-slot="input"
      className={cn(
        fieldBase,
        fieldSizes[size],
        type === "file" &&
          "file:border-0 file:border-r file:border-inherit file:bg-[#e9ecef] file:text-field-foreground hover:file:bg-[#dde0e3]",
        type === "file" && fileSizes[size],
        type === "color" && "h-[38px] w-12 p-1.5",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})

export { Input, fieldBase, fieldSizes, type FieldSize }
