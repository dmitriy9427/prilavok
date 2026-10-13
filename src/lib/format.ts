/**
 * Форматирование для людей: деньги, даты, склонения, подписи.
 *
 * Intl — встроенный в браузер API: знает правила языка (пробел-разделитель
 * тысяч, «₽» после числа, названия месяцев). Форматтеры создаются один раз —
 * создание дорогое, а вызов дешёвый.
 */
import type { Category, Delivery, NotificationKind, OrderStatus, Payment, ProductStatus, Segment } from '@/shared/types'

const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 })
const number = new Intl.NumberFormat('ru-RU')
const percent = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' })
const dateTime = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const dateOnly = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
const timeOnly = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
const timeWithSeconds = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const relative = new Intl.RelativeTimeFormat('ru-RU', { numeric: 'auto' })

export const formatMoney = (value: number) => money.format(value)
/** 1 250 000 → «1,3 млн» — для осей графиков и тесных мест. */
export const formatCompact = (value: number) => compact.format(value)
export const formatNumber = (value: number) => number.format(value)
/** 0.123 → «+12,3 %». */
export const formatPercent = (value: number) => percent.format(value)
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso))
export const formatDate = (iso: string) => dateOnly.format(new Date(iso))
/** '2026-10-13' → «13 окт.» */
export const formatDay = (day: string) => dayMonth.format(new Date(`${day}T12:00`))
export const formatTime = (iso: string | number) => timeOnly.format(new Date(iso))
export const formatClock = (time: number) => `${timeWithSeconds.format(time)}.${String(time % 1000).padStart(3, '0')}`

/** «5 минут назад», «вчера». */
export function formatRelative(iso: string, now = Date.now()) {
  const seconds = Math.round((Date.parse(iso) - now) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 45) return 'только что'
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour')
  if (abs < 86_400 * 7) return relative.format(Math.round(seconds / 86_400), 'day')
  return dayMonth.format(new Date(iso))
}

/**
 * Склонение после числа: plural(3, ['заказ', 'заказа', 'заказов']) → «заказа».
 * В русском три формы: 1 заказ, 2–4 заказа, 5–20 заказов; 21 — снова «заказ».
 */
export function plural(n: number, forms: [one: string, few: string, many: string]) {
  const abs = Math.abs(n) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return forms[2]
  if (last === 1) return forms[0]
  if (last >= 2 && last <= 4) return forms[1]
  return forms[2]
}

export const count = (n: number, forms: [string, string, string]) => `${formatNumber(n)} ${plural(n, forms)}`

/** Инициалы для аватара: «Алина Морозова» → «АМ». */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

/** Ключ дня по местному календарю для <input type="date">. */
export const toDayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

// ─── Подписи ───────────────────────────────────────────────────────────────────
// Record<Тип, string> — TypeScript не даст забыть подпись, когда появится новый статус.

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'Новый',
  paid: 'Оплачен',
  packing: 'Сборка',
  shipped: 'В пути',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
}

/** Что написать на кнопке перехода в статус. */
export const ORDER_STATUS_ACTIONS: Record<OrderStatus, string> = {
  new: 'Вернуть в новые',
  paid: 'Отметить оплаченным',
  packing: 'Передать в сборку',
  shipped: 'Отправить',
  delivered: 'Отметить доставленным',
  cancelled: 'Отменить заказ',
}

export const DELIVERY_LABELS: Record<Delivery, string> = { courier: 'Курьер', pickup: 'Самовывоз', post: 'Почта' }
export const PAYMENT_LABELS: Record<Payment, string> = { card: 'Карта', sbp: 'СБП', cash: 'При получении' }
export const CATEGORY_LABELS: Record<Category, string> = { coffee: 'Кофе', tea: 'Чай', gear: 'Посуда и аксессуары', sweets: 'Сладости' }
export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = { active: 'В продаже', draft: 'Черновик', archived: 'В архиве' }
export const SEGMENT_LABELS: Record<Segment, string> = { new: 'Новый', regular: 'Постоянный', vip: 'VIP' }
export const NOTIFICATION_LABELS: Record<NotificationKind, string> = { order: 'Заказ', stock: 'Склад', cancel: 'Отмена', info: 'Инфо' }

/** Содержимое CSV-файла из строк таблицы. */
export function toCsv(header: string[], rows: (string | number)[][]) {
  // Значение в кавычках, кавычки внутри удваиваются — так запятые и переносы не ломают столбцы.
  const cell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`
  // \uFEFF (BOM) в начале — иначе Excel откроет кириллицу «кракозябрами».
  return `\uFEFF${[header, ...rows].map((row) => row.map(cell).join(';')).join('\r\n')}`
}

export function downloadFile(name: string, content: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  link.click()
  URL.revokeObjectURL(url)
}
