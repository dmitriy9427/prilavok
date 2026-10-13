import { beforeEach, describe, expect, it } from 'vitest'

import type { OrderDetail, OrderRow, Page, Product, ProductInput, Stats } from '../shared/types'
import { createBackend, type Backend } from './index'
import type { Connection } from './hub'

/** Фиксированное «сейчас»: данные и тесты не зависят от дня запуска. */
const NOW = new Date(2026, 9, 13, 15, 0).getTime()

let backend: Backend
/** События, которые получил подписчик сокета. */
let events: { type: string; channel: string; data: Record<string, unknown> }[]

beforeEach(() => {
  backend = createBackend({ now: () => NOW })
  events = []
  const conn: Connection = {
    send: (data) => {
      const frame = JSON.parse(data)
      if (frame.t === 'event') events.push(frame)
    },
    close: () => {},
  }
  backend.hub.connect(conn)
  backend.hub.receive(conn, JSON.stringify({ t: 'hello', v: 1, token: 'demo.u_admin', channels: ['orders', 'notifications', 'products'], resume: null }))
})

function call<T = unknown>(method: string, url: string, { body = null as unknown, as = 'admin' as 'admin' | 'manager' | 'viewer' | null } = {}) {
  const [path, query = ''] = url.split('?')
  const response = backend.handle({ method, path: path!, query: new URLSearchParams(query), body, authorization: as ? `Bearer demo.u_${as}` : null })
  return { status: response.status, body: response.body as T, error: (response.body as { error?: { code: string; fields?: Record<string, string> } })?.error }
}

const PRODUCT: ProductInput = { title: 'Тестовый кофе', sku: 'TEST-1', category: 'coffee', price: 500, oldPrice: null, stock: 10, status: 'draft', description: '', variants: [] }

describe('доступ', () => {
  it('без токена — 401', () => {
    expect(call('GET', '/orders', { as: null }).status).toBe(401)
  })

  it('вход выдаёт токен, с которым пускают', () => {
    const login = call<{ token: string }>('POST', '/auth/login', { body: { userId: 'u_manager' }, as: null })
    expect(login.status).toBe(200)
    expect(login.body.token).toBe('demo.u_manager')
  })

  it('неизвестный адрес — 404', () => {
    expect(call('GET', '/nothing').status).toBe(404)
  })

  it('наблюдатель читает, но не меняет — 403', () => {
    expect(call('GET', '/orders', { as: 'viewer' }).status).toBe(200)
    expect(call('POST', '/products', { body: PRODUCT, as: 'viewer' }).status).toBe(403)
  })

  it('менеджер создаёт товары, но не удаляет', () => {
    expect(call('POST', '/products', { body: PRODUCT, as: 'manager' }).status).toBe(201)
    expect(call('DELETE', '/products/p_1', { as: 'manager' }).status).toBe(403)
    expect(call('DELETE', '/products/p_1', { as: 'admin' }).status).toBe(204)
  })
})

describe('заказы: список', () => {
  const list = (query = '') => call<Page<OrderRow>>('GET', `/orders?${query}`).body

  it('отдаёт страницу и общее число строк', () => {
    const page = list('size=20')
    expect(page.rows).toHaveLength(20)
    expect(page.rowCount).toBeGreaterThan(1000)
    expect(page.rows[0]).not.toHaveProperty('items') // строка списка — без состава
  })

  it('по умолчанию — свежие сверху', () => {
    const dates = list().rows.map((row) => row.createdAt)
    expect(dates).toEqual([...dates].sort().reverse())
  })

  it('страницы не пересекаются', () => {
    const first = list('page=0&size=10').rows.map((r) => r.id)
    const second = list('page=1&size=10').rows.map((r) => r.id)
    expect(first.filter((id) => second.includes(id))).toEqual([])
  })

  it('фильтрует по нескольким статусам', () => {
    const page = list('status=new,paid&size=100')
    expect(page.rows.length).toBeGreaterThan(0)
    expect(page.rows.every((row) => row.status === 'new' || row.status === 'paid')).toBe(true)
  })

  it('сортирует по сумме', () => {
    const totals = list('sort=total&dir=asc&size=50').rows.map((row) => row.total)
    expect(totals).toEqual([...totals].sort((a, b) => a - b))
  })

  it('ищет по клиенту без учёта регистра и «ё»', () => {
    const page = list('q=СЕМЕНОВ&size=100')
    expect(page.rows.length).toBeGreaterThan(0)
    expect(page.rows.every((row) => row.customerName.includes('Семёнов'))).toBe(true)
  })

  it('фильтрует по датам включительно', () => {
    const page = list('from=2026-10-10&to=2026-10-11&size=100')
    expect(page.rows.length).toBeGreaterThan(0)
    expect(page.rows.every((row) => ['10', '11'].includes(String(new Date(row.createdAt).getDate())))).toBe(true)
  })

  it('мусор в параметрах заменяется значениями по умолчанию', () => {
    const page = list('page=abc&size=100500&sort=password&status=hacked')
    expect(page.rows.length).toBe(100) // размер ограничен сверху
    expect(page.rowCount).toBe(list().rowCount)
  })
})

