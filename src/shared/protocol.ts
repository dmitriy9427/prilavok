/**
 * Протокол WebSocket — «язык», на котором говорят клиент и сервер.
 *
 * Сам WebSocket даёт только трубу: «отправить строку» и «получить строку».
 * Всё остальное — кто ты, на что подписан, дошло ли сообщение, что было, пока
 * связь рвалась, — приложение придумывает само. Этот файл и есть такая
 * договорённость. Его импортируют обе стороны, поэтому рассогласоваться они
 * не могут: изменили тип здесь — TypeScript покажет все места и там, и там.
 *
 * ─── Кадр ───────────────────────────────────────────────────────────────────
 * Каждое сообщение — JSON-объект с полем `t` (type). По нему получатель
 * понимает, что внутри. Это «размеченное объединение» (discriminated union):
 * после `if (frame.t === 'event')` TypeScript знает остальные поля.
 *
 * ─── Клиент → сервер ────────────────────────────────────────────────────────
 *   hello   первый кадр: кто я (токен), на что подписан, что видел последним
 *   sub     подписаться на канал
 *   unsub   отписаться
 *   req     просьба что-то сделать; сервер ответит ack с тем же id
 *   ping    «ты жив?» — раз в N секунд
 *
 * ─── Сервер → клиент ────────────────────────────────────────────────────────
 *   welcome ответ на hello: сессия создана, вот текущий номер события
 *   event   что-то произошло в канале
 *   ack     ответ на sub / unsub / req
 *   pong    ответ на ping (и текущий номер события)
 *   error   кадр не понят (протокольная ошибка)
 *
 * ─── Зачем zod ──────────────────────────────────────────────────────────────
 * Всё, что пришло из сети, — unknown. TypeScript проверяет код, но не данные:
 * JSON.parse вернёт что угодно. Схема проверяет кадр В МОМЕНТ ПОЛУЧЕНИЯ, и
 * дальше по коду идёт уже гарантированно правильный объект.
 */
import { z } from 'zod'

import type { LiveMetrics, Note, Notification, OrderRow, OrderStatus, PresenceUser, User } from './types.ts'

/** Версия протокола: сервер может отказать клиенту со старой версией. */
export const PROTOCOL_VERSION = 1

// ─── Каналы ────────────────────────────────────────────────────────────────────

/**
 * Канал — тема, на которую подписываются. Клиент получает события только
 * своих каналов: экрану заказа №15 незачем знать о заметках к заказу №16.
 */
export const CHANNELS = {
  /** Создание и изменение заказов. */
  orders: 'orders',
  /** Живые цифры для дашборда. */
  metrics: 'metrics',
  /** Уведомления («колокольчик»). */
  notifications: 'notifications',
  /** Остатки товаров. */
  products: 'products',
  /** Один заказ: заметки и «кто сейчас смотрит». */
  order: (id: string) => `order:${id}`,
} as const

/** Разобрать имя канала заказа: 'order:o_15' → 'o_15'. */
export const orderIdFromChannel = (channel: string) => (channel.startsWith('order:') ? channel.slice(6) : null)

// ─── События ───────────────────────────────────────────────────────────────────

/**
 * Все события сервера: имя → данные.
 *
 * Два вида событий (это важно для докачки после обрыва):
 *   - ФАКТЫ («заказ создан») — у них есть номер seq, сервер хранит их в
 *     буфере и досылает пропущенные. Потерять такой нельзя.
 *   - СОСТОЯНИЕ («сейчас онлайн 42») — seq нет, не хранятся. Старое значение
 *     никому не нужно: придёт следующее. При подписке сервер сразу шлёт
 *     текущее.
 */
export type ServerEvents = {
  'order.created': { order: OrderRow }
  'order.updated': { id: string; status: OrderStatus; version: number; updatedAt: string; by: string }
  'note.added': { note: Note; /** id, под которым автор показал заметку до ответа сервера. */ clientId: string | null }
  notification: { notification: Notification }
  'product.stock': { id: string; stock: number }
  // состояние (без seq):
  'metrics.tick': LiveMetrics
  presence: { users: PresenceUser[] }
}
export type ServerEventType = keyof ServerEvents

/** Событие — состояние, а не факт: не нумеруется и не досылается. */
export const EPHEMERAL: ReadonlySet<ServerEventType> = new Set(['metrics.tick', 'presence'])

// ─── Запросы клиента (req → ack) ───────────────────────────────────────────────

/** Что клиент может попросить через сокет: метод → параметры и результат. */
export type Requests = {
  /** Добавить заметку к заказу. */
  'note.add': { params: { orderId: string; text: string; clientId: string }; result: { note: Note } }
  /** Сообщить, какой заказ открыт (null — никакой): для «кто сейчас смотрит». */
  'presence.focus': { params: { orderId: string | null }; result: { ok: true } }
}
export type RequestMethod = keyof Requests

// ─── Кадры: клиент → сервер ────────────────────────────────────────────────────

const id = z.string().min(1).max(64)
const channel = z.string().min(1).max(80)

