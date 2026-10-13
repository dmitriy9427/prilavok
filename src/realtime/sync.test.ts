import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { keys } from '@/api/queries'
import type { Note, Order, OrderDetail, OrderRow, Page, Product } from '@/shared/types'
import { FakeSocket, asWebSocket } from '@/test/fake-socket'

import { RealtimeClient } from './client'
import { live, liveStore } from './live'
import { attachRealtimeSync } from './sync'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: vi.fn() }) }))

const ORDER = { id: 'o1', number: 'П-1', status: 'new', version: 1, updatedAt: 'a', history: [{ at: 'a', status: 'new', by: 'Сайт' }], items: [] } as unknown as Order
const ROW = { id: 'o1', number: 'П-1', status: 'new', version: 1, updatedAt: 'a' } as OrderRow
const note = (id: string, text = 'текст') => ({ id, orderId: 'o1', text }) as Note

let queryClient: QueryClient
let client: RealtimeClient
let resync: () => void
let seq = 0

/** Сервер прислал событие. */
const emit = (channel: string, type: string, data: unknown, numbered = true) => FakeSocket.last.receive({ t: 'event', seq: numbered ? ++seq : null, channel, type, data, at: 0 })
const detail = () => queryClient.getQueryData<OrderDetail>(keys.order('o1'))!
const list = () => queryClient.getQueryData<Page<OrderRow>>([...keys.orderLists, { page: 0 }])!

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.reset()
  live.reset()
  seq = 0
  queryClient = new QueryClient()
  queryClient.setQueryData<OrderDetail>(keys.order('o1'), { order: ORDER, notes: [], customer: null })
  queryClient.setQueryData<Page<OrderRow>>([...keys.orderLists, { page: 0 }], { rows: [ROW, { ...ROW, id: 'o2' }], rowCount: 2 })

  client = new RealtimeClient({ url: 'ws://t', getToken: () => 't', WebSocket: asWebSocket })
  attachRealtimeSync(client, queryClient, (handler) => (resync = handler))
  for (const channel of ['orders', 'order:o1', 'metrics', 'products', 'notifications']) client.subscribe(channel)
  client.start()
  FakeSocket.last.open()
  FakeSocket.last.receive({ t: 'welcome', sessionId: 's', user: { id: 'u', name: 'n', email: 'e', role: 'admin', hue: 1 }, epoch: 'e', seq: 0, resumed: true, serverTime: 0 })
})
afterEach(() => {
  client.stop()
  vi.useRealTimers()
})

describe('order.updated', () => {
  const update = (version: number, status = 'paid') => emit('orders', 'order.updated', { id: 'o1', status, version, updatedAt: 'b', by: 'Вера' })

  it('обновляет карточку и дописывает историю', () => {
    update(2)
    expect(detail().order).toMatchObject({ status: 'paid', version: 2, updatedAt: 'b' })
    expect(detail().order.history.at(-1)).toEqual({ at: 'b', status: 'paid', by: 'Вера' })
  })

  it('обновляет строку во всех закэшированных списках, соседние не трогает', () => {
    update(2)
    expect(list().rows[0]).toMatchObject({ status: 'paid', version: 2 })
    expect(list().rows[1]).toMatchObject({ id: 'o2', status: 'new' })
  })

  it('событие о версии, которая уже в кэше, не применяется второй раз', () => {
    // Мы сами изменили заказ: ответ сервера уже в кэше, следом пришло событие о той же правке.
    queryClient.setQueryData<OrderDetail>(keys.order('o1'), (d) => ({
      ...d!,
      order: { ...d!.order, status: 'paid', version: 2, history: [...d!.order.history, { at: 'b', status: 'paid', by: 'Я' }] },
    }))
    update(2)
    expect(detail().order.history).toHaveLength(2)
  })

  it('запоздавшее старое событие не откатывает заказ', () => {
    update(3, 'packing')
    update(2, 'paid')
    expect(detail().order.status).toBe('packing')
  })

  it('заказа нет в кэше — ничего не создаёт', () => {
    emit('orders', 'order.updated', { id: 'чужой', status: 'paid', version: 9, updatedAt: 'b', by: 'x' })
    expect(queryClient.getQueryData(keys.order('чужой'))).toBeUndefined()
  })
})

describe('note.added', () => {
  it('добавляет чужую заметку', () => {
    emit('order:o1', 'note.added', { note: note('n_1'), clientId: null })
    expect(detail().notes.map((n) => n.id)).toEqual(['n_1'])
  })

  it('заменяет свою временную заметку настоящей', () => {
    queryClient.setQueryData<OrderDetail>(keys.order('o1'), (d) => ({ ...d!, notes: [note('tmp-1')] }))
    emit('order:o1', 'note.added', { note: note('n_7'), clientId: 'tmp-1' })
    expect(detail().notes.map((n) => n.id)).toEqual(['n_7'])
  })

  it('повторное событие не дублирует заметку', () => {
    emit('order:o1', 'note.added', { note: note('n_1'), clientId: null })
    queryClient.setQueryData<OrderDetail>(keys.order('o1'), (d) => ({ ...d!, notes: [...d!.notes] }))
    // тот же факт пришёл ещё раз (например, ack обработан раньше события)
    client.on('note.added', () => {})
    FakeSocket.last.receive({ t: 'event', seq: ++seq, channel: 'order:o1', type: 'note.added', data: { note: note('n_1'), clientId: null }, at: 0 })
    expect(detail().notes).toHaveLength(1)
  })
})

describe('остальные события', () => {
  it('order.created копится в счётчике, а список не трогает', () => {
    emit('orders', 'order.created', { order: { ...ROW, id: 'o9' } })
    expect(liveStore.get().fresh).toEqual(['o9'])
    expect(liveStore.get().feed[0]!.id).toBe('o9')
    expect(list().rows).toHaveLength(2)
  })

  it('metrics.tick попадает в живое состояние', () => {
    emit('metrics', 'metrics.tick', { online: 42, carts: 3, ordersToday: 1, revenueToday: 10 }, false)
    expect(liveStore.get().metrics?.online).toBe(42)
    expect(liveStore.get().onlineHistory).toEqual([42])
  })

  it('product.stock правит карточку и списки товаров', () => {
    queryClient.setQueryData<Product>(keys.product('p1'), { id: 'p1', stock: 9 } as Product)
    queryClient.setQueryData<Product[]>([...keys.productLists, {}], [{ id: 'p1', stock: 9 } as Product, { id: 'p2', stock: 5 } as Product])
    emit('products', 'product.stock', { id: 'p1', stock: 2 })
    expect(queryClient.getQueryData<Product>(keys.product('p1'))!.stock).toBe(2)
    expect(queryClient.getQueryData<Product[]>([...keys.productLists, {}])!.map((p) => p.stock)).toEqual([2, 5])
  })

  it('уведомление попадает в список и счётчик непрочитанных', () => {
    emit('notifications', 'notification', { notification: { id: 'x', kind: 'order', title: 'Крупный заказ', body: '', at: '', link: null } })
    expect(queryClient.getQueryData<{ id: string }[]>(keys.notifications)![0]!.id).toBe('x')
    expect(liveStore.get().unread).toBe(1)
  })

  it('статистика помечается устаревшей не на каждое событие, а раз в 10 секунд', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    for (let i = 2; i < 7; i++) emit('orders', 'order.updated', { id: 'o1', status: 'paid', version: i, updatedAt: 'b', by: 'x' })
    expect(invalidate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.stats })
  })

  it('resync помечает устаревшим весь кэш', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    resync()
    expect(invalidate).toHaveBeenCalledWith()
  })
})
