/**
 * Схемы данных, которые вводит человек. Одна схема — три применения:
 *   1. форма в браузере показывает ошибки под полями (react-hook-form + zod);
 *   2. сервер проверяет тело запроса (клиенту доверять нельзя — запрос можно
 *      отправить и без формы);
 *   3. из схемы выводится TypeScript-тип — он не может разойтись с проверкой.
 */
import { z } from 'zod'

import { CATEGORIES, ORDER_STATUSES, PRODUCT_STATUSES } from './types.ts'

const money = (label: string) =>
  z
    .number({ error: `${label}: введите число` })
    .int(`${label}: только целые рубли`)
    .min(0, `${label}: не меньше нуля`)
    .max(10_000_000, `${label}: слишком большое число`)

const stock = z.number({ error: 'Введите число' }).int('Только целое').min(0, 'Не меньше нуля').max(100_000, 'Слишком много')

export const productInput = z
  .object({
    title: z.string().trim().min(3, 'Не короче 3 символов').max(80, 'Не длиннее 80 символов'),
    sku: z
      .string()
      .trim()
      .regex(/^[A-Z0-9-]{3,16}$/, 'Заглавные латинские буквы, цифры и дефис, 3–16 символов'),
    category: z.enum(CATEGORIES),
    price: money('Цена').min(1, 'Цена: больше нуля'),
    oldPrice: money('Старая цена').nullable(),
    stock,
    status: z.enum(PRODUCT_STATUSES),
    description: z.string().trim().max(1000, 'Не длиннее 1000 символов'),
    variants: z
      .array(
        z.object({
          name: z.string().trim().min(1, 'Название варианта').max(30, 'Не длиннее 30 символов'),
          priceDelta: money('Надбавка'),
          stock,
        }),
      )
      .max(8, 'Не больше 8 вариантов'),
  })
  // Правила, зависящие от нескольких полей сразу: ошибка привязывается к полю через path.
  .refine((v) => v.oldPrice === null || v.oldPrice > v.price, {
    path: ['oldPrice'],
    message: 'Старая цена должна быть выше текущей',
  })
  .refine((v) => new Set(v.variants.map((x) => x.name.toLowerCase())).size === v.variants.length, {
    path: ['variants'],
    message: 'Названия вариантов не должны повторяться',
  })

export type ProductInputSchema = z.infer<typeof productInput>

export const orderStatusPatch = z.object({
  status: z.enum(ORDER_STATUSES),
  /** Версия заказа, которую видел пользователь, — для защиты от «затирания» чужой правки. */
  version: z.number().int(),
})

export const bulkStatus = z.object({
  ids: z.array(z.string()).min(1).max(200),
  status: z.enum(ORDER_STATUSES),
})

export const loginInput = z.object({ userId: z.string().min(1) })

/**
 * Какие переходы статуса разрешены. Заказ — конечный автомат: «доставлен»
 * нельзя вернуть в «новый». Проверяют и сервер, и интерфейс (чтобы не
 * предлагать невозможное).
 */
export const STATUS_FLOW: Record<(typeof ORDER_STATUSES)[number], readonly (typeof ORDER_STATUSES)[number][]> = {
  new: ['paid', 'cancelled'],
  paid: ['packing', 'cancelled'],
  packing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
}
