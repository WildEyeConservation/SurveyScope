import * as React from "react"
import { cn } from "@/lib/utils"
import { fieldBase, type FieldSize } from "@/components/ui/input"

const chevron = "select-chevron"

const selectSizes = {
  sm: "py-1 pr-8 pl-2 text-sm bg-position-[right_0.5rem_center]",
  default: "py-1.5 pr-9 pl-3 text-base bg-position-[right_0.75rem_center]",
  lg: "py-2 pr-12 pl-4 text-xl bg-position-[right_1rem_center]",
}

const NativeSelect = React.forwardRef(function NativeSelect({
  className,
  size = "default",
  ...props
}: Omit<React.ComponentProps<"select">, "size"> & { size?: FieldSize }, ref: React.ForwardedRef<any>) {
  return (
    <select
      data-slot="native-select"
      data-size={size}
      className={cn(
        fieldBase,
        "appearance-none",
        !props.multiple && chevron,
        selectSizes[size],
        props.multiple && "pr-3",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})

const NativeSelectOption = React.forwardRef(function NativeSelectOption(props: React.ComponentProps<"option">, ref: React.ForwardedRef<any>) {
  return <option data-slot="native-select-option" ref={ref}
      {...props} />
})

const NativeSelectOptGroup = React.forwardRef(function NativeSelectOptGroup(props: React.ComponentProps<"optgroup">, ref: React.ForwardedRef<any>) {
  return <optgroup data-slot="native-select-optgroup" ref={ref}
      {...props} />
})

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
