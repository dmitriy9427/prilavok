/**
 * «Сейчас в магазине» — цифры из канала metrics.
 *
 * Канал нужен только дашборду, поэтому подписка живёт здесь: открыли экран —
 * sub, ушли — unsub (посмотрите кадры на экране «Соединение»). Сервер шлёт
 * тик каждые 2 секунды; это событие-состояние: без номера, не досылается после
 * обрыва — следующий тик всё равно принесёт актуальные цифры.
 */
import { EyeIcon, ShoppingBagIcon, ShoppingCartIcon, WalletIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { formatMoney, formatNumber } from '@/lib/format'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { useChannel, useRealtimeStatus } from '@/realtime/hooks'
import { liveStore } from '@/realtime/live'
import { CHANNELS } from '@/shared/protocol'

/** Мини-график без библиотеки: точки → строка для SVG polyline. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-8 w-24" />
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const points = values.map((value, i) => `${(i / (values.length - 1)) * 96},${30 - ((value - min) / span) * 28}`).join(' ')
  return (
    <svg viewBox="0 0 96 32" className="h-8 w-24 text-primary" aria-hidden>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Tile({ icon, label, value, extra }: { icon: ReactNode; label: string; value: string | null; extra?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        {value === null ? <Skeleton className="mt-1 h-6 w-16" /> : <p className="tabular text-xl font-semibold tracking-tight">{value}</p>}
      </div>
      {extra}
    </div>
  )
}

export function LiveStrip() {
  useChannel(CHANNELS.metrics)
  const metrics = useStore(liveStore, (s) => s.metrics)
  const history = useStore(liveStore, (s) => s.onlineHistory)
  const online = useRealtimeStatus().status === 'online'

  return (
    <section aria-label="Сейчас в магазине" className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-2 text-xs font-medium">
        <span className={cn('size-2 rounded-full', online ? 'pulse-dot bg-success' : 'bg-muted-foreground')} aria-hidden />
        <span>{online ? 'Прямо сейчас' : 'Обновление приостановлено — нет связи'}</span>
        <span className="ml-auto hidden text-muted-foreground sm:inline">WebSocket · канал metrics · каждые 2 с</span>
      </div>
      {/* aria-live не ставим: цифры меняются каждые 2 с, скринридер читал бы их без остановки. */}
      <div className={cn('grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4', !online && 'opacity-60')}>
        <Tile icon={<EyeIcon />} label="Сейчас на сайте" value={metrics && formatNumber(metrics.online)} extra={<Sparkline values={history} />} />
        <Tile icon={<ShoppingCartIcon />} label="Активных корзин" value={metrics && formatNumber(metrics.carts)} />
        <Tile icon={<ShoppingBagIcon />} label="Заказов сегодня" value={metrics && formatNumber(metrics.ordersToday)} />
        <Tile icon={<WalletIcon />} label="Выручка сегодня" value={metrics && formatMoney(metrics.revenueToday)} />
      </div>
    </section>
  )
}
