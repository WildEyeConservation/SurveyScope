import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 px-[0.65em] py-[0.35em] text-[0.75em] font-bold leading-none whitespace-nowrap text-center align-baseline text-white [&>svg]:pointer-events-none",
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
        outline: "border border-border bg-transparent text-foreground",
      },
    },
    defaultVariants: {
      variant: "primary",
    },
  }
)

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>

const Badge = React.forwardRef(function Badge({
  className,
  variant = "primary",
  pill = false,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean; pill?: boolean }, ref: React.ForwardedRef<any>) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), pill && "rounded-full", className)}
      ref={ref}
      {...props}
    />
  )
})

export { Badge, badgeVariants, type BadgeVariant }
