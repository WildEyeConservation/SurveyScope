import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"


const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 border font-normal leading-normal whitespace-nowrap text-center align-middle select-none no-underline transition-colors outline-none focus-visible:ring-[0.25rem] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-65 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-white border-transparent hover:bg-[#be5915] active:bg-primary-hover",
        primary: "bg-primary text-white border-transparent hover:bg-[#be5915] active:bg-primary-hover",
        secondary: "bg-secondary text-white border-transparent hover:bg-[#424f5c] active:bg-[#3e4a56]",
        success: "bg-success text-white border-transparent hover:bg-[#4e9c4e] active:bg-[#4a934a]",
        info: "bg-info text-white border-transparent hover:bg-[#4da3bd] active:bg-[#499ab2]",
        warning: "bg-warning text-white border-transparent hover:bg-[#d9a406] active:bg-[#cc9a06]",
        danger: "bg-danger text-white border-transparent hover:bg-[#b84743] active:bg-[#ae423f]",
        destructive: "bg-danger text-white border-transparent hover:bg-[#b84743] active:bg-[#ae423f]",
        dark: "bg-dark text-white border-transparent hover:bg-[#415567] active:bg-[#4d5f70]",
        light: "bg-light text-white border-transparent hover:bg-[#919ba5] active:bg-[#89929b]",
        "outline-primary": "bg-transparent border-primary text-primary hover:bg-primary hover:text-white",
        "outline-secondary": "bg-transparent border-secondary text-secondary hover:bg-secondary hover:text-white",
        "outline-success": "bg-transparent border-success text-success hover:bg-success hover:text-white",
        "outline-info": "bg-transparent border-info text-info hover:bg-info hover:text-white",
        "outline-warning": "bg-transparent border-warning text-warning hover:bg-warning hover:text-white",
        "outline-danger": "bg-transparent border-danger text-danger hover:bg-danger hover:text-white",
        "outline-light": "bg-transparent border-light text-light hover:bg-light hover:text-white",
        "outline-dark": "bg-transparent border-dark text-dark hover:bg-dark hover:text-white",
        outline:
          "bg-transparent border-border text-foreground hover:bg-accent",
        ghost:
          "bg-transparent border-transparent text-foreground hover:bg-accent",
        link: "bg-transparent border-transparent text-primary underline hover:text-primary-hover disabled:text-secondary",
      },
      size: {
        default: "px-3 py-1.5 text-base",
        xs: "px-1.5 py-0.5 text-xs gap-1",
        sm: "px-2 py-1 text-sm gap-1.5",
        lg: "px-4 py-2 text-xl",
        icon: "size-[38px] p-0",
        "icon-xs": "size-6 p-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-[31px] p-0",
        "icon-lg": "size-12 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>

const Button = React.forwardRef(function Button({
  className,
  variant = "primary",
  size = "default",
  asChild = false,
  active = false,
  type,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    active?: boolean
  }, ref: React.ForwardedRef<any>) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-active={active || undefined}
      type={asChild ? type : (type ?? "button")}
      className={cn(
        buttonVariants({ variant, size }),
        active && "brightness-90",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})

export { Button, buttonVariants, type ButtonVariant }
