/**
 * Запросы к API в виде «описаний» для TanStack Query.
 *
 * queryOptions({ queryKey, queryFn }) — объект, который понимают и хук
 * useQuery, и загрузчик маршрута (queryClient.ensureQueryData), и код,
 * правящий кэш (queryClient.setQueryData). Ключ и тип данных описаны один раз.
 *
 * ─── Ключи ──────────────────────────────────────────────────────────────────
 * Ключ — адрес данных в кэше. Он иерархический:
 *   ['orders', 'list', { page: 0, status: ['new'] }]
 *   ['orders', 'detail', 'o_15']
 * Поэтому можно сказать «всё про заказы устарело» (['orders']) или «устарели
 * только списки» (['orders', 'list']). ВСЁ, от чего зависит ответ сервера,
 * должно быть в ключе — иначе разные запросы получат один и тот же кэш.
 */
import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query'

import type { Category, Customer, CursorPage, Notification, OrderDetail, OrderRow, OrderStatus, Page, Product, ProductStatus, Segment, Stats, StatsPeriod } from '@/shared/types'

import { api } from './http'

export const keys = {
  stats: ['stats'] as const,
  orders: ['orders'] as const,
  orderLists: ['orders', 'list'] as const,
  order: (id: string) => ['orders', 'detail', id] as const,
  products: ['products'] as const,
  productLists: ['products', 'list'] as const,
  product: (id: string) => ['products', 'detail', id] as const,
  customers: ['customers'] as const,
  notifications: ['notifications'] as const,
}

export type OrderListParams = {
  page: number
  size: number
  sort: 'createdAt' | 'total' | 'number' | 'customerName' | 'status'
  dir: 'asc' | 'desc'
  status: OrderStatus[]
  q: string
  from: string
  to: string
}

export const statsQuery = (period: StatsPeriod) =>
  queryOptions({
    queryKey: [...keys.stats, period],
    queryFn: ({ signal }) => api<Stats>('/stats', { query: { period }, signal }),
    placeholderData: keepPreviousData,
  })

export const ordersQuery = (params: OrderListParams) =>
  queryOptions({
    queryKey: [...keys.orderLists, params],
    queryFn: ({ signal }) => api<Page<OrderRow>>('/orders', { query: { ...params, status: params.status.join(',') }, signal }),
    // Пока грузится следующая страница, показываем предыдущую — таблица не «мигает» пустотой.
    placeholderData: keepPreviousData,
  })

export const orderQuery = (id: string) =>
  queryOptions({
    queryKey: keys.order(id),
    queryFn: ({ signal }) => api<OrderDetail>(`/orders/${id}`, { signal }),
  })

export type ProductListParams = { q: string; category: Category | ''; status: ProductStatus | '' }

export const productsQuery = (params: ProductListParams) =>
  queryOptions({
    queryKey: [...keys.productLists, params],
    queryFn: ({ signal }) => api<Product[]>('/products', { query: params, signal }),
    placeholderData: keepPreviousData,
  })

export const productQuery = (id: string) =>
  queryOptions({
    queryKey: keys.product(id),
    queryFn: ({ signal }) => api<Product>(`/products/${id}`, { signal }),
  })

export type CustomerListParams = { q: string; segment: Segment | '' }

/**
 * «Бесконечный» список: сервер отдаёт порции по 100 и курсор следующей.
 * Данные в кэше — массив страниц; getNextPageParam решает, есть ли следующая.
 */
export const customersQuery = (params: CustomerListParams) =>
  infiniteQueryOptions({
    queryKey: [...keys.customers, 'list', params],
    queryFn: ({ pageParam, signal }) => api<CursorPage<Customer>>('/customers', { query: { ...params, cursor: pageParam, limit: 100 }, signal }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  })

export const customerQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.customers, 'detail', id],
    queryFn: ({ signal }) => api<{ customer: Customer; orders: OrderRow[] }>(`/customers/${id}`, { signal }),
  })

export const notificationsQuery = queryOptions({
  queryKey: keys.notifications,
  queryFn: ({ signal }) => api<Notification[]>('/notifications', { signal }),
  // Список живёт за счёт событий сокета — сам по себе не устаревает.
  staleTime: Infinity,
})
