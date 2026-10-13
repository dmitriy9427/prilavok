/**
 * Доменные типы — «договор» между клиентом и сервером.
 *
 * Папка shared — единственное, что импортируют ОБЕ стороны: интерфейс (src/…)
 * и бэкенд (src/backend, server/). В настоящем проекте это был бы общий пакет
 * или типы, сгенерированные из OpenAPI.
 *
 * Деньги — целые рубли (number). Для настоящего магазина хранят копейки целым
 * числом: дробные числа в JS неточны (0.1 + 0.2 !== 0.3).
 * Даты — строки ISO 8601 в UTC ('2026-10-13T08:30:00.000Z'): JSON не умеет Date.
 */

export const ROLES = ['admin', 'manager', 'viewer'] as const
export type Role = (typeof ROLES)[number]

export type User = {
  id: string
  name: string
  email: string
  role: Role
  /** Цвет аватара (оттенок 0–360) — картинок в демо нет. */
  hue: number
}

export const ORDER_STATUSES = ['new', 'paid', 'packing', 'shipped', 'delivered', 'cancelled'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const DELIVERIES = ['courier', 'pickup', 'post'] as const
export type Delivery = (typeof DELIVERIES)[number]

export const PAYMENTS = ['card', 'sbp', 'cash'] as const
export type Payment = (typeof PAYMENTS)[number]

export type OrderItem = {
  productId: string
  title: string
  price: number
  qty: number
}

export type OrderHistoryEntry = {
  at: string
  status: OrderStatus
  /** Кто изменил: имя сотрудника или «Система». */
  by: string
}

export type Order = {
  id: string
  /** Номер для людей: «П-10482». */
  number: string
  createdAt: string
  updatedAt: string
  /**
   * Версия записи: +1 при каждом изменении. Нужна для двух вещей:
   *   - сервер отклоняет правку устаревшей версии (409) — «оптимистичная блокировка»;
   *   - клиент отбрасывает событие из сокета, если у него уже более новая версия.
   */
  version: number
  status: OrderStatus
  customerId: string
  customerName: string
  city: string
  delivery: Delivery
  payment: Payment
  items: OrderItem[]
  total: number
  history: OrderHistoryEntry[]
}

/** Строка списка заказов: без состава и истории — список не тянет лишнее. */
export type OrderRow = Omit<Order, 'items' | 'history'> & { itemsCount: number }

export type Note = {
  id: string
  orderId: string
  authorId: string
  authorName: string
  hue: number
  text: string
  at: string
}

export const CATEGORIES = ['coffee', 'tea', 'gear', 'sweets'] as const
export type Category = (typeof CATEGORIES)[number]

export const PRODUCT_STATUSES = ['active', 'draft', 'archived'] as const
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

export type ProductVariant = {
  name: string
  /** Надбавка к цене товара, ₽. */
  priceDelta: number
  stock: number
}

export type Product = {
  id: string
  title: string
  sku: string
  category: Category
  price: number
  /** Старая цена для зачёркнутого ценника; null — скидки нет. */
  oldPrice: number | null
  /** Остаток: сумма по вариантам, если они есть. */
  stock: number
  status: ProductStatus
  description: string
  variants: ProductVariant[]
  /** Продано за всё время, шт. */
  sold: number
  createdAt: string
  updatedAt: string
}

/** Данные формы товара: всё, что вводит человек (остальное проставляет сервер). */
export type ProductInput = Pick<Product, 'title' | 'sku' | 'category' | 'price' | 'oldPrice' | 'stock' | 'status' | 'description' | 'variants'>

export const SEGMENTS = ['new', 'regular', 'vip'] as const
export type Segment = (typeof SEGMENTS)[number]

export type Customer = {
  id: string
  name: string
  email: string
  phone: string
  city: string
  segment: Segment
  ordersCount: number
  totalSpent: number
  registeredAt: string
}

export type NotificationKind = 'order' | 'stock' | 'cancel' | 'info'

export type Notification = {
  id: string
  kind: NotificationKind
  title: string
  body: string
  at: string
  /** Куда вести по клику (путь внутри приложения). */
  link: string | null
}

// ─── Ответы API ────────────────────────────────────────────────────────────────

/** Страница списка с серверной пагинацией. */
export type Page<T> = {
  rows: T[]
  /** Всего строк под текущими фильтрами (не на странице). */
  rowCount: number
}

/** Порция «бесконечного» списка: курсор вместо номера страницы. */
export type CursorPage<T> = {
  rows: T[]
  nextCursor: number | null
  total: number
}

export type OrderDetail = { order: Order; notes: Note[]; customer: Customer | null }

export type StatsPeriod = 7 | 30 | 90

export type Stats = {
  period: StatsPeriod
  kpi: {
    revenue: number
    orders: number
    avgCheck: number
    buyers: number
    /** Изменение к предыдущему такому же периоду, доля (0.12 = +12 %); null — не с чем сравнить. */
    revenueDelta: number | null
    ordersDelta: number | null
    avgCheckDelta: number | null
    buyersDelta: number | null
  }
  /** По дням, от старых к новым. */
  series: { day: string; revenue: number; orders: number }[]
  byStatus: { status: OrderStatus; count: number }[]
  byCategory: { category: Category; revenue: number }[]
  topProducts: { id: string; title: string; qty: number; revenue: number }[]
}

export type LiveMetrics = {
  /** Посетителей на сайте магазина прямо сейчас. */
  online: number
  ordersToday: number
  revenueToday: number
  /** Корзин с товарами, но без оформленного заказа. */
  carts: number
}

/** Кто сейчас смотрит заказ. */
export type PresenceUser = Pick<User, 'id' | 'name' | 'hue'>

/** Единый вид ошибки API. */
export type ApiErrorBody = {
  error: { code: string; message: string; fields?: Record<string, string> }
}

export type Session = { token: string; user: User }
