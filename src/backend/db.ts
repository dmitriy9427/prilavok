/**
 * База данных в памяти.
 *
 * Обычные массивы и Map вместо PostgreSQL: демо должно работать без сервера.
 * Но граница проведена так же, как с настоящей базой: остальной бэкенд зовёт
 * методы («найди заказы по фильтру»), а не лезет в массивы. Заменить
 * реализацию на SQL можно, не трогая обработчики.
 */
import type {
  Category,
  Customer,
  CursorPage,
  Note,
  Notification,
  Order,
  OrderRow,
  OrderStatus,
  Page,
  Product,
  ProductInput,
  ProductStatus,
  Segment,
  Stats,
  StatsPeriod,
} from '../shared/types.ts'
import { dayKey, seed, startOfDay, type SeedData } from './seed.ts'

const DAY = 86_400_000

export type OrderQuery = {
  page: number
  size: number
  sort: 'createdAt' | 'total' | 'number' | 'customerName' | 'status'
  dir: 'asc' | 'desc'
  status: OrderStatus[]
  q: string
  /** Дни 'YYYY-MM-DD' включительно. */
  from: string | null
  to: string | null
}

export type ProductQuery = { q: string; category: Category | null; status: ProductStatus | null }
export type CustomerQuery = { q: string; segment: Segment | null; cursor: number; limit: number }

/** Снимок изменяемой части базы — то, что браузерная версия кладёт в sessionStorage. */
export type Snapshot = Pick<SeedData, 'products' | 'orders' | 'notes' | 'lastOrderNumber'> & {
  notifications: Notification[]
  counter: number
}

export const toRow = ({ items, history: _history, ...rest }: Order): OrderRow => ({ ...rest, itemsCount: items.length })

const norm = (text: string) => text.toLowerCase().replaceAll('ё', 'е').trim()

export class Db {
  products: Product[]
  customers: Customer[]
  orders: Order[]
  notes: Note[]
  notifications: Notification[] = []
  lastOrderNumber: number
  /** Счётчик для id новых записей. */
  private counter = 0
  private customersById: Map<string, Customer>
  /** Вызывается после каждого изменения — браузерная версия сохраняет снимок. */
  onChange: (() => void) | null = null

  constructor(now: number, snapshot?: Snapshot | null) {
    const data = seed(now)
    // Клиенты не меняются и всегда пересоздаются из зерна: 10 000 записей в снимке не нужны.
    this.customers = data.customers
    this.customersById = new Map(data.customers.map((c) => [c.id, c]))
    this.products = snapshot?.products ?? data.products
    this.orders = snapshot?.orders ?? data.orders
    this.notes = snapshot?.notes ?? data.notes
    this.notifications = snapshot?.notifications ?? []
    this.lastOrderNumber = snapshot?.lastOrderNumber ?? data.lastOrderNumber
    this.counter = snapshot?.counter ?? 0
  }

  snapshot(): Snapshot {
    return {
      products: this.products,
      orders: this.orders,
      notes: this.notes,
      notifications: this.notifications,
      lastOrderNumber: this.lastOrderNumber,
      counter: this.counter,
    }
  }

  nextId(prefix: string) {
    return `${prefix}_x${++this.counter}`
  }

  private changed() {
    this.onChange?.()
  }

  // ─── Заказы ──────────────────────────────────────────────────────────────────

  findOrders(query: OrderQuery): Page<OrderRow> {
    const q = norm(query.q)
    const statuses = new Set(query.status)
    const from = query.from ? `${query.from}T00:00` : null
    const to = query.to ? `${query.to}T23:59:59.999` : null
    const fromTime = from ? new Date(from).getTime() : -Infinity
    const toTime = to ? new Date(to).getTime() : Infinity

    const found = this.orders.filter((order) => {
      if (statuses.size && !statuses.has(order.status)) return false
      const created = Date.parse(order.createdAt)
      if (created < fromTime || created > toTime) return false
      if (q && !norm(order.number).includes(q) && !norm(order.customerName).includes(q) && !norm(order.city).includes(q)) return false
      return true
    })

    const sign = query.dir === 'asc' ? 1 : -1
    const key = query.sort
    found.sort((a, b) => {
      const x = a[key]
      const y = b[key]
      const result = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ru')
      // При равенстве — по дате: порядок строк должен быть стабильным между страницами.
      return (result || a.createdAt.localeCompare(b.createdAt)) * sign
    })

    const start = query.page * query.size
    return { rows: found.slice(start, start + query.size).map(toRow), rowCount: found.length }
  }

  order(id: string) {
    return this.orders.find((o) => o.id === id) ?? null
  }

  notesOf(orderId: string) {
    return this.notes.filter((n) => n.orderId === orderId)
  }

  customer(id: string) {
    return this.customersById.get(id) ?? null
  }

  setOrderStatus(order: Order, status: OrderStatus, by: string, now: number) {
    const at = new Date(now).toISOString()
    order.status = status
    order.updatedAt = at
    order.version += 1
    order.history.push({ at, status, by })
    this.changed()
    return order
  }

  addOrder(order: Order) {
    this.orders.push(order)
    this.changed()
  }

  addNote(note: Note) {
    this.notes.push(note)
    this.changed()
  }

  addNotification(notification: Notification) {
    this.notifications.unshift(notification)
    this.notifications.length = Math.min(this.notifications.length, 50)
    this.changed()
  }

  // ─── Товары ──────────────────────────────────────────────────────────────────

