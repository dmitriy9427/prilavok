/**
 * Клиент реального времени: наш протокол поверх транспорта.
 *
 * Транспорт (socket.ts) даёт трубу, которая сама переподключается. Этот класс
 * превращает её в удобные для приложения вещи:
 *
 *   subscribe(channel, fn)   слушать канал;
 *   on(type, fn)             слушать события одного вида из любых каналов;
 *   request(method, params)  попросить сервер и дождаться ответа (Promise);
 *   getSnapshot()            состояние соединения для интерфейса.
 *
 * ─── Что происходит при подключении ─────────────────────────────────────────
 *
 *   труба открылась
 *     └▶ hello { токен, мои каналы, «закладка» — последнее, что я видел }
 *          └▶ welcome { сессия, resumed }
 *               ├─ resumed = true  → сервер дослал пропущенное, живём дальше
 *               └─ resumed = false → он его уже не хранит: onResync() —
 *                                    приложение перезапрашивает данные по HTTP
 *
 * ─── Четыре вопроса, на которые отвечает этот файл ──────────────────────────
 *
 * 1. Жив ли сервер? (heartbeat)
 *    Соединение может «умереть молча»: событие close не придёт, пока мы не
 *    попробуем что-то отправить, а иногда и после. Поэтому раз в 15 с шлём
 *    ping и ждём pong 5 с. Не дождались — считаем связь мёртвой и
 *    переподключаемся. Заодно измеряем задержку.
 *
 * 2. Что я пропустил? (закладка: эпоха + seq)
 *    Помним номер последнего события. При переподключении называем его
 *    серверу — он досылает всё, что было после.
 *
 * 3. Дошёл ли мой запрос? (ack)
 *    У каждого req свой id; сервер отвечает ack с тем же id. Promise
 *    разрешается ответом или отклоняется по таймауту.
 *
 * 4. Что делать с запросом, если связи нет? (очередь)
 *    Он ждёт в очереди и уходит после welcome. Если связь оборвалась ПОСЛЕ
 *    отправки, мы не знаем, выполнил ли его сервер. Повторять можно только
 *    идемпотентные запросы (retry: true) — те, что сервер умеет распознать
 *    как повтор и не выполнить дважды.
 */
import {
  CLOSE,
  FATAL_CLOSE_CODES,
  PING_INTERVAL,
  PONG_TIMEOUT,
  PROTOCOL_VERSION,
  decode,
  encode,
  serverFrame,
  type ClientFrame,
  type EventFrame,
  type RequestMethod,
  type Requests,
  type ServerEvents,
  type ServerEventType,
} from '@/shared/protocol'

import { ReconnectingSocket, type TransportOptions } from './socket'

export type RealtimeStatus =
  /** Ещё не запускали. */
  | 'idle'
  /** Открываем соединение. */
  | 'connecting'
  /** Соединение есть, ждём welcome. */
  | 'handshaking'
  /** Всё работает. */
  | 'online'
  /** Связь потеряна, ждём паузу перед повтором. */
  | 'reconnecting'
  /** У устройства нет сети. */
  | 'offline'
  /** Сервер не принял токен. */
  | 'unauthorized'
  | 'stopped'

export type RealtimeSnapshot = {
  status: RealtimeStatus
  /** Номер попытки переподключения (0 — не было). */
  attempt: number
  /** Когда следующая попытка, метка времени. */
  retryAt: number | null
  /** Задержка «туда и обратно» по последнему ping, мс. */
  latency: number | null
  sessionId: string | null
  /** Закладка: эпоха сервера и номер последнего события. */
  epoch: string | null
  seq: number | null
  /** Сколько раз переподключались с момента запуска. */
  reconnects: number
  /** Сколько раз пришлось перезапрашивать данные (сервер не смог дослать пропущенное). */
  resyncs: number
  lastError: string | null
  /** Запросов в очереди и в полёте. */
  pending: number
  channels: string[]
}

/** Запись журнала кадров — для экрана «Соединение». */
export type FrameLogEntry = {
  id: number
  at: number
  /** out — отправили, in — получили, sys — событие соединения. */
  dir: 'out' | 'in' | 'sys'
  /** Вид кадра: hello, event, ack… */
  kind: string
  text: string
  bytes: number
}

export class RealtimeError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

type Listener<T extends ServerEventType = ServerEventType> = (data: ServerEvents[T], frame: EventFrame<T>) => void
type ChannelListener = (frame: EventFrame) => void

