/**
 * Мост «сокет → кэш запросов».
 *
 * Экраны читают данные из кэша TanStack Query. Событие из сокета должно
 * оказаться там же — тогда обновятся все экраны, которые эти данные
 * показывают, и ни один компонент не узнает, откуда пришло обновление.
 *
 * Три способа отреагировать на событие — от точного к грубому:
 *
 *   1. setQueryData   — в событии есть всё нужное: правим кэш на месте,
 *                       запроса к серверу нет. (Статус заказа, заметка, остаток.)
 *   2. invalidate     — событие говорит лишь «что-то изменилось», а пересчитать
 *                       сами не можем: помечаем данные устаревшими, Query
 *                       перезапросит их, если они на экране. (Статистика.)
 *   3. ничего, но показать человеку — список с фильтрами и страницами нельзя
 *      поправить на месте (попадёт ли новый заказ под фильтр? на какую
 *      страницу?), а менять таблицу под рукой у человека нельзя. Копим счётчик
 *      и предлагаем: «3 новых заказа — показать». (Новые заказы.)
 */
import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { keys } from '@/api/queries'
import type { Notification, OrderDetail, OrderRow, Page, Product } from '@/shared/types'

import type { RealtimeClient } from './client'
import { live } from './live'

export function attachRealtimeSync(client: RealtimeClient, queryClient: QueryClient, onResync: (handler: () => void) => void) {
  // Статистику не пересчитываем на каждое событие: помечаем устаревшей не чаще раза в 10 секунд.
  let statsTimer: ReturnType<typeof setTimeout> | null = null
  const refreshStatsSoon = () => {
    statsTimer ??= setTimeout(() => {
      statsTimer = null
      void queryClient.invalidateQueries({ queryKey: keys.stats })
    }, 10_000)
  }

  const off = [
    client.on('metrics.tick', (metrics) => live.metrics(metrics)),

    client.on('order.created', ({ order }) => {
      live.orderCreated(order)
      refreshStatsSoon()
    }),

    client.on('order.updated', (event) => {
      // Версия защищает от двух ситуаций:
      //   - мы сами только что изменили заказ и уже записали ответ сервера в кэш —
      //     событие о нашей же правке придёт следом, и применять его второй раз нельзя;
      //   - события пришли не в том порядке, в каком случились.
      const isNewer = (current: { version: number }) => current.version < event.version

      queryClient.setQueryData<OrderDetail>(keys.order(event.id), (detail) =>
        detail && isNewer(detail.order)
          ? {
              ...detail,
              order: {
                ...detail.order,
                status: event.status,
                version: event.version,
                updatedAt: event.updatedAt,
                history: [...detail.order.history, { at: event.updatedAt, status: event.status, by: event.by }],
              },
            }
          : detail,
      )

      // setQueriesData — «все запросы, чей ключ начинается с…»: правим строку на всех
      // закэшированных страницах и при любых фильтрах.
      queryClient.setQueriesData<Page<OrderRow>>({ queryKey: keys.orderLists }, (page) =>
        page?.rows.some((row) => row.id === event.id && isNewer(row))
          ? { ...page, rows: page.rows.map((row) => (row.id === event.id ? { ...row, status: event.status, version: event.version, updatedAt: event.updatedAt } : row)) }
          : page,
      )

      live.orderTouched(event.id, { status: event.status, version: event.version, updatedAt: event.updatedAt })
      refreshStatsSoon()
    }),

    client.on('note.added', ({ note, clientId }) => {
      queryClient.setQueryData<OrderDetail>(keys.order(note.orderId), (detail) => {
        if (!detail || detail.notes.some((existing) => existing.id === note.id)) return detail
        // Своя заметка уже показана «оптимистично» под временным id — заменяем её настоящей.
        const optimistic = clientId ? detail.notes.findIndex((existing) => existing.id === clientId) : -1
        const notes = optimistic >= 0 ? detail.notes.with(optimistic, note) : [...detail.notes, note]
        return { ...detail, notes }
      })
    }),

    client.on('notification', ({ notification }) => {
      queryClient.setQueryData<Notification[]>(keys.notifications, (list) => [notification, ...(list ?? [])].slice(0, 50))
      live.notified()
      toast(notification.title, { description: notification.body })
    }),

    client.on('product.stock', ({ id, stock }) => {
      queryClient.setQueryData<Product>(keys.product(id), (product) => (product ? { ...product, stock } : product))
      queryClient.setQueriesData<Product[]>({ queryKey: keys.productLists }, (list) =>
        list?.some((product) => product.id === id) ? list.map((product) => (product.id === id ? { ...product, stock } : product)) : list,
      )
    }),
  ]

  // Сервер не смог дослать пропущенные события: кэшу больше нельзя верить.
  // Помечаем устаревшим ВСЁ — то, что на экране, перезапросится сразу.
  onResync(() => {
    void queryClient.invalidateQueries()
    toast.info('Связь восстановлена', { description: 'Данные обновлены' })
  })

  return () => {
    for (const unsubscribe of off) unsubscribe()
    if (statsTimer) clearTimeout(statsTimer)
  }
}
