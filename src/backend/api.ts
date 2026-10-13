/**
 * REST API магазина.
 *
 * Как и хаб, обработчики не знают про транспорт: на вход — простой объект
 * запроса, на выход — статус и тело. Адаптеры (MSW в браузере, http в Node)
 * только переводят свои запросы в этот вид. Благодаря этому всю логику API
 * можно проверить обычными тестами без сети.
 *
 * ─── Соглашения ─────────────────────────────────────────────────────────────
 *   200 — данные; 201 — создано; 204 — сделано, тела нет;
 *   400 — запрос составлен неверно;
 *   401 — не вошёл; 403 — вошёл, но нельзя; 404 — нет такого;
 *   409 — конфликт: запись успели изменить (версия устарела) или SKU занят;
 *   422 — данные не прошли проверку (ошибки по полям в error.fields).
 * Ошибка всегда одного вида: { error: { code, message, fields? } }.
 */
import type { z } from 'zod'

import { CHANNELS } from '../shared/protocol.ts'
import { can, type Permission } from '../shared/permissions.ts'
import { STATUS_FLOW, bulkStatus, loginInput, orderStatusPatch, productInput } from '../shared/schemas.ts'
import {
  CATEGORIES,
  ORDER_STATUSES,
  PRODUCT_STATUSES,
  SEGMENTS,
  type ApiErrorBody,
  type Order,
  type OrderDetail,
  type OrderStatus,
  type Session,
  type StatsPeriod,
  type User,
} from '../shared/types.ts'
import type { Db, OrderQuery } from './db.ts'
import type { Hub } from './hub.ts'
import { DEMO_USERS } from './seed.ts'

export type ApiRequest = {
  method: string
  /** Путь без префикса /api: '/orders/o_15'. */
  path: string
  query: URLSearchParams
  body: unknown
  /** Значение заголовка Authorization. */
  authorization: string | null
}

export type ApiResponse = { status: number; body: unknown }

/** Ошибка, которая превращается в ответ с нужным статусом. */
export class HttpError extends Error {
  status: number
  code: string
  fields?: Record<string, string>
  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
  }
}

// ─── Токены ────────────────────────────────────────────────────────────────────

/**
 * Демо-токен: 'demo.<id пользователя>'. Настоящий токен — случайная строка
 * (сессия в базе) или подписанный JWT: его нельзя подделать и у него есть срок.
 */
export const tokenFor = (user: User) => `demo.${user.id}`
export const userByToken = (token: string | null | undefined) => (token?.startsWith('demo.') ? (DEMO_USERS.find((u) => u.id === token.slice(5)) ?? null) : null)

// ─── Помощники ─────────────────────────────────────────────────────────────────

/** Проверить тело запроса по схеме; ошибки — по полям, чтобы форма показала их на местах. */
function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body)
  if (result.success) return result.data
  const fields: Record<string, string> = {}
  for (const issue of result.error.issues) fields[issue.path.join('.') || '_'] ??= issue.message
  throw new HttpError(422, 'validation', 'Проверьте поля формы', fields)
}

const oneOf = <T extends string>(allowed: readonly T[], value: string | null): T | null => (value && (allowed as readonly string[]).includes(value) ? (value as T) : null)

const int = (value: string | null, fallback: number, min: number, max: number) => {
  const n = Number(value)
  return Number.isInteger(n) && value !== null && value !== '' ? Math.min(max, Math.max(min, n)) : fallback
}

const day = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null)

const SORTS = ['createdAt', 'total', 'number', 'customerName', 'status'] as const

/** Параметры списка заказов из строки запроса. Всё лишнее и неверное заменяется значением по умолчанию. */
export function orderQuery(query: URLSearchParams): OrderQuery {
  return {
    page: int(query.get('page'), 0, 0, 100_000),
    size: int(query.get('size'), 20, 5, 100),
    sort: oneOf(SORTS, query.get('sort')) ?? 'createdAt',
    dir: query.get('dir') === 'asc' ? 'asc' : 'desc',
    status: (query.get('status') ?? '')
      .split(',')
      .map((s) => oneOf(ORDER_STATUSES, s))
      .filter((s): s is OrderStatus => s !== null),
    q: (query.get('q') ?? '').slice(0, 80),
    from: day(query.get('from')),
    to: day(query.get('to')),
  }
}

