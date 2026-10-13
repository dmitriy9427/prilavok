/**
 * Транспорт: WebSocket, который сам переподключается.
 *
 * Встроенный WebSocket — одноразовый: соединение закрылось — объект больше ни
 * на что не годен, нужен новый. А закрывается оно постоянно: ноутбук уснул,
 * телефон переключился с Wi-Fi на LTE, сервер обновили, прокси оборвал
 * «слишком долгое» соединение. Этот класс прячет всю возню: снаружи есть
 * «труба», которая то работает, то нет, и события об этом.
 *
 * Класс ничего не знает о нашем протоколе (hello, каналы, ack) — только о
 * соединении. Протокол — этажом выше, в client.ts. Так каждый слой можно
 * понять и проверить отдельно.
 *
 * ─── Состояния ──────────────────────────────────────────────────────────────
 *
 *   idle ──start()──▶ connecting ──открылось──▶ open
 *                        ▲    │                   │
 *                        │    └──не вышло──┐      │ закрылось
 *                        │                 ▼      ▼
 *                        └──── таймер ─── waiting (пауза перед повтором)
 *
 *   offline — у устройства нет сети: не тратим попытки, ждём события 'online'
 *   stopped — остановлен нами (stop) или сервер запретил повторы (код 4401)
 */
import { DEFAULT_BACKOFF, backoffDelay, type BackoffOptions } from './backoff'

export type TransportState = 'idle' | 'connecting' | 'open' | 'waiting' | 'offline' | 'stopped'

export type CloseInfo = {
  code: number
  reason: string
  /** Успело ли соединение открыться (false — не удалось даже подключиться). */
  wasOpen: boolean
  /** Будет ли повтор. */
  willRetry: boolean
}

export type TransportOptions = {
  /** Адрес или функция (адрес может зависеть от момента подключения). */
  url: string | (() => string)
  onOpen: () => void
  onMessage: (data: string) => void
  onClose: (info: CloseInfo) => void
  onState: (state: TransportState) => void
  /** По коду закрытия решить, пробовать ли снова. По умолчанию — всегда. */
  shouldReconnect?: (code: number) => boolean
  backoff?: Partial<BackoffOptions>
  /** Сколько ждать открытия соединения, мс. */
  connectTimeout?: number
  // Подмены для тестов:
  WebSocket?: typeof WebSocket
  random?: () => number
}

/** Код, которым мы сами закрываем «зависшее» соединение (диапазон приложений 4000–4999). */
const CLIENT_ABORT = 4999

export class ReconnectingSocket {
  state: TransportState = 'idle'
  /** Сколько неудачных попыток подряд. Сбрасывает markStable(). */
  attempt = 0
  /** Когда следующая попытка (метка времени) — для «повтор через 3 с». */
  retryAt: number | null = null

  private socket: WebSocket | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  /** Ручной режим «нет сети» — кнопка на экране «Соединение». */
  private forcedOffline = false
  private options: TransportOptions
  private backoff: BackoffOptions

  constructor(options: TransportOptions) {
    this.options = options
    this.backoff = { ...DEFAULT_BACKOFF, ...options.backoff }
  }

  // ─── Управление ──────────────────────────────────────────────────────────────

  start() {
    if (this.state !== 'idle' && this.state !== 'stopped') return
    this.attempt = 0
    // Браузер сам сообщает о появлении и пропаже сети — используем как подсказку.
    globalThis.addEventListener?.('online', this.handleOnline)
    globalThis.addEventListener?.('offline', this.handleOffline)
    globalThis.document?.addEventListener('visibilitychange', this.handleVisibility)
    this.connect()
  }

  /** Остановить насовсем (выход из аккаунта, размонтирование приложения). */
  stop(code = 1000, reason = 'client stop') {
    globalThis.removeEventListener?.('online', this.handleOnline)
    globalThis.removeEventListener?.('offline', this.handleOffline)
    globalThis.document?.removeEventListener('visibilitychange', this.handleVisibility)
    this.clearTimers()
    this.setState('stopped')
    this.detach()?.close(code, reason)
  }

  /** Отправить строку. false — соединения нет, данные НЕ отправлены. */
  send(data: string) {
    if (this.state !== 'open' || !this.socket) return false
    this.socket.send(data)
    return true
  }

  /** Оборвать текущее соединение и подключиться заново (сервер перестал отвечать). */
  reconnect(reason = 'reconnect') {
    if (this.state === 'stopped' || this.state === 'idle') return
    // Соединения и так нет (ждём повтора) — просто пробуем прямо сейчас.
    if (this.state === 'waiting' || this.state === 'offline') return this.connect()
    const socket = this.detach()
    const wasOpen = this.state === 'open'
    socket?.close(CLIENT_ABORT, reason)
    // Событие close от этого сокета мы уже не услышим (detach снял обработчики),
    // поэтому сообщаем о закрытии сами.
    this.handleClosed({ code: CLIENT_ABORT, reason, wasOpen })
  }

