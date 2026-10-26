"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Tooltip as TooltipPrimitive } from "radix-ui"

function TooltipProvider({
  delayDuration = 100,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

const TooltipTrigger = React.forwardRef(function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>, ref: React.ForwardedRef<any>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" ref={ref}
      {...props} />
})

const TooltipContent = React.forwardRef(function TooltipContent({
  className,
  sideOffset = 2,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>, ref: React.ForwardedRef<any>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-[2147483200] w-fit max-w-[200px] origin-(--radix-tooltip-content-transform-origin) animate-in bg-black px-2 py-1 text-center text-sm text-white fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className
        )}
        ref={ref}
      {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-black" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
})

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
