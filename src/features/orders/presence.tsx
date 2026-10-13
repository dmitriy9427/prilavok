/**
 * «Сейчас смотрят» — присутствие в реальном времени.
 *
 * Зачем: два менеджера открыли один заказ и оба звонят клиенту. Аватары
 * коллег подсказывают: «этим заказом уже занимаются».
 *
 * Как устроено:
 *   1. подписка на канал order:<id> — сервер сразу присылает текущий список;
 *   2. запрос presence.focus — «я смотрю этот заказ»;
 *   3. уходим со страницы — presence.focus(null) и отписка.
 * Закрыли вкладку без «прощания» — сервер узнает об этом по закрытию
 * соединения и сам уберёт нас из списка.
 *
 * Присутствие привязано к СЕССИИ, а не к пользователю: после переподключения
 * сервер о нас ничего не помнит. Поэтому focus отправляется заново при каждой
 * новой сессии (эффект зависит от sessionId).
 */
import { useEffect, useState } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { UserAvatar } from '@/components/user-avatar'
import { useUser } from '@/lib/auth'
import { useChannel, useRealtimeEvent, useRealtimeStatus } from '@/realtime/hooks'
import { realtime } from '@/realtime/instance'
import { CHANNELS } from '@/shared/protocol'
import type { PresenceUser } from '@/shared/types'

export function usePresence(orderId: string) {
  const channel = CHANNELS.order(orderId)
  const [users, setUsers] = useState<PresenceUser[]>([])
  const { sessionId } = useRealtimeStatus()

  useChannel(channel)
  // Событие приходит из всех каналов заказов, на которые есть подписка, — берём только своё.
  useRealtimeEvent('presence', (data, frame) => {
    if (frame.channel === channel) setUsers(data.users)
  })

  useEffect(() => {
    if (!sessionId) return
    // Ошибку глотаем: присутствие — украшение, из-за него не должно ничего ломаться.
    realtime.request('presence.focus', { orderId }).catch(() => {})
    return () => {
      realtime.request('presence.focus', { orderId: null }).catch(() => {})
    }
  }, [orderId, sessionId])

  return users
}

export function Presence({ users }: { users: PresenceUser[] }) {
  const me = useUser()
  const others = users.filter((user) => user.id !== me?.id)
  if (!others.length) return null

  return (
    <div className="slide-in flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <div className="flex -space-x-2">
        {others.map((user) => (
          <Tooltip key={user.id}>
            <TooltipTrigger asChild>
              <span className="rounded-full ring-2 ring-background">
                <UserAvatar name={user.name} hue={user.hue} className="size-7 text-[11px]" />
              </span>
            </TooltipTrigger>
            <TooltipContent>{user.name}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <span>{others.length === 1 ? `${others[0]!.name} тоже смотрит этот заказ` : `Ещё ${others.length} человека смотрят этот заказ`}</span>
    </div>
  )
}
