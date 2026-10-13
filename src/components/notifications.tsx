import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { BellIcon, PackageIcon, ShoppingBagIcon, XCircleIcon } from 'lucide-react'
import { useState } from 'react'

import { notificationsQuery } from '@/api/queries'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatRelative } from '@/lib/format'
import { useStore } from '@/lib/store'
import { live, liveStore } from '@/realtime/live'
import type { NotificationKind } from '@/shared/types'

const ICONS: Record<NotificationKind, typeof BellIcon> = { order: ShoppingBagIcon, stock: PackageIcon, cancel: XCircleIcon, info: BellIcon }

/** «Колокольчик»: список приходит по HTTP один раз, дальше пополняется событиями сокета (sync.ts). */
export function Notifications() {
  const [open, setOpen] = useState(false)
  const unread = useStore(liveStore, (s) => s.unread)
  const { data = [] } = useQuery(notificationsQuery)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) live.readAll()
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Уведомления, новых: ${unread}` : 'Уведомления'}>
          <BellIcon />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <p className="border-b px-4 py-3 text-sm font-medium">Уведомления</p>
        {data.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Пока тихо. Сюда приходят крупные заказы, отмены и товары на исходе.</p>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {data.map((item) => {
              const Icon = ICONS[item.kind]
              const body = (
                <>
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{item.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.body}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(item.at)}</span>
                </>
              )
              return (
                <li key={item.id} className="slide-in border-b last:border-b-0">
                  {item.link ? (
                    <Link to={item.link} onClick={() => setOpen(false)} className="flex gap-3 px-4 py-3 hover:bg-muted/60">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex gap-3 px-4 py-3">{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
