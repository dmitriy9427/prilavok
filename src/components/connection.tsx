/**
 * Индикатор соединения в шапке и полоса «нет связи».
 *
 * Правило: человек должен знать, актуально ли то, что он видит. Данные в
 * реальном времени без индикатора хуже, чем обычные: им доверяют, а они могли
 * перестать обновляться час назад.
 */
import { Link } from '@tanstack/react-router'
import { WifiOffIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { RealtimeStatus } from '@/realtime/client'
import { useRealtimeStatus } from '@/realtime/hooks'
import { realtime } from '@/realtime/instance'

export const STATUS_TEXT: Record<RealtimeStatus, string> = {
  idle: 'Не подключено',
  connecting: 'Подключение…',
  handshaking: 'Подключение…',
  online: 'На связи',
  reconnecting: 'Переподключение…',
  offline: 'Нет сети',
  unauthorized: 'Нет доступа',
  stopped: 'Отключено',
}

const DOT: Record<RealtimeStatus, string> = {
  idle: 'bg-muted-foreground',
  connecting: 'bg-warning pulse-dot',
  handshaking: 'bg-warning pulse-dot',
  online: 'bg-success',
  reconnecting: 'bg-warning pulse-dot',
  offline: 'bg-destructive',
  unauthorized: 'bg-destructive',
  stopped: 'bg-muted-foreground',
}

export function ConnectionDot({ status, className }: { status: RealtimeStatus; className?: string }) {
  return <span className={cn('size-2 shrink-0 rounded-full', DOT[status], className)} aria-hidden />
}

/** Секунд до следующей попытки (обновляется раз в 250 мс, пока идёт отсчёт). */
function useCountdown(retryAt: number | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (retryAt === null) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [retryAt])
  return retryAt === null ? null : Math.max(0, Math.ceil((retryAt - now) / 1000))
}

export function ConnectionBadge() {
  const { status, latency } = useRealtimeStatus()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="sm" asChild className="gap-2 text-muted-foreground">
          <Link to="/realtime" aria-label={`Соединение: ${STATUS_TEXT[status]}`}>
            <ConnectionDot status={status} />
            <span className="hidden sm:inline">{STATUS_TEXT[status]}</span>
            {status === 'online' && latency !== null && <span className="tabular hidden text-xs lg:inline">{latency} мс</span>}
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>WebSocket-соединение с сервером. Нажмите, чтобы посмотреть подробности</TooltipContent>
    </Tooltip>
  )
}

/**
 * Полоса «нет связи». Показывается не сразу, а через 1,5 с: короткий обрыв
 * клиент чинит сам, и мигание полосы только пугало бы.
 */
export function OfflineBanner() {
  const { status } = useRealtimeStatus()
  // Компонент с отсчётом монтируется, только пока связи нет: восстановилась — он исчез вместе с таймером.
  return status === 'reconnecting' || status === 'offline' ? <DelayedBanner /> : null
}

function DelayedBanner() {
  const { status, retryAt, attempt } = useRealtimeStatus()
  const seconds = useCountdown(retryAt)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 1500)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b bg-warning/15 px-4 py-2 text-sm">
      <WifiOffIcon className="size-4 text-warning" aria-hidden />
      <span>
        {status === 'offline' ? 'Нет подключения к сети.' : 'Нет связи с сервером.'} Данные на экране могут быть неактуальны.
        {status === 'reconnecting' && seconds !== null && (
          <span className="tabular text-muted-foreground">
            {' '}
            Попытка {attempt} через {seconds} с
          </span>
        )}
      </span>
      {status === 'reconnecting' && (
        <Button size="xs" variant="outline" onClick={() => realtime.reconnectNow()}>
          Подключиться сейчас
        </Button>
      )}
    </div>
  )
}
