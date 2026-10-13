/**
 * Хаб реального времени — серверная половина WebSocket.
 *
 * Хаб ничего не знает о том, КАК доставляются байты. Ему дают «соединение»
 * (объект с send и close) и сообщают о трёх событиях: подключился, прислал
 * кадр, отключился. Поэтому один и тот же хаб работает:
 *   - в браузере — соединения изображает MSW (src/mocks);
 *   - в Node — настоящие сокеты библиотеки ws (server/index.ts);
 *   - в тестах — пара функций-заглушек.
 *
 * ─── Что делает хаб ─────────────────────────────────────────────────────────
 *   1. Рукопожатие: ждёт hello, проверяет токен, отвечает welcome.
 *   2. Подписки: помнит, кто на какой канал подписан, и рассылает события
 *      только подписчикам (publish).
 *   3. Нумерация и буфер: каждому событию-факту — номер (seq); последние N
 *      лежат в буфере, чтобы дослать их клиенту после обрыва связи.
 *   4. Запросы: выполняет req и отвечает ack.
 *   5. Присутствие: кто какой заказ сейчас смотрит.
 *   6. Уборка: закрывает соединения, которые давно молчат.
 */
import {
  CLOSE,
  EPHEMERAL,
  PROTOCOL_VERSION,
  SERVER_IDLE_TIMEOUT,
  clientFrame,
  decode,
  encode,
  orderIdFromChannel,
  requestParams,
  type ClientFrame,
  type EventFrame,
  type RequestMethod,
  type Requests,
  type ServerEvents,
  type ServerEventType,
  type ServerFrame,
} from '../shared/protocol.ts'
import type { PresenceUser, User } from '../shared/types.ts'

/** Всё, что хабу нужно от транспорта. */
export interface Connection {
  send(data: string): void
  close(code: number, reason: string): void
}

/** Ошибка запроса, которую нужно вернуть клиенту в ack. */
export class HubError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

type Session = {
  id: string
  conn: Connection
  /** null — hello ещё не пришёл. */
  user: User | null
  channels: Set<string>
  /** Когда клиент последний раз что-то присылал. */
  lastSeen: number
  /** Какой заказ открыт у пользователя. */
  focus: string | null
  helloTimer: ReturnType<typeof setTimeout> | null
}

type RequestHandlers = {
  [M in RequestMethod]: (params: Requests[M]['params'], user: User) => Requests[M]['result']
}

export type HubOptions = {
  now: () => number
  authenticate: (token: string) => User | null
  /** Обработчики req (кроме presence.focus — его хаб выполняет сам). */
  handlers: Omit<RequestHandlers, 'presence.focus'>
  /** Текущее состояние канала для только что подписавшегося (метрики, присутствие). */
  snapshot?: (channel: string) => { type: ServerEventType; data: unknown } | null
  /** Сколько событий хранить для досылки. */
  bufferSize?: number
  /** Сколько ждать hello, мс. */
  helloTimeout?: number
}

export class Hub {
  /** Эпоха: меняется при каждом запуске сервера (см. protocol.ts). */
  epoch = Math.random().toString(36).slice(2, 10)
  private seq = 0
  private buffer: EventFrame[] = []
  private sessions = new Map<Connection, Session>()
  private counter = 0
  /** «Коллеги» от симулятора: заказ → кто его якобы смотрит. */
  private bots = new Map<string, PresenceUser[]>()
  private options: Required<Omit<HubOptions, 'snapshot'>> & Pick<HubOptions, 'snapshot'>

  constructor(options: HubOptions) {
    this.options = { bufferSize: 500, helloTimeout: 5000, ...options }
  }

  // ─── Три события транспорта ──────────────────────────────────────────────────

  /** Клиент подключился. Он ещё никто: ждём hello. */
  connect(conn: Connection) {
    const session: Session = {
      id: `s${++this.counter}`,
      conn,
      user: null,
      channels: new Set(),
      lastSeen: this.options.now(),
      focus: null,
      // Молчаливое соединение держать незачем: это либо сбой, либо сканер портов.
      helloTimer: setTimeout(() => conn.close(CLOSE.helloTimeout, 'hello timeout'), this.options.helloTimeout),
    }
    this.sessions.set(conn, session)
  }

