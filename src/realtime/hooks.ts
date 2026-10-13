/**
 * Хуки: как компоненты пользуются сокетом.
 */
import { useEffect, useEffectEvent, useSyncExternalStore } from 'react'

import type { EventFrame, ServerEvents, ServerEventType } from '@/shared/protocol'

import { realtime } from './instance'

/** Состояние соединения (статус, задержка, попытки) — компонент перерисуется при изменении. */
export const useRealtimeStatus = () => useSyncExternalStore(realtime.subscribeState, realtime.getSnapshot)

/** Журнал кадров для экрана «Соединение». */
export const useFrameLog = () => useSyncExternalStore(realtime.subscribeFrames, realtime.getFrames)

/**
 * Подписаться на канал, пока компонент на экране.
 *
 * useEffect возвращает функцию очистки — React вызовет её при размонтировании
 * или смене канала. Так подписка не может «утечь»: ушли со страницы заказа —
 * сервер перестал слать нам его события.
 */
export function useChannel(channel: string | null) {
  useEffect(() => (channel ? realtime.subscribe(channel) : undefined), [channel])
}

/**
 * Реагировать на события одного вида.
 *
 * useEffectEvent даёт обработчик, который всегда видит свежие пропсы и
 * состояние, но не заставляет эффект переподписываться при каждом рендере.
 */
export function useRealtimeEvent<T extends ServerEventType>(type: T, handler: (data: ServerEvents[T], frame: EventFrame<T>) => void) {
  const onEvent = useEffectEvent(handler)
  useEffect(() => realtime.on(type, (data, frame) => onEvent(data, frame)), [type])
}