type Pending = {
  frame: Extract<ClientFrame, { t: 'req' }>
  resolve: (result: unknown) => void
  reject: (error: RealtimeError) => void
  timer: ReturnType<typeof setTimeout>
  /** Можно ли отправить повторно после обрыва. */
  retry: boolean
  /** Уже ушёл в сеть (ответа пока нет). */
  sent: boolean
}

export type RealtimeOptions = {
  url: string | (() => string)
  getToken: () => string | null
  /** Сервер не принял токен. */
  onUnauthorized?: () => void
  /** Пропущенные события не восстановить — данные нужно перезапросить. */
  onResync?: () => void
  pingInterval?: number
  pongTimeout?: number
  /** Сколько ждать welcome, мс. */
  welcomeTimeout?: number
  /** Через сколько после ухода последнего слушателя отписываться от канала, мс. */
  unsubscribeDelay?: number
  /** Сколько записей хранит журнал кадров. */
  logSize?: number
} & Pick<TransportOptions, 'WebSocket' | 'random' | 'backoff' | 'connectTimeout'>

const INITIAL: RealtimeSnapshot = {
  status: 'idle',
  attempt: 0,
  retryAt: null,
  latency: null,
  sessionId: null,
  epoch: null,
  seq: null,
  reconnects: 0,
  resyncs: 0,
  lastError: null,
  pending: 0,
  channels: [],
}

const CLOSE_REASONS: Record<number, string> = {
  1000: 'обычное закрытие',
  1001: 'сервер или вкладка завершают работу',
  1006: 'обрыв без кадра закрытия',
  [CLOSE.restart]: 'сервер перезапускается',
  [CLOSE.unauthorized]: 'токен не принят',
  [CLOSE.helloTimeout]: 'сервер не дождался hello',
  [CLOSE.idle]: 'сервер закрыл простаивающее соединение',
  [CLOSE.unsupported]: 'версия протокола не поддерживается',
  4999: 'закрыто клиентом',
}

export class RealtimeClient {
  private transport: ReconnectingSocket
  private options: RealtimeOptions
  private snapshot: RealtimeSnapshot = INITIAL
  private stateListeners = new Set<() => void>()

  /** Канал → слушатели. Подписка на сервере есть, пока есть хотя бы один слушатель. */
  private channels = new Map<string, Set<ChannelListener>>()
  private typeListeners = new Map<string, Set<Listener>>()
  /** Отложенные отписки: канал → таймер. */
  private unsubTimers = new Map<string, ReturnType<typeof setTimeout>>()

  private pending = new Map<string, Pending>()
  private counter = 0

  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
  private welcomeTimer: ReturnType<typeof setTimeout> | null = null

  private frames: FrameLogEntry[] = []
  private frameListeners = new Set<() => void>()
  private frameCounter = 0

  /** Режим «сервер молчит»: кадры не уходят и не приходят (для демонстрации heartbeat). */
  private muted = false
  private forcedOffline = false

  constructor(options: RealtimeOptions) {
    this.options = options
    this.transport = new ReconnectingSocket({
      url: options.url,
      WebSocket: options.WebSocket,
      random: options.random,
      backoff: options.backoff,
      connectTimeout: options.connectTimeout,
      shouldReconnect: (code) => !FATAL_CLOSE_CODES.has(code),
      onOpen: () => this.handleOpen(),
      onMessage: (data) => this.handleMessage(data),
      onClose: (info) => this.handleClose(info.code, info.reason, info.willRetry),
      onState: () => this.syncTransportState(),
    })
  }

  // ─── Жизненный цикл ──────────────────────────────────────────────────────────

  start() {
    this.transport.start()
  }

  stop() {
    this.stopHeartbeat()
    for (const timer of this.unsubTimers.values()) clearTimeout(timer)
    this.unsubTimers.clear()
    this.transport.stop()
    this.rejectAll(new RealtimeError('stopped', 'Соединение остановлено'), true)
    this.snapshot = { ...INITIAL, status: 'stopped', channels: this.snapshot.channels }
    this.emitState()
  }

  /** Не ждать остаток паузы — подключиться сейчас (кнопка «Подключиться сейчас»). */
  reconnectNow() {
    this.transport.reconnect('manual')
  }

  // ─── Подписки ────────────────────────────────────────────────────────────────

