import * as React from "react"
import { cn } from "@/lib/utils"

function Table({
  className,
  containerProps = {},
  ...props
}) {
  const {
    className: containerClassName,
    onKeyDown: containerOnKeyDown,
    ...containerAttributes
  } = containerProps

  function onContainerKeyDown(event) {
    containerOnKeyDown?.(event)
    if (event.defaultPrevented) return
    const container = event.currentTarget
    if (container.scrollWidth <= container.clientWidth) return

    const step = Math.max(64, Math.round(container.clientWidth * 0.75))
    if (event.key === "ArrowRight") {
      event.preventDefault()
      container.scrollLeft += step
    } else if (event.key === "ArrowLeft") {
      event.preventDefault()
      container.scrollLeft -= step
    } else if (event.key === "Home") {
      event.preventDefault()
      container.scrollLeft = 0
    } else if (event.key === "End") {
      event.preventDefault()
      container.scrollLeft = container.scrollWidth
    }
  }

  return (
    <div
      data-slot="table-container"
      role={containerAttributes.role ?? "region"}
      tabIndex={containerAttributes.tabIndex ?? 0}
      onKeyDown={onContainerKeyDown}
      className={cn("relative w-full overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", containerClassName)}
      {...containerAttributes}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({
  className,
  ...props
}) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({
  className,
  ...props
}) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({
  className,
  ...props
}) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({
  className,
  ...props
}) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({
  className,
  ...props
}) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCell({
  className,
  ...props
}) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

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
