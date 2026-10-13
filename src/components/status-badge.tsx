import { cn } from '@/lib/utils'
import { ORDER_STATUS_LABELS } from '@/lib/format'
import type { OrderStatus } from '@/shared/types'

/** Цвет статуса — не единственный признак: рядом всегда текст (для дальтоников и скринридеров). */
const STYLES: Record<OrderStatus, string> = {
  new: 'bg-info/12 text-info',
  paid: 'bg-chart-3/12 text-chart-3',
  packing: 'bg-warning/15 text-warning',
  shipped: 'bg-chart-2/12 text-chart-2',
  delivered: 'bg-success/12 text-success',
  cancelled: 'bg-destructive/10 text-destructive',
}

export const STATUS_DOT: Record<OrderStatus, string> = {
  new: 'bg-info',
  paid: 'bg-chart-3',
  packing: 'bg-warning',
  shipped: 'bg-chart-2',
  delivered: 'bg-success',
  cancelled: 'bg-destructive',
}

export function StatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap', STYLES[status], className)}>
      <span className={cn('size-1.5 rounded-full', STATUS_DOT[status])} aria-hidden />
      {ORDER_STATUS_LABELS[status]}
    </span>
  )
}