  /**
   * Слушать канал. Возвращает функцию отписки.
   *
   * Несколько компонентов могут слушать один канал: серверу уходит один sub
   * при первом слушателе и один unsub, когда ушёл последний.
   *
   * Отписка от сервера — с небольшой задержкой. При переходе между экранами
   * один компонент отписывается, а следующий тут же подписывается на тот же
   * канал: без задержки серверу летела бы пара unsub + sub, а между ними можно
   * было бы потерять событие. За время задержки новый слушатель успевает прийти.
   */
  subscribe(channel: string, listener: ChannelListener = () => {}) {
    const pendingUnsub = this.unsubTimers.get(channel)
    if (pendingUnsub) {
      clearTimeout(pendingUnsub)
      this.unsubTimers.delete(channel)
    }

    let listeners = this.channels.get(channel)
    if (!listeners) {
      listeners = new Set()
      this.channels.set(channel, listeners)
      // Если мы не в сети — ничего не шлём: при подключении каналы уйдут в hello.
      if (this.snapshot.status === 'online') this.sendFrame({ t: 'sub', id: this.nextId(), channel })
      this.patch({ channels: [...this.channels.keys()] })
    }
    listeners.add(listener)

    return () => {
      const current = this.channels.get(channel)
      if (!current?.delete(listener) || current.size > 0) return
      this.unsubTimers.set(
        channel,
        setTimeout(() => {
          this.unsubTimers.delete(channel)
          if (this.channels.get(channel)?.size) return
          this.channels.delete(channel)
          if (this.snapshot.status === 'online') this.sendFrame({ t: 'unsub', id: this.nextId(), channel })
          this.patch({ channels: [...this.channels.keys()] })
        }, this.options.unsubscribeDelay ?? 300),
      )
    }
  }

  /** Слушать события одного вида (из любых каналов, на которые есть подписка). */
  on<T extends ServerEventType>(type: T, listener: Listener<T>) {
    let listeners = this.typeListeners.get(type)
    if (!listeners) this.typeListeners.set(type, (listeners = new Set()))
    listeners.add(listener as unknown as Listener)
    return () => {
      listeners.delete(listener as unknown as Listener)
    }
  }

  // ─── Запросы ─────────────────────────────────────────────────────────────────

  /**
   * Попросить сервер что-то сделать и дождаться ответа.
   *
   * @param options.timeout сколько ждать ответа (включая ожидание связи), мс
   * @param options.retry   запрос идемпотентный: после обрыва его можно послать снова
   */
  request<M extends RequestMethod>(method: M, params: Requests[M]['params'], options: { timeout?: number; retry?: boolean } = {}): Promise<Requests[M]['result']> {
    return new Promise((resolve, reject) => {
      const id = this.nextId()
      const pending: Pending = {
        frame: { t: 'req', id, method, params },
        resolve: resolve as (result: unknown) => void,
        reject,
        retry: options.retry ?? false,
        sent: false,
        timer: setTimeout(() => {
          this.pending.delete(id)
          this.patch({ pending: this.pending.size })
          reject(new RealtimeError('timeout', 'Сервер не ответил вовремя'))
        }, options.timeout ?? 8000),
      }
      this.pending.set(id, pending)
      this.patch({ pending: this.pending.size })
      if (this.snapshot.status === 'online') this.dispatch(pending)
    })
  }

  private dispatch(pending: Pending) {
    pending.sent = this.sendFrame(pending.frame)
  }

  // ─── События транспорта ──────────────────────────────────────────────────────

  private handleOpen() {
    this.log('sys', 'open', 'Соединение открыто')
    const { epoch, seq } = this.snapshot
    // Первым кадром — кто мы и что видели. До welcome ничего другого не шлём.
    this.sendFrame(
      {
        t: 'hello',
        v: PROTOCOL_VERSION,
        token: this.options.getToken() ?? '',
        channels: [...this.channels.keys()],
        resume: epoch !== null && seq !== null ? { epoch, seq } : null,
      },
      true,
    )
    this.welcomeTimer = setTimeout(() => {
      this.patch({ lastError: 'Сервер не ответил на hello' })
      this.transport.reconnect('welcome timeout')
    }, this.options.welcomeTimeout ?? 8000)
  }