describe('заказы: статус', () => {
  const fresh = () => call<Page<OrderRow>>('GET', '/orders?status=new&size=1').body.rows[0]!

  it('меняет статус, пишет историю и сообщает в сокет', () => {
    const order = fresh()
    const result = call<{ status: string; version: number; history: { by: string }[] }>('PATCH', `/orders/${order.id}`, { body: { status: 'paid', version: order.version } })

    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ status: 'paid', version: order.version + 1 })
    expect(result.body.history.at(-1)).toMatchObject({ status: 'paid', by: 'Дмитрий Рябов' })
    expect(events.at(-1)).toMatchObject({ type: 'order.updated', channel: 'orders', data: { id: order.id, status: 'paid', version: order.version + 1 } })
  })

  it('устаревшая версия — 409, заказ не тронут', () => {
    const order = fresh()
    const result = call('PATCH', `/orders/${order.id}`, { body: { status: 'paid', version: order.version - 1 } })
    expect(result.status).toBe(409)
    expect(result.error?.code).toBe('version_conflict')
    expect(call<OrderDetail>('GET', `/orders/${order.id}`).body.order.status).toBe('new')
  })

  it('невозможный переход — 409', () => {
    const order = fresh()
    expect(call('PATCH', `/orders/${order.id}`, { body: { status: 'delivered', version: order.version } }).error?.code).toBe('bad_transition')
  })

  it('отмена создаёт уведомление', () => {
    const order = fresh()
    call('PATCH', `/orders/${order.id}`, { body: { status: 'cancelled', version: order.version } })
    expect(events.at(-1)).toMatchObject({ type: 'notification', channel: 'notifications' })
    expect(call<{ kind: string }[]>('GET', '/notifications').body[0]).toMatchObject({ kind: 'cancel' })
  })

  it('массовая смена: возможные меняет, остальные честно перечисляет', () => {
    const news = call<Page<OrderRow>>('GET', '/orders?status=new&size=2').body.rows.map((r) => r.id)
    const delivered = call<Page<OrderRow>>('GET', '/orders?status=delivered&size=1').body.rows[0]!.id
    const result = call<{ updated: string[]; skipped: string[] }>('POST', '/orders/bulk-status', { body: { ids: [...news, delivered, 'нет-такого'], status: 'paid' } })
    expect(result.body.updated).toEqual(news)
    expect(result.body.skipped).toEqual([delivered, 'нет-такого'])
  })

  it('карточка заказа: состав, заметки и клиент', () => {
    const detail = call<OrderDetail>('GET', `/orders/${fresh().id}`).body
    expect(detail.order.items.length).toBeGreaterThan(0)
    expect(detail.order.total).toBe(detail.order.items.reduce((sum, item) => sum + item.price * item.qty, 0))
    expect(detail.customer?.name).toBe(detail.order.customerName)
    expect(call('GET', '/orders/nope').status).toBe(404)
  })
})

describe('товары', () => {
  it('создаёт товар и находит его поиском', () => {
    const created = call<Product>('POST', '/products', { body: PRODUCT })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ title: 'Тестовый кофе', sold: 0 })
    expect(call<Product[]>('GET', '/products?q=test-1').body.map((p) => p.id)).toEqual([created.body.id])
  })

  it('ошибки проверки — 422 с именами полей', () => {
    const result = call('POST', '/products', { body: { ...PRODUCT, title: 'А', sku: 'плохой', price: -5 } })
    expect(result.status).toBe(422)
    expect(Object.keys(result.error!.fields!).sort()).toEqual(['price', 'sku', 'title'])
  })

  it('старая цена должна быть выше текущей', () => {
    expect(call('POST', '/products', { body: { ...PRODUCT, oldPrice: 400 } }).error?.fields).toHaveProperty('oldPrice')
  })

  it('занятый артикул — 409 с ошибкой у поля', () => {
    call('POST', '/products', { body: PRODUCT })
    const again = call('POST', '/products', { body: PRODUCT })
    expect(again.status).toBe(409)
    expect(again.error?.fields).toEqual({ sku: 'Такой артикул уже есть' })
  })

  it('свой артикул при сохранении не считается занятым', () => {
    const { body } = call<Product>('POST', '/products', { body: PRODUCT })
    expect(call('PUT', `/products/${body.id}`, { body: { ...PRODUCT, price: 600 } }).status).toBe(200)
  })

  it('остаток товара с вариантами — сумма по вариантам', () => {
    const variants = [
      { name: '250 г', priceDelta: 0, stock: 4 },
      { name: '1 кг', priceDelta: 900, stock: 6 },
    ]
    expect(call<Product>('POST', '/products', { body: { ...PRODUCT, stock: 999, variants } }).body.stock).toBe(10)
  })

  it('повторяющиеся названия вариантов отклоняются', () => {
    const variants = [
      { name: '250 г', priceDelta: 0, stock: 1 },
      { name: '250 Г', priceDelta: 0, stock: 1 },
    ]
    expect(call('POST', '/products', { body: { ...PRODUCT, variants } }).status).toBe(422)
  })

  it('фильтрует по категории и статусу', () => {
    const list = call<Product[]>('GET', '/products?category=tea&status=active').body
    expect(list.length).toBeGreaterThan(0)
    expect(list.every((p) => p.category === 'tea' && p.status === 'active')).toBe(true)
  })
})