// ─── API ───────────────────────────────────────────────────────────────────────

type Context = { req: ApiRequest; params: Record<string, string>; user: User }
type Handler = (ctx: Context) => unknown | { status: number; body: unknown }
type Route = { method: string; pattern: string[]; handler: Handler; public?: boolean; permission?: Permission }

export function createApi(db: Db, hub: Hub, now: () => number) {
  const routes: Route[] = []
  const route = (method: string, path: string, handler: Handler, options: Pick<Route, 'public' | 'permission'> = {}) =>
    routes.push({ method, pattern: path.split('/').filter(Boolean), handler, ...options })

  const orderOr404 = (id: string) => {
    const order = db.order(id)
    if (!order) throw new HttpError(404, 'not_found', 'Заказ не найден')
    return order
  }
  const productOr404 = (id: string) => {
    const product = db.product(id)
    if (!product) throw new HttpError(404, 'not_found', 'Товар не найден')
    return product
  }

  /** Сменить статус и рассказать об этом всем, кто слушает канал заказов. */
  const changeStatus = (order: Order, status: OrderStatus, by: string) => {
    db.setOrderStatus(order, status, by, now())
    hub.publish(CHANNELS.orders, 'order.updated', { id: order.id, status, version: order.version, updatedAt: order.updatedAt, by })
    if (status === 'cancelled') {
      const notification = {
        id: db.nextId('ntf'),
        kind: 'cancel' as const,
        title: `Заказ ${order.number} отменён`,
        body: `${order.customerName} · ${by}`,
        at: order.updatedAt,
        link: `/orders/${order.id}`,
      }
      db.addNotification(notification)
      hub.publish(CHANNELS.notifications, 'notification', { notification })
    }
  }

  // Вход: в демо — выбор готового пользователя, без пароля.
  route(
    'POST',
    '/auth/login',
    ({ req }) => {
      const { userId } = parse(loginInput, req.body)
      const user = DEMO_USERS.find((u) => u.id === userId)
      if (!user) throw new HttpError(401, 'bad_credentials', 'Пользователь не найден')
      return { token: tokenFor(user), user } satisfies Session
    },
    { public: true },
  )
  route('GET', '/auth/me', ({ user }) => user)

  route('GET', '/stats', ({ req }) => {
    const period = int(req.query.get('period'), 30, 7, 90)
    return db.stats(([7, 30, 90].includes(period) ? period : 30) as StatsPeriod, now())
  })

  route('GET', '/orders', ({ req }) => db.findOrders(orderQuery(req.query)))

  route('GET', '/orders/:id', ({ params }): OrderDetail => {
    const order = orderOr404(params.id!)
    return { order, notes: db.notesOf(order.id), customer: db.customer(order.customerId) }
  })

  route(
    'PATCH',
    '/orders/:id',
    ({ params, req, user }) => {
      const order = orderOr404(params.id!)
      const patch = parse(orderStatusPatch, req.body)
      // Оптимистичная блокировка: правка сделана поверх устаревшей версии — отказ.
      // Клиент покажет актуальные данные, и человек решит заново.
      if (patch.version !== order.version) throw new HttpError(409, 'version_conflict', 'Заказ уже изменил кто-то другой. Данные обновлены.')
      if (!STATUS_FLOW[order.status].includes(patch.status)) throw new HttpError(409, 'bad_transition', 'Такой переход статуса невозможен')
      changeStatus(order, patch.status, user.name)
      return order
    },
    { permission: 'orders.update' },
  )

  route(
    'POST',
    '/orders/bulk-status',
    ({ req, user }) => {
      const { ids, status } = parse(bulkStatus, req.body)
      // Частичный успех: меняем те, у которых переход возможен, и честно сообщаем об остальных.
      const updated: string[] = []
      const skipped: string[] = []
      for (const id of ids) {
        const order = db.order(id)
        if (order && STATUS_FLOW[order.status].includes(status)) {
          changeStatus(order, status, user.name)
          updated.push(id)
        } else skipped.push(id)
      }
      return { updated, skipped }
    },
    { permission: 'orders.update' },
  )

  route('GET', '/products', ({ req }) =>
    db.findProducts({
      q: (req.query.get('q') ?? '').slice(0, 80),
      category: oneOf(CATEGORIES, req.query.get('category')),
      status: oneOf(PRODUCT_STATUSES, req.query.get('status')),
    }),
  )

  route('GET', '/products/:id', ({ params }) => productOr404(params.id!))

  route(
    'POST',
    '/products',
    ({ req }) => {
      const input = parse(productInput, req.body)
      if (db.skuTaken(input.sku)) throw new HttpError(409, 'sku_taken', 'Проверьте поля формы', { sku: 'Такой артикул уже есть' })
      return { status: 201, body: db.createProduct(input, now()) }
    },
    { permission: 'products.create' },
  )

  route(
    'PUT',
    '/products/:id',
    ({ params, req }) => {
      const product = productOr404(params.id!)
      const input = parse(productInput, req.body)
      if (db.skuTaken(input.sku, product.id)) throw new HttpError(409, 'sku_taken', 'Проверьте поля формы', { sku: 'Такой артикул уже есть' })
      db.updateProduct(product, input, now())
      hub.publish(CHANNELS.products, 'product.stock', { id: product.id, stock: product.stock })
      return product
    },
    { permission: 'products.update' },
  )

  route(
    'DELETE',
    '/products/:id',
    ({ params }) => {
      db.deleteProduct(productOr404(params.id!).id)
      return { status: 204, body: null }
    },
    { permission: 'products.delete' },
  )

  route('GET', '/customers', ({ req }) =>
    db.findCustomers({
      q: (req.query.get('q') ?? '').slice(0, 80),
      segment: oneOf(SEGMENTS, req.query.get('segment')),
      cursor: int(req.query.get('cursor'), 0, 0, 1_000_000),
      limit: int(req.query.get('limit'), 100, 10, 500),
    }),
  )

  route('GET', '/customers/:id', ({ params }) => {
    const customer = db.customer(params.id!)
    if (!customer) throw new HttpError(404, 'not_found', 'Клиент не найден')
    return { customer, orders: db.ordersOfCustomer(customer.id) }
  })

  route('GET', '/notifications', () => db.notifications)

  // ─── Диспетчер ───────────────────────────────────────────────────────────────

  function match(route: Route, method: string, segments: string[]) {
    if (route.method !== method || route.pattern.length !== segments.length) return null
    const params: Record<string, string> = {}
    for (let i = 0; i < segments.length; i++) {
      const part = route.pattern[i]!
      if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(segments[i]!)
      else if (part !== segments[i]) return null
    }
    return params
  }

  const fail = (status: number, code: string, message: string, fields?: Record<string, string>): ApiResponse => ({
    status,
    body: { error: { code, message, ...(fields && { fields }) } } satisfies ApiErrorBody,
  })

  return function handle(req: ApiRequest): ApiResponse {
    const segments = req.path.split('/').filter(Boolean)
    try {
      for (const candidate of routes) {
        const params = match(candidate, req.method, segments)
        if (!params) continue

        // Порядок проверок: сначала «кто ты» (401), потом «можно ли тебе» (403).
        const user = userByToken(req.authorization?.replace(/^Bearer /, ''))
        if (!candidate.public && !user) return fail(401, 'unauthorized', 'Нужно войти')
        if (candidate.permission && !(user && can(user.role, candidate.permission))) {
          return fail(403, 'forbidden', 'Недостаточно прав для этого действия')
        }

        const result = candidate.handler({ req, params, user: user! })
        if (result && typeof result === 'object' && 'status' in result && 'body' in result) return result as ApiResponse
        return { status: 200, body: result }
      }
      return fail(404, 'not_found', 'Нет такого адреса')
    } catch (error) {
      if (error instanceof HttpError) return fail(error.status, error.code, error.message, error.fields)
      console.error('[api] необработанная ошибка', error)
      return fail(500, 'internal', 'Внутренняя ошибка сервера')
    }
  }
}