export const clientFrame = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    v: z.number().int(),
    token: z.string(),
    /** Каналы, на которые клиент был подписан (при переподключении — все сразу). */
    channels: z.array(channel).max(50),
    /**
     * С какого места продолжать: номер последнего полученного события и «эпоха»
     * сервера, который его выдал. null — первое подключение.
     */
    resume: z.object({ epoch: z.string(), seq: z.number().int() }).nullable(),
  }),
  z.object({ t: z.literal('sub'), id, channel }),
  z.object({ t: z.literal('unsub'), id, channel }),
  z.object({ t: z.literal('req'), id, method: z.string().max(40), params: z.unknown() }),
  z.object({ t: z.literal('ping'), ts: z.number() }),
])
export type ClientFrame = z.infer<typeof clientFrame>

/** Параметры запросов — проверяет сервер (клиенту доверять нельзя). */
export const requestParams = {
  'note.add': z.object({
    orderId: z.string().min(1),
    text: z.string().trim().min(1, 'Пустая заметка').max(500, 'Не длиннее 500 символов'),
    clientId: z.string().min(1).max(64),
  }),
  'presence.focus': z.object({ orderId: z.string().min(1).nullable() }),
} satisfies { [M in RequestMethod]: z.ZodType<Requests[M]['params']> }

// ─── Кадры: сервер → клиент ────────────────────────────────────────────────────

export type WelcomeFrame = {
  t: 'welcome'
  sessionId: string
  user: User
  /**
   * Эпоха — id запуска сервера. Нумерация событий начинается заново при каждом
   * перезапуске: номер 120 «до» и 120 «после» — разные события. Эпоха их различает.
   */
  epoch: string
  /** Номер последнего события на сервере — с него клиент ведёт отсчёт. */
  seq: number
  /**
   * true — пропущенные события сейчас придут (или их не было).
   * false — сервер их уже не хранит: клиенту нужно перезапросить данные по HTTP.
   */
  resumed: boolean
  serverTime: number
}

export type EventFrame<T extends ServerEventType = ServerEventType> = {
  [K in T]: {
    t: 'event'
    /** Сквозной номер факта; null — событие-состояние. */
    seq: number | null
    channel: string
    type: K
    data: ServerEvents[K]
    at: number
  }
}[T]

export type AckFrame = { t: 'ack'; id: string; ok: true; result: unknown } | { t: 'ack'; id: string; ok: false; error: { code: string; message: string } }

export type ServerFrame =
  | WelcomeFrame
  | EventFrame
  | AckFrame
  /** seq — текущий номер события на сервере: клиент сдвигает по нему свою «закладку». */
  | { t: 'pong'; ts: number; seq: number }
  | { t: 'error'; code: string; message: string }

/**
 * Проверка кадра сервера на клиенте. Данные события (data) не проверяются
 * поштучно — у нас общий с сервером тип и один репозиторий. С чужим сервером
 * стоило бы описать схему каждого события.
 */
// Обычный union, а не discriminatedUnion: у ack два варианта с одним и тем же `t`.
export const serverFrame = z.union([
  z.object({
    t: z.literal('welcome'),
    sessionId: z.string(),
    user: z.object({ id: z.string(), name: z.string(), email: z.string(), role: z.string(), hue: z.number() }),
    epoch: z.string(),
    seq: z.number(),
    resumed: z.boolean(),
    serverTime: z.number(),
  }),
  z.object({
    t: z.literal('event'),
    seq: z.number().nullable(),
    channel: z.string(),
    type: z.string(),
    data: z.unknown(),
    at: z.number(),
  }),
  z.object({ t: z.literal('ack'), id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({
    t: z.literal('ack'),
    id: z.string(),
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
  z.object({ t: z.literal('pong'), ts: z.number(), seq: z.number() }),
  z.object({ t: z.literal('error'), code: z.string(), message: z.string() }),
])

// ─── Коды закрытия ─────────────────────────────────────────────────────────────

/**
 * Код закрытия соединения — число, которое сторона передаёт при close().
 * 1000–2999 заняты стандартом, 4000–4999 отданы приложениям. По коду клиент
 * решает, переподключаться ли.
 */
export const CLOSE = {
  /** Обычное закрытие (стандарт). */
  normal: 1000,
  /** Сервер перезапускается — переподключиться. */
  restart: 4000,
  /** Токен не подошёл — переподключаться бессмысленно, нужен вход. */
  unauthorized: 4401,
  /** Клиент не прислал hello вовремя. */
  helloTimeout: 4408,
  /** Клиент давно молчит (нет ping) — сервер освобождает ресурсы. */
  idle: 4409,
  /** Версия протокола не поддерживается — нужно обновить страницу. */
  unsupported: 4426,
} as const

/** После этих кодов клиент НЕ переподключается сам. */
export const FATAL_CLOSE_CODES: ReadonlySet<number> = new Set([CLOSE.unauthorized, CLOSE.unsupported])

/** Сколько клиент может молчать, прежде чем сервер закроет соединение, мс. */
export const SERVER_IDLE_TIMEOUT = 45_000
/** Как часто клиент шлёт ping, мс. Заметно меньше SERVER_IDLE_TIMEOUT. */
export const PING_INTERVAL = 15_000
/** Сколько клиент ждёт pong, мс. */
export const PONG_TIMEOUT = 5_000

// ─── Помощники ─────────────────────────────────────────────────────────────────

export const encode = (frame: ClientFrame | ServerFrame) => JSON.stringify(frame)

/** Разобрать сырые данные по схеме; null — мусор (не JSON или не тот вид). */
export function decode<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> | null {
  if (typeof raw !== 'string') return null
  try {
    const result = schema.safeParse(JSON.parse(raw))
    return result.success ? result.data : null
  } catch {
    return null
  }
}
