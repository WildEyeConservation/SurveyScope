import * as React from "react"
import { cn } from "@/lib/utils"

const Table = React.forwardRef(function Table({
  className,
  striped = false,
  hover = false,
  bordered = false,
  borderless = false,
  size,
  responsive = false,
  ...props
}: React.ComponentProps<"table"> & {
  striped?: boolean
  hover?: boolean
  bordered?: boolean
  borderless?: boolean
  size?: "sm"
  responsive?: boolean
}, ref: React.ForwardedRef<any>) {
  const table = (
    <table
      data-slot="table"
      className={cn(
        "mb-4 w-full caption-bottom border-collapse align-top text-foreground",
        "[&_td]:border-b [&_td]:border-black/15 [&_th]:border-b [&_th]:border-black/15",
        size === "sm" ? "[&_td]:p-1 [&_th]:p-1" : "[&_td]:p-2 [&_th]:p-2",
        striped && "[&>tbody>tr:nth-of-type(odd)>*]:bg-white/5",
        hover && "[&>tbody>tr:hover>*]:bg-white/[0.075]",
        bordered && "[&_td]:border [&_th]:border",
        borderless && "[&_td]:border-0 [&_th]:border-0",
        className
      )}
      ref={ref}
      {...props}
    />
  )
  if (!responsive) return table
  return (
    <div data-slot="table-container" className="w-full overflow-x-auto">
      {table}
    </div>
  )
})

const TableHeader = React.forwardRef(function TableHeader({ className, ...props }: React.ComponentProps<"thead">, ref: React.ForwardedRef<any>) {
  return (
    <thead
      data-slot="table-header"
      className={cn("align-bottom", className)}
      ref={ref}
      {...props}
    />
  )
})

const TableBody = React.forwardRef(function TableBody({ className, ...props }: React.ComponentProps<"tbody">, ref: React.ForwardedRef<any>) {
  return <tbody data-slot="table-body" className={className} ref={ref}
      {...props} />
})

const TableFooter = React.forwardRef(function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">, ref: React.ForwardedRef<any>) {
  return <tfoot data-slot="table-footer" className={className} ref={ref}
      {...props} />
})

const TableRow = React.forwardRef(function TableRow({ className, ...props }: React.ComponentProps<"tr">, ref: React.ForwardedRef<any>) {
  return <tr data-slot="table-row" className={className} ref={ref}
      {...props} />
})

const TableHead = React.forwardRef(function TableHead({ className, ...props }: React.ComponentProps<"th">, ref: React.ForwardedRef<any>) {
  return (
    <th
      data-slot="table-head"
      className={cn("text-left font-bold", className)}
      ref={ref}
      {...props}
    />
  )
})

const TableCell = React.forwardRef(function TableCell({ className, ...props }: React.ComponentProps<"td">, ref: React.ForwardedRef<any>) {
  return <td data-slot="table-cell" className={className} ref={ref}
      {...props} />
})

const TableCaption = React.forwardRef(function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">, ref: React.ForwardedRef<any>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("py-2 text-left text-muted-foreground", className)}
      ref={ref}
      {...props}
    />
  )
})

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