  private handleMessage(raw: string) {
    if (this.muted) return
    const frame = decode(serverFrame, raw)
    if (!frame) {
      this.log('in', 'мусор', raw, raw.length)
      return
    }
    this.log('in', frame.t === 'event' ? frame.type : frame.t, raw, raw.length)

    switch (frame.t) {
      case 'welcome': {
        if (this.welcomeTimer) clearTimeout(this.welcomeTimer)
        const hadBookmark = this.snapshot.seq !== null
        // Сервер дослал пропущенное → закладку не трогаем, её сдвинут досланные события.
        // Не смог → начинаем с его текущего номера и просим приложение перезапросить данные.
        const resync = hadBookmark && !frame.resumed
        this.patch({
          status: 'online',
          sessionId: frame.sessionId,
          epoch: frame.epoch,
          seq: frame.resumed && hadBookmark ? this.snapshot.seq : frame.seq,
          attempt: 0,
          retryAt: null,
          lastError: null,
          resyncs: this.snapshot.resyncs + (resync ? 1 : 0),
        })
        this.transport.markStable()
        this.startHeartbeat()
        if (resync) {
          this.log('sys', 'resync', 'Пропущенные события недоступны — перезапрашиваем данные')
          this.options.onResync?.()
        }
        // Очередь: всё, что ждало связи (и идемпотентные запросы, оставшиеся без ответа).
        for (const pending of this.pending.values()) if (!pending.sent) this.dispatch(pending)
        return
      }

      case 'event': {
        if (frame.seq !== null) {
          // Повтор (уже видели) — возможен при досылке; пропускаем.
          if (this.snapshot.seq !== null && frame.seq <= this.snapshot.seq) return
          this.patch({ seq: frame.seq })
        }
        const event = frame as EventFrame
        // Ошибка в одном слушателе не должна оставить без события остальных.
        for (const listener of this.channels.get(event.channel) ?? []) safely(() => listener(event))
        for (const listener of this.typeListeners.get(event.type) ?? []) safely(() => listener(event.data, event))
        return
      }

      case 'ack': {
        const pending = this.pending.get(frame.id)
        if (!pending) return // ответ на sub/unsub или на запрос, который уже истёк
        clearTimeout(pending.timer)
        this.pending.delete(frame.id)
        this.patch({ pending: this.pending.size })
        if (frame.ok) pending.resolve(frame.result)
        else pending.reject(new RealtimeError(frame.error.code, frame.error.message))
        return
      }

      case 'pong': {
        if (this.pongTimer) clearTimeout(this.pongTimer)
        this.pongTimer = null
        // Все события с номером до frame.seq нам уже отправлены (порядок в соединении
        // гарантирован), значит закладку можно сдвинуть — даже если в наших каналах тихо.
        this.patch({ latency: Date.now() - frame.ts, seq: Math.max(this.snapshot.seq ?? 0, frame.seq) })
        return
      }

      case 'error':
        this.patch({ lastError: frame.message })
    }
  }

  private handleClose(code: number, reason: string, willRetry: boolean) {
    this.stopHeartbeat()
    const text = CLOSE_REASONS[code] ?? (reason || 'неизвестная причина')
    this.log('sys', 'close', `Соединение закрыто: код ${code} — ${text}`)

    // Запросы без ответа: идемпотентные вернём в очередь, остальным честно скажем «не знаем».
    for (const [id, pending] of this.pending) {
      if (!pending.sent) continue
      if (pending.retry) pending.sent = false
      else {
        clearTimeout(pending.timer)
        this.pending.delete(id)
        pending.reject(new RealtimeError('disconnected', 'Связь оборвалась — неизвестно, выполнен ли запрос'))
      }
    }

    if (!willRetry) {
      this.rejectAll(new RealtimeError('closed', text), true)
      if (code === CLOSE.unauthorized) this.options.onUnauthorized?.()
    }
    this.patch({
      // 4999 — закрыли сами; причина уже записана тем, кто закрывал (нет pong, нет welcome).
      lastError: code === 1000 ? null : code === 4999 ? (this.snapshot.lastError ?? text) : text,
      latency: null,
      sessionId: null,
      pending: this.pending.size,
      reconnects: this.snapshot.reconnects + (willRetry ? 1 : 0),
      ...(code === CLOSE.unauthorized && { status: 'unauthorized' as const }),
    })
  }

  /** Перевести состояние транспорта в статус для интерфейса. */
  private syncTransportState() {
    const state = this.transport.state
    const status: RealtimeStatus =
      state === 'open' ? 'handshaking' : state === 'waiting' ? 'reconnecting' : state === 'stopped' && this.snapshot.status === 'unauthorized' ? 'unauthorized' : state
    if (state === 'waiting') {
      const seconds = Math.max(0, ((this.transport.retryAt ?? Date.now()) - Date.now()) / 1000)
      this.log('sys', 'retry', `Повтор №${this.transport.attempt} через ${seconds.toFixed(1)} с`)
    }
    this.patch({ status, attempt: this.transport.attempt, retryAt: this.transport.retryAt })
  }

  // ─── Heartbeat ───────────────────────────────────────────────────────────────

