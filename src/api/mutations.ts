/**
 * Изменения данных (мутации).
 *
 * У мутации четыре момента, в которые можно вмешаться:
 *   onMutate  — до запроса: здесь делают «оптимистичное» обновление;
 *   onError   — сервер отказал: откатываем оптимистичное;
 *   onSuccess — сервер ответил: кладём в кэш настоящий ответ;
 *   onSettled — в любом случае: пометить связанные данные устаревшими.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { auth } from '@/lib/auth'
import { ORDER_STATUS_LABELS, count } from '@/lib/format'
import { RealtimeError } from '@/realtime/client'
import { realtime } from '@/realtime/instance'
import type { Note, Order, OrderDetail, OrderRow, OrderStatus, Page, Product, ProductInput, Session } from '@/shared/types'

import { ApiError, api } from './http'
import { keys } from './queries'

export function useLogin() {
  return useMutation({
    mutationFn: (userId: string) => api<Session>('/auth/login', { method: 'POST', body: { userId } }),
    onSuccess: (session) => auth.set(session),
  })
}

/**
 * Смена статуса заказа — оптимистичное обновление.
 *
 * Обычный путь: нажал → ждёшь ответа → интерфейс обновился. Оптимистичный:
 * нажал → интерфейс обновился СРАЗУ, запрос идёт следом. Если сервер откажет —
 * возвращаем как было и объясняем. Для действий, которые почти всегда
 * удаются, это делает интерфейс мгновенным.
 */
export function useOrderStatus(orderId: string) {
  const queryClient = useQueryClient()
  const key = keys.order(orderId)

  return useMutation({
    mutationFn: (input: { status: OrderStatus; version: number }) => api<Order>(`/orders/${orderId}`, { method: 'PATCH', body: input }),

    onMutate: async ({ status }) => {
      // Идущий сейчас запрос этого заказа мог бы прийти позже и затереть наше обновление.
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<OrderDetail>(key)
      // Версию НЕ трогаем: её увеличит ответ сервера. Так событие из сокета о нашей же
      // правке (оно может прийти раньше ответа) будет принято, а не отброшено как старое.
      if (previous) queryClient.setQueryData<OrderDetail>(key, { ...previous, order: { ...previous.order, status } })
      // То, что вернули, придёт третьим аргументом в onError — оттуда и откатываем.
      return { previous }
    },

    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
      toast.error('Статус не изменён', { description: error.message })
      // 409 — заказ успел изменить кто-то другой: показываем свежие данные.
      if (error instanceof ApiError && error.status === 409) void queryClient.invalidateQueries({ queryKey: key })
    },

    onSuccess: (order) => {
      queryClient.setQueryData<OrderDetail>(key, (detail) => (detail && detail.order.version <= order.version ? { ...detail, order } : detail))
      queryClient.setQueriesData<Page<OrderRow>>({ queryKey: keys.orderLists }, (page) =>
        page ? { ...page, rows: page.rows.map((row) => (row.id === order.id ? { ...row, status: order.status, version: order.version, updatedAt: order.updatedAt } : row)) } : page,
      )
      toast.success(`${order.number}: ${ORDER_STATUS_LABELS[order.status].toLowerCase()}`)
    },
  })
}

export function useBulkStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { ids: string[]; status: OrderStatus }) => api<{ updated: string[]; skipped: string[] }>('/orders/bulk-status', { method: 'POST', body: input }),
    onSuccess: ({ updated, skipped }, { status }) => {
      const label = ORDER_STATUS_LABELS[status].toLowerCase()
      if (updated.length) toast.success(`${count(updated.length, ['заказ', 'заказа', 'заказов'])} → ${label}`)
      // Частичный успех — не ошибка, но человек должен о нём знать.
      if (skipped.length) toast.warning(`Пропущено: ${skipped.length}`, { description: `Для них переход в статус «${label}» невозможен` })
    },
    onError: (error) => toast.error('Не удалось изменить статусы', { description: error.message }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.orders }),
  })
}

/**
 * Заметка к заказу — через сокет, а не HTTP: оптимистичный показ, подтверждение (ack)
 * и безопасный повтор после обрыва связи.
 */
export function useAddNote(orderId: string) {
  const queryClient = useQueryClient()
  const key = keys.order(orderId)

  return useMutation({
    mutationFn: ({ text, clientId }: { text: string; clientId: string }) =>
      // retry: true — запрос идемпотентный: сервер узнаёт повтор по clientId и не создаст вторую заметку.
      realtime.request('note.add', { orderId, text, clientId }, { retry: true, timeout: 15_000 }),

    onMutate: ({ text, clientId }) => {
      const user = auth.session!.user
      // Временная заметка: id = clientId. По нему её найдёт и заменит событие note.added.
      const optimistic: Note = { id: clientId, orderId, authorId: user.id, authorName: user.name, hue: user.hue, text, at: new Date().toISOString() }
      queryClient.setQueryData<OrderDetail>(key, (detail) => (detail ? { ...detail, notes: [...detail.notes, optimistic] } : detail))
    },

    onSuccess: ({ note }, { clientId }) => {
      // Обычно событие note.added уже заменило временную заметку; если ack пришёл раньше — заменяем здесь.
      queryClient.setQueryData<OrderDetail>(key, (detail) =>
        detail
          ? {
              ...detail,
              notes: detail.notes.some((n) => n.id === note.id) ? detail.notes.filter((n) => n.id !== clientId) : detail.notes.map((n) => (n.id === clientId ? note : n)),
            }
          : detail,
      )
    },

    onError: (error, { clientId }) => {
      queryClient.setQueryData<OrderDetail>(key, (detail) => (detail ? { ...detail, notes: detail.notes.filter((n) => n.id !== clientId) } : detail))
      toast.error('Заметка не отправлена', { description: error instanceof RealtimeError ? error.message : 'Попробуйте ещё раз' })
    },
  })
}

export function useSaveProduct(id: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ProductInput) => (id ? api<Product>(`/products/${id}`, { method: 'PUT', body: input }) : api<Product>('/products', { method: 'POST', body: input })),
    onSuccess: (product) => {
      queryClient.setQueryData(keys.product(product.id), product)
      // Списки с фильтрами не пересобрать на клиенте — просим перезапросить.
      void queryClient.invalidateQueries({ queryKey: keys.productLists })
      toast.success(id ? 'Товар сохранён' : 'Товар создан')
    },
    // Ошибки по полям показывает форма; здесь — только неожиданные.
    onError: (error) => {
      if (!(error instanceof ApiError && Object.keys(error.fields).length)) toast.error('Не удалось сохранить', { description: error.message })
    },
  })
}

export function useDeleteProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (product: Product) => api<void>(`/products/${product.id}`, { method: 'DELETE' }),
    onSuccess: (_result, product) => {
      queryClient.removeQueries({ queryKey: keys.product(product.id) })
      void queryClient.invalidateQueries({ queryKey: keys.productLists })
      toast.success(`«${product.title}» удалён`)
    },
    onError: (error) => toast.error('Не удалось удалить', { description: error.message }),
  })
}
