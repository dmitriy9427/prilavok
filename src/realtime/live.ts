/**
 * «Живое» состояние, которое приходит из сокета и не является кэшем HTTP-запроса.
 *
 * Кэш TanStack Query отвечает на вопрос «что сказал сервер на такой-то
 * запрос». А вот «посетителей сейчас 42» или «с момента открытия списка
 * пришло 3 новых заказа» — не ответы на запросы. Им место здесь.
 */
import { createStore } from '@/lib/store'
import type { LiveMetrics, OrderRow } from '@/shared/types'

export type LiveState = {
  /** Последние цифры канала metrics; null — ещё не приходили. */
  metrics: LiveMetrics | null
  /** История «посетителей онлайн» для мини-графика. */
  onlineHistory: number[]
  /** Заказы, созданные, пока приложение открыто (новые сверху). */
  feed: OrderRow[]
  /** Id заказов, появившихся после последнего обновления списка. */
  fresh: string[]
  /** Заказ → когда его последний раз изменило событие (для подсветки строки). */
  touched: Record<string, number>
  /** Непрочитанных уведомлений. */
  unread: number
}

export const liveStore = createStore<LiveState>({ metrics: null, onlineHistory: [], feed: [], fresh: [], touched: {}, unread: 0 })

export const live = {
  metrics(metrics: LiveMetrics) {
    liveStore.set((s) => ({ ...s, metrics, onlineHistory: [...s.onlineHistory, metrics.online].slice(-40) }))
  },
  orderCreated(order: OrderRow) {
    liveStore.set((s) => ({ ...s, feed: [order, ...s.feed].slice(0, 30), fresh: [...s.fresh, order.id], touched: { ...s.touched, [order.id]: Date.now() } }))
  },
  orderTouched(id: string, patch?: Partial<OrderRow>) {
    liveStore.set((s) => ({
      ...s,
      touched: { ...s.touched, [id]: Date.now() },
      feed: patch ? s.feed.map((order) => (order.id === id ? { ...order, ...patch } : order)) : s.feed,
    }))
  },
  /** Список заказов обновили — «новых» больше нет. */
  clearFresh() {
    liveStore.set((s) => (s.fresh.length ? { ...s, fresh: [] } : s))
  },
  notified() {
    liveStore.set((s) => ({ ...s, unread: s.unread + 1 }))
  },
  readAll() {
    liveStore.set((s) => (s.unread ? { ...s, unread: 0 } : s))
  },
  reset() {
    liveStore.set({ metrics: null, onlineHistory: [], feed: [], fresh: [], touched: {}, unread: 0 })
  },
}

/** Событие было только что — строку стоит подсветить. Старые отметки не подсвечиваем (например, при возврате на экран). */
export const isRecent = (touchedAt: number | undefined) => touchedAt !== undefined && Date.now() - touchedAt < 2500