  private startHeartbeat() {
    this.stopHeartbeat()
    const ping = () => {
      this.sendFrame({ t: 'ping', ts: Date.now() })
      // Один таймер ожидания на один ping: не дождались — связь мертва.
      this.pongTimer ??= setTimeout(() => {
        this.pongTimer = null
        this.patch({ lastError: 'Сервер не отвечает на ping' })
        this.log('sys', 'heartbeat', 'Нет pong — считаем соединение мёртвым')
        this.transport.reconnect('pong timeout')
      }, this.options.pongTimeout ?? PONG_TIMEOUT)
    }
    this.pingTimer = setInterval(ping, this.options.pingInterval ?? PING_INTERVAL)
    ping() // сразу: узнаём задержку, не дожидаясь первого интервала
  }

  private stopHeartbeat() {
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.pongTimer) clearTimeout(this.pongTimer)
    if (this.welcomeTimer) clearTimeout(this.welcomeTimer)
    this.pingTimer = this.pongTimer = this.welcomeTimer = null
  }

  // ─── Отправка и журнал ───────────────────────────────────────────────────────

  private sendFrame(frame: ClientFrame, force = false) {
    if (this.muted && !force) return true // «чёрная дыра»: считаем отправленным, но никуда не шлём
    const text = encode(frame)
    const sent = this.transport.send(text)
    // Токен в журнал не пишем: журнал виден на экране и попадает в скриншоты.
    if (sent) this.log('out', frame.t === 'req' ? frame.method : frame.t, frame.t === 'hello' ? encode({ ...frame, token: '•••' }) : text, text.length)
    return sent
  }

  private log(dir: FrameLogEntry['dir'], kind: string, text: string, bytes = 0) {
    this.frames.push({ id: ++this.frameCounter, at: Date.now(), dir, kind, text: text.length > 400 ? `${text.slice(0, 400)}…` : text, bytes })
    const limit = this.options.logSize ?? 300
    if (this.frames.length > limit) this.frames = this.frames.slice(-limit)
    else this.frames = [...this.frames] // новая ссылка — иначе React не заметит изменения
    for (const listener of this.frameListeners) listener()
  }

  private rejectAll(error: RealtimeError, includingQueued: boolean) {
    for (const [id, pending] of this.pending) {
      if (!includingQueued && !pending.sent) continue
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(error)
    }
  }

  private nextId() {
    return `${Date.now().toString(36)}-${++this.counter}`
  }

  // ─── Состояние для интерфейса (useSyncExternalStore) ─────────────────────────

  getSnapshot = () => this.snapshot
  subscribeState = (listener: () => void) => {
    this.stateListeners.add(listener)
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  getFrames = () => this.frames
  subscribeFrames = (listener: () => void) => {
    this.frameListeners.add(listener)
    return () => {
      this.frameListeners.delete(listener)
    }
  }

  clearFrames() {
    this.frames = []
    for (const listener of this.frameListeners) listener()
  }

  private patch(patch: Partial<RealtimeSnapshot>) {
    // Объект снимка меняется только при настоящем изменении: useSyncExternalStore
    // сравнивает снимки по ссылке и на «новый объект с теми же значениями» ответил бы
    // бесконечной перерисовкой.
    const keys = Object.keys(patch) as (keyof RealtimeSnapshot)[]
    if (keys.every((key) => (key === 'channels' ? String(patch.channels) === String(this.snapshot.channels) : patch[key] === this.snapshot[key]))) return
    this.snapshot = { ...this.snapshot, ...patch }
    this.emitState()
  }

  private emitState() {
    for (const listener of this.stateListeners) listener()
  }

  // ─── Инструменты для демонстрации (экран «Соединение») ───────────────────────

  debug = {
    /** Оборвать соединение, как это сделала бы сеть. */
    drop: () => {
      this.log('sys', 'debug', 'Имитация: обрыв соединения')
      this.transport.reconnect('debug drop')
    },
    /** Сервер «молчит»: соединение формально открыто, но кадры не ходят. */
    mute: (muted: boolean) => {
      if (this.muted === muted) return
      this.muted = muted
      this.log('sys', 'debug', muted ? 'Имитация: сервер перестал отвечать' : 'Имитация: сервер снова отвечает')
    },
    /** У устройства «пропала сеть». */
    offline: (offline: boolean) => {
      if (this.forcedOffline === offline) return
      this.forcedOffline = offline
      this.log('sys', 'debug', offline ? 'Имитация: сеть отключена' : 'Имитация: сеть вернулась')
      this.transport.setOffline(offline)
    },
    isMuted: () => this.muted,
  }
}

function safely(fn: () => void) {
  try {
    fn()
  } catch (error) {
    console.error('[realtime] ошибка в обработчике события', error)
  }
}
