import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { XIcon } from "lucide-react"
import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative mb-4 w-full p-4 text-white [&_a]:text-white [&_a]:underline",
  {
    variants: {
      variant: {
        default: "bg-primary",
        primary: "bg-primary",
        secondary: "bg-secondary",
        success: "bg-success",
        info: "bg-info",
        warning: "bg-warning",
        danger: "bg-danger",
        destructive: "bg-danger",
        light: "bg-light",
        dark: "bg-dark",
      },
    },
    defaultVariants: {
      variant: "primary",
    },
  }
)

type AlertVariant = NonNullable<VariantProps<typeof alertVariants>["variant"]>

const Alert = React.forwardRef(function Alert({
  className,
  variant,
  onClose,
  children,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof alertVariants> & { onClose?: () => void }, ref: React.ForwardedRef<any>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), onClose && "pr-12", className)}
      ref={ref}
      {...props}
    >
      {children}
      {onClose && (
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute top-0 right-0 p-4 text-white opacity-50 hover:opacity-75"
        >
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  )
})

const AlertTitle = React.forwardRef(function AlertTitle({ className, ...props }: React.ComponentProps<"div">, ref: React.ForwardedRef<any>) {
  return (
    <div
      data-slot="alert-title"
      className={cn("col-start-2 mb-2 text-2xl leading-tight font-medium", className)}
      ref={ref}
      {...props}
    />
  )
})

const AlertDescription = React.forwardRef(function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">, ref: React.ForwardedRef<any>) {
  return (
    <div
      data-slot="alert-description"
      className={cn("col-start-2", className)}
      ref={ref}
      {...props}
    />
  )
})

export { Alert, AlertTitle, AlertDescription, alertVariants, type AlertVariant }