  /** Клиент прислал данные. */
  receive(conn: Connection, raw: unknown) {
    const session = this.sessions.get(conn)
    if (!session) return
    session.lastSeen = this.options.now()

    const frame = decode(clientFrame, raw)
    if (!frame) return this.send(session, { t: 'error', code: 'bad_frame', message: 'Кадр не распознан' })

    if (frame.t === 'hello') return this.hello(session, frame)
    // До hello разрешён только hello: неизвестному клиенту ничего не отдаём.
    if (!session.user) return this.send(session, { t: 'error', code: 'no_hello', message: 'Сначала hello' })

    switch (frame.t) {
      case 'ping':
        return this.send(session, { t: 'pong', ts: frame.ts, seq: this.seq })
      case 'sub':
        this.subscribe(session, frame.channel)
        return this.send(session, { t: 'ack', id: frame.id, ok: true, result: null })
      case 'unsub':
        session.channels.delete(frame.channel)
        return this.send(session, { t: 'ack', id: frame.id, ok: true, result: null })
      case 'req':
        return this.request(session, session.user, frame)
    }
  }

  /** Соединение закрылось (по любой причине). */
  disconnect(conn: Connection) {
    const session = this.sessions.get(conn)
    if (!session) return
    if (session.helloTimer) clearTimeout(session.helloTimer)
    this.sessions.delete(conn)
    // Человек ушёл — его больше нет среди смотрящих заказ.
    if (session.focus) this.publishPresence(session.focus)
  }

  // ─── Рукопожатие ─────────────────────────────────────────────────────────────

  private hello(session: Session, frame: Extract<ClientFrame, { t: 'hello' }>) {
    if (session.helloTimer) clearTimeout(session.helloTimer)
    session.helloTimer = null

    if (frame.v !== PROTOCOL_VERSION) return session.conn.close(CLOSE.unsupported, 'unsupported protocol version')
    const user = this.options.authenticate(frame.token)
    if (!user) return session.conn.close(CLOSE.unauthorized, 'unauthorized')

    session.user = user
    session.channels = new Set(frame.channels)

    // Можно ли дослать пропущенное? Да, если клиент был на ЭТОМ сервере (эпоха)
    // и всё, что он пропустил, ещё лежит в буфере.
    const oldest = this.buffer[0]?.seq ?? this.seq + 1
    const resume = frame.resume
    const resumed = !resume || (resume.epoch === this.epoch && resume.seq <= this.seq && resume.seq >= oldest - 1)

    this.send(session, {
      t: 'welcome',
      sessionId: session.id,
      user,
      epoch: this.epoch,
      seq: this.seq,
      resumed,
      serverTime: this.options.now(),
    })

    if (resume && resumed) {
      for (const event of this.buffer) {
        if (event.seq! > resume.seq && session.channels.has(event.channel)) this.send(session, event)
      }
    }
    for (const channel of session.channels) this.sendSnapshot(session, channel)
  }

  // ─── Подписки и рассылка ─────────────────────────────────────────────────────

  private subscribe(session: Session, channel: string) {
    // Здесь же проверялись бы права: «может ли этот пользователь слушать этот канал».
    session.channels.add(channel)
    this.sendSnapshot(session, channel)
  }

  /** Новому подписчику — текущее состояние канала, не дожидаясь следующего события. */
  private sendSnapshot(session: Session, channel: string) {
    const orderId = orderIdFromChannel(channel)
    const snapshot = orderId ? { type: 'presence' as const, data: { users: this.viewers(orderId) } } : this.options.snapshot?.(channel)
    if (!snapshot) return
    this.send(session, { t: 'event', seq: null, channel, type: snapshot.type, data: snapshot.data, at: this.options.now() } as EventFrame)
  }

  /**
   * Сообщить о событии всем подписчикам канала.
   * Факты нумеруются и попадают в буфер; состояния — нет.
   */
  publish<T extends ServerEventType>(channel: string, type: T, data: ServerEvents[T]) {
    const fact = !EPHEMERAL.has(type)
    const frame = { t: 'event', seq: fact ? ++this.seq : null, channel, type, data, at: this.options.now() } as EventFrame
    if (fact) {
      this.buffer.push(frame)
      if (this.buffer.length > this.options.bufferSize) this.buffer.shift()
    }
    // Кадр сериализуется ОДИН раз, а не для каждого получателя.
    const text = encode(frame)
    for (const session of this.sessions.values()) {
      if (session.user && session.channels.has(channel)) session.conn.send(text)
    }
    return frame
  }