  findProducts(query: ProductQuery) {
    const q = norm(query.q)
    return this.products.filter(
      (p) => (!query.category || p.category === query.category) && (!query.status || p.status === query.status) && (!q || norm(p.title).includes(q) || norm(p.sku).includes(q)),
    )
  }

  product(id: string) {
    return this.products.find((p) => p.id === id) ?? null
  }

  skuTaken(sku: string, exceptId?: string) {
    return this.products.some((p) => p.sku === sku && p.id !== exceptId)
  }

  createProduct(input: ProductInput, now: number): Product {
    const at = new Date(now).toISOString()
    const product: Product = { ...normalizeStock(input), id: this.nextId('p'), sold: 0, createdAt: at, updatedAt: at }
    this.products.unshift(product)
    this.changed()
    return product
  }

  updateProduct(product: Product, input: ProductInput, now: number) {
    Object.assign(product, normalizeStock(input), { updatedAt: new Date(now).toISOString() })
    this.changed()
    return product
  }

  deleteProduct(id: string) {
    this.products = this.products.filter((p) => p.id !== id)
    this.changed()
  }

  // ─── Клиенты ─────────────────────────────────────────────────────────────────

  findCustomers(query: CustomerQuery): CursorPage<Customer> {
    const q = norm(query.q)
    const found = this.customers.filter(
      (c) =>
        (!query.segment || c.segment === query.segment) &&
        (!q || norm(c.name).includes(q) || c.email.includes(q) || norm(c.city).includes(q) || c.phone.replace(/\D/g, '').includes(q.replace(/\D/g, '') || '~')),
    )
    const rows = found.slice(query.cursor, query.cursor + query.limit)
    const next = query.cursor + rows.length
    return { rows, nextCursor: next < found.length ? next : null, total: found.length }
  }

  ordersOfCustomer(customerId: string, limit = 5) {
    return this.orders
      .filter((o) => o.customerId === customerId)
      .slice(-limit)
      .reverse()
      .map(toRow)
  }

  // ─── Статистика ──────────────────────────────────────────────────────────────

  stats(period: StatsPeriod, now: number): Stats {
    const today = startOfDay(now)
    const start = today - (period - 1) * DAY
    const prevStart = start - period * DAY

    const days = new Map<string, { revenue: number; orders: number }>()
    for (let i = 0; i < period; i++) days.set(dayKey(start + i * DAY), { revenue: 0, orders: 0 })

    const current = { revenue: 0, orders: 0, customers: new Set<string>() }
    const previous = { revenue: 0, orders: 0, customers: new Set<string>() }
    const byStatus = new Map<OrderStatus, number>()
    const byCategory = new Map<Category, number>()
    const top = new Map<string, { id: string; title: string; qty: number; revenue: number }>()
    const categoryOf = new Map(this.products.map((p) => [p.id, p]))

    for (const order of this.orders) {
      const created = Date.parse(order.createdAt)
      if (created < prevStart) continue
      const bucket = created >= start ? current : previous
      if (created >= start) byStatus.set(order.status, (byStatus.get(order.status) ?? 0) + 1)
      // Отменённые заказы в выручку не идут.
      if (order.status === 'cancelled') continue
      bucket.revenue += order.total
      bucket.orders += 1
      bucket.customers.add(order.customerId)
      if (created < start) continue
      const day = days.get(dayKey(created))
      if (day) {
        day.revenue += order.total
        day.orders += 1
      }
      for (const item of order.items) {
        const product = categoryOf.get(item.productId)
        const sum = item.price * item.qty
        if (product) byCategory.set(product.category, (byCategory.get(product.category) ?? 0) + sum)
        const entry = top.get(item.productId) ?? { id: item.productId, title: product?.title ?? item.title, qty: 0, revenue: 0 }
        entry.qty += item.qty
        entry.revenue += sum
        top.set(item.productId, entry)
      }
    }

    const delta = (now_: number, before: number) => (before > 0 ? (now_ - before) / before : null)
    const avg = (b: { revenue: number; orders: number }) => (b.orders ? Math.round(b.revenue / b.orders) : 0)

    return {
      period,
      kpi: {
        revenue: current.revenue,
        orders: current.orders,
        avgCheck: avg(current),
        buyers: current.customers.size,
        revenueDelta: delta(current.revenue, previous.revenue),
        ordersDelta: delta(current.orders, previous.orders),
        avgCheckDelta: delta(avg(current), avg(previous)),
        buyersDelta: delta(current.customers.size, previous.customers.size),
      },
      series: [...days].map(([day, value]) => ({ day, ...value })),
      byStatus: [...byStatus].map(([status, count]) => ({ status, count })),
      byCategory: [...byCategory].map(([category, revenue]) => ({ category, revenue })).sort((a, b) => b.revenue - a.revenue),
      topProducts: [...top.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6),
    }
  }

  /** Сегодняшние итоги — основа «живых» метрик. */
  today(now: number) {
    const start = startOfDay(now)
    let orders = 0
    let revenue = 0
    for (let i = this.orders.length - 1; i >= 0; i--) {
      const order = this.orders[i]!
      if (Date.parse(order.createdAt) < start) break // заказы идут по времени — дальше только старше
      if (order.status === 'cancelled') continue
      orders += 1
      revenue += order.total
    }
    return { orders, revenue }
  }
}

/** Остаток товара с вариантами — сумма остатков вариантов. */
function normalizeStock(input: ProductInput): ProductInput {
  return input.variants.length ? { ...input, stock: input.variants.reduce((sum, v) => sum + v.stock, 0) } : input
}
