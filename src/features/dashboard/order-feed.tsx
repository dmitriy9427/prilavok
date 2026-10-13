/**
 * Лента заказов: последние заказы + те, что приходят прямо сейчас.
 *
 * Два источника данных, одна лента:
 *   - HTTP — «что было до того, как я открыл страницу» (последние 8 заказов);
 *   - сокет — «что случилось после» (liveStore.feed).
 * Склеиваем и убираем повторы по id: заказ мог попасть в оба источника.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { ordersQuery } from '@/api/queries'
import { EmptyState } from '@/components/page'
import { StatusBadge } from '@/components/status-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatMoney, formatTime } from '@/lib/format'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { isRecent, liveStore } from '@/realtime/live'
import type { OrderRow } from '@/shared/types'

const LATEST = { page: 0, size: 8, sort: 'createdAt', dir: 'desc', status: [], q: '', from: '', to: '' } as const

export function OrderFeed() {
  const { data, isPending } = useQuery(ordersQuery({ ...LATEST, status: [] }))
  const feed = useStore(liveStore, (s) => s.feed)
  const touched = useStore(liveStore, (s) => s.touched)

  const seen = new Set<string>()
  const orders: OrderRow[] = []
  for (const order of [...feed, ...(data?.rows ?? [])]) {
    if (seen.has(order.id)) continue
    seen.add(order.id)
    orders.push(order)
  }
  const live = new Set(feed.map((order) => order.id))

  if (isPending && !orders.length) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    )
  }
  if (!orders.length) return <EmptyState title="Заказов пока нет" />

  return (
    <ul className="divide-y">
      {orders.slice(0, 8).map((order) => (
        // key с меткой времени: когда заказ изменился, элемент создаётся заново — и анимация подсветки играет снова.
        <li key={`${order.id}:${touched[order.id] ?? 0}`} className={cn(live.has(order.id) && 'slide-in', isRecent(touched[order.id]) && 'flash-row')}>
          <Link to="/orders/$orderId" params={{ orderId: order.id }} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                {order.number}
                {live.has(order.id) && <span className="rounded bg-primary/12 px-1.5 text-[10px] font-semibold text-primary uppercase">новый</span>}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {order.customerName} · {order.city}
              </span>
            </span>
            <StatusBadge status={order.status} className="hidden sm:inline-flex" />
            <span className="w-20 text-right">
              <span className="tabular block text-sm font-medium">{formatMoney(order.total)}</span>
              <span className="tabular block text-xs text-muted-foreground">{formatTime(order.createdAt)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
