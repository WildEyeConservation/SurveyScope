import * as React from "react"
import { cn } from "@/lib/utils"

const spinnerColors = {
  primary: "text-primary",
  secondary: "text-secondary",
  success: "text-success",
  info: "text-info",
  warning: "text-warning",
  danger: "text-danger",
  light: "text-light",
  dark: "text-dark",
}

const Spinner = React.forwardRef(function Spinner({
  className,
  size,
  animation = "border",
  variant,
  ...props
}: React.ComponentProps<"span"> & {
  size?: "sm"
  animation?: "border" | "grow"
  variant?: keyof typeof spinnerColors
}, ref: React.ForwardedRef<any>) {
  return (
    <span
      role="status"
      aria-label="Loading"
      data-slot="spinner"
      className={cn(
        "inline-block shrink-0 align-[-0.125em]",
        size === "sm" ? "size-4" : "size-8",
        animation === "border"
          ? cn(
              "animate-spin rounded-full border-solid border-current border-r-transparent [animation-duration:0.75s]",
              size === "sm" ? "border-[0.2em]" : "border-[0.25em]"
            )
          : "animate-[spinner-grow_0.75s_linear_infinite] rounded-full bg-current opacity-0",
        variant && spinnerColors[variant],
        className
      )}
      ref={ref}
      {...props}
    />
  )
})

export { Spinner }