  // ─── Запросы ─────────────────────────────────────────────────────────────────

  private request(session: Session, user: User, frame: Extract<ClientFrame, { t: 'req' }>) {
    const fail = (code: string, message: string) => this.send(session, { t: 'ack', id: frame.id, ok: false, error: { code, message } })

    if (!(frame.method in requestParams)) return fail('unknown_method', `Неизвестный метод: ${frame.method}`)
    const method = frame.method as RequestMethod
    const params = requestParams[method].safeParse(frame.params)
    if (!params.success) return fail('bad_params', params.error.issues[0]?.message ?? 'Неверные параметры')

    try {
      const result =
        method === 'presence.focus' ? this.focus(session, (params.data as Requests['presence.focus']['params']).orderId) : this.options.handlers[method](params.data as never, user)
      this.send(session, { t: 'ack', id: frame.id, ok: true, result })
    } catch (error) {
      if (error instanceof HubError) return fail(error.code, error.message)
      // Внутренние подробности клиенту не отдаём — только в журнал сервера.
      console.error('[hub] ошибка запроса', frame.method, error)
      fail('internal', 'Внутренняя ошибка')
    }
  }

  // ─── Присутствие ─────────────────────────────────────────────────────────────

  private focus(session: Session, orderId: string | null) {
    const previous = session.focus
    session.focus = orderId
    if (previous && previous !== orderId) this.publishPresence(previous)
    if (orderId) this.publishPresence(orderId)
    return { ok: true as const }
  }

  /** Кто смотрит заказ: живые сессии + «коллеги» симулятора, без повторов. */
  viewers(orderId: string): PresenceUser[] {
    const users = new Map<string, PresenceUser>()
    for (const { user, focus } of this.sessions.values()) {
      if (user && focus === orderId) users.set(user.id, { id: user.id, name: user.name, hue: user.hue })
    }
    for (const bot of this.bots.get(orderId) ?? []) users.set(bot.id, bot)
    return [...users.values()]
  }

  private publishPresence(orderId: string) {
    this.publish(`order:${orderId}`, 'presence', { users: this.viewers(orderId) })
  }

  /** Симулятор: «коллеги» открыли или закрыли заказ. */
  setBots(orderId: string, users: PresenceUser[]) {
    if (users.length) this.bots.set(orderId, users)
    else this.bots.delete(orderId)
    this.publishPresence(orderId)
  }

  /** Заказы, которые сейчас открыты у живых пользователей. */
  focusedOrders() {
    return [...new Set([...this.sessions.values()].map((s) => s.focus).filter((id): id is string => id !== null))]
  }

  // ─── Уборка ──────────────────────────────────────────────────────────────────

  /**
   * Закрыть соединения, которые давно молчат. Вызывается по таймеру.
   * Сеть умеет «терять» клиентов без события close (выключили Wi-Fi, уснул
   * ноутбук): сервер продолжал бы хранить сессию и слать в пустоту.
   */
  sweep() {
    const deadline = this.options.now() - SERVER_IDLE_TIMEOUT
    for (const session of [...this.sessions.values()]) {
      if (session.lastSeen < deadline) session.conn.close(CLOSE.idle, 'idle')
    }
  }

  /** Закрыть всех (перезапуск сервера): клиенты переподключатся сами. */
  closeAll(code: number = CLOSE.restart, reason = 'server restart') {
    for (const session of [...this.sessions.values()]) session.conn.close(code, reason)
  }

  /**
   * Изобразить перезапуск сервера (кнопка на экране «Соединение»): все отключены,
   * нумерация и буфер начинаются заново, эпоха новая. У настоящего сервера то же
   * самое происходит само — при перезапуске процесса.
   */
  restart() {
    this.closeAll()
    this.epoch = Math.random().toString(36).slice(2, 10)
    this.seq = 0
    this.buffer = []
    this.bots.clear()
  }

  get info() {
    return { connections: this.sessions.size, seq: this.seq, buffered: this.buffer.length }
  }

  private send(session: Session, frame: ServerFrame) {
    session.conn.send(encode(frame))
  }
}