describe('клиенты', () => {
  type Cursor = { rows: { id: string; name: string }[]; nextCursor: number | null; total: number }

  it('отдаёт порции по курсору без пропусков и повторов', () => {
    const first = call<Cursor>('GET', '/customers?limit=100').body
    const second = call<Cursor>('GET', `/customers?limit=100&cursor=${first.nextCursor}`).body
    expect(first.total).toBe(10_000)
    expect(first.nextCursor).toBe(100)
    expect(second.rows[0]!.id).toBe('c_101')
  })

  it('на последней порции курсор заканчивается', () => {
    expect(call<Cursor>('GET', '/customers?cursor=9950&limit=100').body).toMatchObject({ nextCursor: null })
  })

  it('ищет по имени', () => {
    const found = call<Cursor>('GET', '/customers?q=королёва').body
    expect(found.total).toBeGreaterThan(0)
    expect(found.rows.every((c) => c.name.includes('Королёва'))).toBe(true)
  })
})

describe('статистика', () => {
  it('ряд по дням покрывает период, суммы сходятся', () => {
    const stats = call<Stats>('GET', '/stats?period=7').body
    expect(stats.series).toHaveLength(7)
    expect(stats.series.at(-1)!.day).toBe('2026-10-13')
    expect(stats.series.reduce((sum, d) => sum + d.revenue, 0)).toBe(stats.kpi.revenue)
    expect(stats.series.reduce((sum, d) => sum + d.orders, 0)).toBe(stats.kpi.orders)
  })

  it('отменённые заказы не идут в выручку, но видны в разбивке по статусам', () => {
    const stats = call<Stats>('GET', '/stats?period=30').body
    const all = stats.byStatus.reduce((sum, s) => sum + s.count, 0)
    const cancelled = stats.byStatus.find((s) => s.status === 'cancelled')!.count
    expect(cancelled).toBeGreaterThan(0)
    expect(stats.kpi.orders).toBe(all - cancelled)
  })

  it('неизвестный период заменяется на 30 дней', () => {
    expect(call<Stats>('GET', '/stats?period=13').body.period).toBe(30)
  })

  it('данные одинаковы при каждом запуске (зерно)', () => {
    const again = createBackend({ now: () => NOW })
    expect(again.db.orders.length).toBe(backend.db.orders.length)
    expect(again.db.orders.at(-1)!.total).toBe(backend.db.orders.at(-1)!.total)
  })
})

describe('заметки через сокет', () => {
  it('повтор запроса с тем же clientId не создаёт вторую заметку', () => {
    const frames: { t: string; result?: { note: { id: string } } }[] = []
    const conn: Connection = { send: (data) => frames.push(JSON.parse(data)), close: () => {} }
    backend.hub.connect(conn)
    backend.hub.receive(conn, JSON.stringify({ t: 'hello', v: 1, token: 'demo.u_manager', channels: [], resume: null }))
    const orderId = backend.db.orders.at(-1)!.id
    const before = backend.db.notesOf(orderId).length
    const req = (id: string) => backend.hub.receive(conn, JSON.stringify({ t: 'req', id, method: 'note.add', params: { orderId, text: 'привет', clientId: 'same' } }))

    req('r1')
    req('r2') // клиент переподключился и повторил
    const acks = frames.filter((f) => f.t === 'ack')
    expect(acks).toHaveLength(2)
    expect(acks[0]!.result!.note.id).toBe(acks[1]!.result!.note.id)
    expect(backend.db.notesOf(orderId)).toHaveLength(before + 1)
  })

  it('наблюдателю писать заметки нельзя', () => {
    const frames: { t: string; ok?: boolean; error?: { code: string } }[] = []
    const conn: Connection = { send: (data) => frames.push(JSON.parse(data)), close: () => {} }
    backend.hub.connect(conn)
    backend.hub.receive(conn, JSON.stringify({ t: 'hello', v: 1, token: 'demo.u_viewer', channels: [], resume: null }))
    backend.hub.receive(conn, JSON.stringify({ t: 'req', id: 'r1', method: 'note.add', params: { orderId: backend.db.orders[0]!.id, text: 'x', clientId: 'c' } }))
    expect(frames.find((f) => f.t === 'ack')).toMatchObject({ ok: false, error: { code: 'forbidden' } })
  })
})