  /**
   * Соединение признано рабочим — сбросить счётчик попыток.
   *
   * Почему не сбрасывать его сразу при открытии: сервер может принимать
   * соединение и тут же закрывать (перегружен, не принимает токен). Тогда
   * каждое «успешное» открытие обнуляло бы паузу, и клиент долбил бы сервер
   * без остановки. Поэтому «стабильно» решает протокол — после welcome.
   */
  markStable() {
    this.attempt = 0
  }

  /** Ручной режим «нет сети» (для демонстрации). */
  setOffline(offline: boolean) {
    this.forcedOffline = offline
    if (offline) this.handleOffline()
    else this.handleOnline()
  }

  // ─── Подключение ─────────────────────────────────────────────────────────────

  private get isOffline() {
    return this.forcedOffline || globalThis.navigator?.onLine === false
  }

  private connect() {
    this.clearTimers()
    if (this.isOffline) return this.setState('offline')

    this.setState('connecting')
    const Socket = this.options.WebSocket ?? WebSocket
    const url = typeof this.options.url === 'function' ? this.options.url() : this.options.url

    let socket: WebSocket
    try {
      socket = new Socket(url)
    } catch (error) {
      // Конструктор бросает при неверном адресе — это ошибка в коде, повторять бессмысленно.
      console.error('[socket] не удалось создать WebSocket', error)
      return this.setState('stopped')
    }
    this.socket = socket

    let opened = false
    socket.onopen = () => {
      opened = true
      if (this.connectTimer) clearTimeout(this.connectTimer)
      this.setState('open')
      this.options.onOpen()
    }
    socket.onmessage = (event) => {
      if (typeof event.data === 'string') this.options.onMessage(event.data)
    }
    // onerror не несёт подробностей (браузер скрывает их из соображений безопасности),
    // и после него всегда приходит onclose — всю работу делаем там.
    socket.onclose = (event) => {
      this.socket = null
      this.handleClosed({ code: event.code, reason: event.reason, wasOpen: opened })
    }

    // Бывает, что соединение «висит» в connecting: пакеты уходят в никуда.
    this.connectTimer = setTimeout(() => this.reconnect('connect timeout'), this.options.connectTimeout ?? 10_000)
  }

  private handleClosed({ code, reason, wasOpen }: Omit<CloseInfo, 'willRetry'>) {
    if (this.state === 'stopped') return
    this.clearTimers()
    const willRetry = this.options.shouldReconnect?.(code) ?? true
    this.options.onClose({ code, reason, wasOpen, willRetry })
    if (!willRetry) return this.setState('stopped')
    if (this.isOffline) return this.setState('offline')

    const delay = backoffDelay(this.attempt, this.backoff, this.options.random)
    this.attempt += 1
    this.retryAt = Date.now() + delay
    this.setState('waiting')
    this.retryTimer = setTimeout(() => this.connect(), delay)
  }

  /** Отвязать текущий сокет: его события нас больше не интересуют. */
  private detach() {
    const socket = this.socket
    if (socket) socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
    this.socket = null
    return socket
  }

  private clearTimers() {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.connectTimer) clearTimeout(this.connectTimer)
    this.retryTimer = this.connectTimer = null
    this.retryAt = null
  }

  private setState(state: TransportState) {
    if (this.state === state) return
    this.state = state
    this.options.onState(state)
  }

  // ─── Подсказки от браузера ───────────────────────────────────────────────────

  /** Сеть появилась — не ждём остаток паузы, подключаемся сразу. */
  private handleOnline = () => {
    if (this.forcedOffline) return
    if (this.state === 'offline' || this.state === 'waiting') {
      this.attempt = 0
      this.connect()
    }
  }

  /** Сети нет — соединение всё равно мертво; закрываем, чтобы не ждать таймаута. */
  private handleOffline = () => {
    if (this.state === 'stopped' || this.state === 'idle') return
    const wasOpen = this.state === 'open'
    const had = this.detach()
    had?.close(CLIENT_ABORT, 'offline')
    this.clearTimers()
    if (had) this.options.onClose({ code: CLIENT_ABORT, reason: 'offline', wasOpen, willRetry: true })
    this.setState('offline')
  }

  /** Вкладку снова открыли — человеку нужны свежие данные сейчас, а не через 20 с. */
  private handleVisibility = () => {
    if (globalThis.document?.visibilityState === 'visible' && this.state === 'waiting') {
      this.attempt = 0
      this.connect()
    }
  }
}
