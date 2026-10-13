/**
 * Состояние списка заказов живёт в адресе страницы:
 *   /orders?status=["new","paid"]&q=иванов&page=2&sort=total
 *
 * Что это даёт:
 *   - ссылку можно отправить коллеге — он увидит тот же список;
 *   - F5 ничего не сбрасывает;
 *   - «назад» в браузере возвращает прошлые фильтры;
 *   - не нужен отдельный стейт-менеджер: адрес и есть хранилище.
 *
 * Схема проверяет адрес при каждом переходе. Неверное значение (?page=abc)
 * не роняет экран, а заменяется значением по умолчанию (.catch).
 */
import { z } from 'zod'

import { ORDER_STATUSES } from '@/shared/types'

export const ORDER_SORTS = ['createdAt', 'total', 'number', 'customerName', 'status'] as const
export const PAGE_SIZES = [20, 50, 100] as const

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .or(z.literal(''))

export const ordersSearch = z.object({
  page: z.number().int().min(0).default(0).catch(0),
  size: z
    .union([z.literal(20), z.literal(50), z.literal(100)])
    .default(20)
    .catch(20),
  sort: z.enum(ORDER_SORTS).default('createdAt').catch('createdAt'),
  dir: z.enum(['asc', 'desc']).default('desc').catch('desc'),
  status: z.array(z.enum(ORDER_STATUSES)).default([]).catch([]),
  q: z.string().max(80).default('').catch(''),
  from: day.default('').catch(''),
  to: day.default('').catch(''),
})

export type OrdersSearch = z.infer<typeof ordersSearch>

export const ORDERS_DEFAULTS: OrdersSearch = { page: 0, size: 20, sort: 'createdAt', dir: 'desc', status: [], q: '', from: '', to: '' }

/** Сколько фильтров включено — для кнопки «Сбросить». */
export const activeFilters = (search: OrdersSearch) => search.status.length + (search.q ? 1 : 0) + (search.from ? 1 : 0) + (search.to ? 1 : 0)
