import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CLOSE } from '@/shared/protocol'
import { FakeSocket, asWebSocket } from '@/test/fake-socket'

import { RealtimeClient, RealtimeError, type RealtimeOptions } from './client'

const USER = { id: 'u1', name: 'Тест', email: 't@t', role: 'admin', hue: 1 }
const welcome = (over: Record<string, unknown> = {}) => ({ t: 'welcome', sessionId: 's1', user: USER, epoch: 'e1', seq: 10, resumed: true, serverTime: 0, ...over })
const event = (seq: number | null, channel: string, type: string, data: unknown = {}) => ({ t: 'event', seq, channel, type, data, at: 0 })

const clients: RealtimeClient[] = []

function setup(overrides: Partial<RealtimeOptions> = {}) {
  const onResync = vi.fn()
  const onUnauthorized = vi.fn()
  const client = new RealtimeClient({
    url: 'ws://test/ws',
    getToken: () => 'demo.u1',
    WebSocket: asWebSocket,
    random: () => 0.999999,
    onResync,
    onUnauthorized,
    ...overrides,
  })
  clients.push(client)
  return { client, onResync, onUnauthorized }
}

/** Запустить клиента и довести до состояния «в сети». */
function connect(client: RealtimeClient, over: Record<string, unknown> = {}) {
  client.start()
  FakeSocket.last.open()
  FakeSocket.last.receive(welcome(over))
  return FakeSocket.last
}

/** Оборвать связь и дождаться нового сокета. */
function reconnect() {
  FakeSocket.last.drop()
  vi.advanceTimersByTime(500)
  FakeSocket.last.open()
  return FakeSocket.last
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.reset()
})
afterEach(() => {
  for (const client of clients.splice(0)) client.stop()
  vi.useRealTimers()
})

describe('рукопожатие', () => {
  it('первым кадром шлёт hello с токеном и каналами', () => {
    const { client } = setup()
    client.subscribe('orders')
    client.start()
    expect(client.getSnapshot().status).toBe('connecting')

    FakeSocket.last.open()
    expect(client.getSnapshot().status).toBe('handshaking')
    expect(FakeSocket.last.sent[0]).toEqual({ t: 'hello', v: 1, token: 'demo.u1', channels: ['orders'], resume: null })

    FakeSocket.last.receive(welcome())
    expect(client.getSnapshot()).toMatchObject({ status: 'online', sessionId: 's1', epoch: 'e1', seq: 10 })
  })

  it('если welcome не пришёл — переподключается', () => {
    const { client } = setup({ welcomeTimeout: 3000 })
    client.start()
    FakeSocket.last.open()
    vi.advanceTimersByTime(3000)

    expect(FakeSocket.instances[0]!.closedWith?.reason).toBe('welcome timeout')
    expect(client.getSnapshot().status).toBe('reconnecting')
  })

  it('при отказе в доступе не переподключается и сообщает приложению', () => {
    const { client, onUnauthorized } = setup()
    client.start()
    FakeSocket.last.open()
    FakeSocket.last.drop(CLOSE.unauthorized, 'unauthorized')

    expect(client.getSnapshot().status).toBe('unauthorized')
    expect(onUnauthorized).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('не пишет токен в журнал кадров', () => {
    const { client } = setup()
    connect(client)
    expect(client.getFrames().some((frame) => frame.text.includes('demo.u1'))).toBe(false)
  })
})

describe('подписки', () => {
  it('доставляет события слушателям канала и вида', () => {
    const { client } = setup()
    const onChannel = vi.fn()
    const onType = vi.fn()
    client.subscribe('orders', onChannel)
    client.on('order.updated', onType)
    const socket = connect(client)

    socket.receive(event(11, 'orders', 'order.updated', { id: 'o1' }))
    expect(onChannel).toHaveBeenCalledOnce()
    expect(onType).toHaveBeenCalledWith({ id: 'o1' }, expect.objectContaining({ seq: 11 }))
  })

  it('на сервер уходит один sub на канал, сколько бы ни было слушателей', () => {
    const { client } = setup()
    const socket = connect(client)

    const offA = client.subscribe('orders')
    const offB = client.subscribe('orders')
    expect(socket.framesOf('sub')).toHaveLength(1)

    offA()
    vi.advanceTimersByTime(300)
    expect(socket.framesOf('unsub')).toHaveLength(0) // ещё есть слушатель
    offB()
    vi.advanceTimersByTime(300)
    expect(socket.framesOf('unsub')).toHaveLength(1)
    expect(client.getSnapshot().channels).toEqual([])
  })

  it('быстрая переподписка (переход между экранами) не доходит до сервера', () => {
    const { client } = setup()
    const socket = connect(client)
    const off = client.subscribe('products')

    off() // старый экран размонтирован
    client.subscribe('products') // новый экран смонтирован
    vi.advanceTimersByTime(1000)

    expect(socket.framesOf('sub')).toHaveLength(1)
    expect(socket.framesOf('unsub')).toHaveLength(0)
    expect(client.getSnapshot().channels).toEqual(['products'])
  })

  it('подписка без связи уходит в hello при подключении', () => {
    const { client } = setup()
    client.subscribe('metrics')
    client.subscribe('order:o1')
    const socket = connect(client)

    expect(socket.framesOf('sub')).toHaveLength(0)
    expect(socket.sent[0]).toMatchObject({ t: 'hello', channels: ['metrics', 'order:o1'] })
  })

  it('ошибка в одном обработчике не мешает остальным', () => {
    const { client } = setup()
    const good = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    client.subscribe('orders', () => {
      throw new Error('сломался')
    })
    client.subscribe('orders', good)
    connect(client).receive(event(11, 'orders', 'order.created'))
    expect(good).toHaveBeenCalledOnce()
  })
})

describe('докачка после обрыва', () => {
  it('запоминает номер последнего события и называет его при переподключении', () => {
    const { client } = setup()
    client.subscribe('orders')
    const socket = connect(client)
    socket.receive(event(11, 'orders', 'order.created'))
    socket.receive(event(14, 'orders', 'order.updated'))

    const next = reconnect()
    expect(next.sent[0]).toMatchObject({ t: 'hello', resume: { epoch: 'e1', seq: 14 } })
  })

  it('события-состояния (seq = null) закладку не двигают', () => {
    const { client } = setup()
    const onTick = vi.fn()
    client.subscribe('metrics')
    client.on('metrics.tick', onTick)
    connect(client).receive(event(null, 'metrics', 'metrics.tick', { online: 5 }))

    expect(onTick).toHaveBeenCalledOnce()
    expect(client.getSnapshot().seq).toBe(10)
  })

  it('досланные события обрабатываются, повторы — нет', () => {
    const { client, onResync } = setup()
    const onEvent = vi.fn()
    client.subscribe('orders', onEvent)
    connect(client).receive(event(11, 'orders', 'order.created'))

    const next = reconnect()
    next.receive(welcome({ seq: 13, resumed: true }))
    next.receive(event(11, 'orders', 'order.created')) // уже видели
    next.receive(event(12, 'orders', 'order.updated'))
    next.receive(event(13, 'orders', 'order.updated'))

    expect(onEvent).toHaveBeenCalledTimes(3)
    expect(client.getSnapshot().seq).toBe(13)
    expect(onResync).not.toHaveBeenCalled()
  })

  it('если сервер не может дослать — просит приложение перезапросить данные', () => {
    const { client, onResync } = setup()
    connect(client)

    const next = reconnect()
    next.receive(welcome({ epoch: 'e2', seq: 3, resumed: false }))

    expect(onResync).toHaveBeenCalledOnce()
    // Закладка переставлена на новый сервер: старый номер к нему не относится.
    expect(client.getSnapshot()).toMatchObject({ epoch: 'e2', seq: 3, resyncs: 1 })
  })

  it('первое подключение — не resync', () => {
    const { client, onResync } = setup()
    connect(client, { resumed: false })
    expect(onResync).not.toHaveBeenCalled()
  })

  it('pong сдвигает закладку, даже если в каналах клиента тихо', () => {
    const { client } = setup()
    const socket = connect(client)
    const ping = socket.framesOf('ping')[0]!
    socket.receive({ t: 'pong', ts: ping.ts, seq: 57 })
    expect(client.getSnapshot().seq).toBe(57)
  })
})

describe('heartbeat', () => {
  it('шлёт ping сразу и затем по интервалу, считает задержку', () => {
    const { client } = setup({ pingInterval: 1000 })
    const socket = connect(client)
    expect(socket.framesOf('ping')).toHaveLength(1)

    vi.advanceTimersByTime(40)
    socket.receive({ t: 'pong', ts: socket.framesOf('ping')[0]!.ts, seq: 10 })
    expect(client.getSnapshot().latency).toBe(40)

    vi.advanceTimersByTime(1000)
    expect(socket.framesOf('ping')).toHaveLength(2)
  })

  it('нет pong — считает соединение мёртвым и переподключается', () => {
    const { client } = setup({ pingInterval: 1000, pongTimeout: 300 })
    const socket = connect(client)
    vi.advanceTimersByTime(300)

    expect(socket.closedWith?.reason).toBe('pong timeout')
    expect(client.getSnapshot()).toMatchObject({ status: 'reconnecting', lastError: 'Сервер не отвечает на ping' })
  })

  it('режим «сервер молчит» ловится heartbeat-ом', () => {
    const { client } = setup({ pingInterval: 1000, pongTimeout: 300 })
    const socket = connect(client)
    socket.receive({ t: 'pong', ts: socket.framesOf('ping')[0]!.ts, seq: 10 })

    client.debug.mute(true)
    vi.advanceTimersByTime(1000 + 300)
    expect(client.getSnapshot().status).toBe('reconnecting')
  })
})

describe('запросы', () => {
  it('разрешается ответом сервера', async () => {
    const { client } = setup()
    const socket = connect(client)
    const promise = client.request('presence.focus', { orderId: 'o1' })

    const req = socket.framesOf('req')[0]!
    expect(req).toMatchObject({ method: 'presence.focus', params: { orderId: 'o1' } })
    socket.receive({ t: 'ack', id: req.id, ok: true, result: { ok: true } })
    await expect(promise).resolves.toEqual({ ok: true })
    expect(client.getSnapshot().pending).toBe(0)
  })

  it('отклоняется ошибкой сервера с кодом', async () => {
    const { client } = setup()
    const socket = connect(client)
    const promise = client.request('note.add', { orderId: 'o1', text: 'x', clientId: 'c1' })
    socket.receive({ t: 'ack', id: socket.framesOf('req')[0]!.id, ok: false, error: { code: 'forbidden', message: 'Нельзя' } })

    await expect(promise).rejects.toMatchObject({ code: 'forbidden', message: 'Нельзя' })
    await expect(promise).rejects.toBeInstanceOf(RealtimeError)
  })

  it('отклоняется по таймауту', async () => {
    const { client } = setup()
    connect(client)
    const promise = client.request('presence.focus', { orderId: null }, { timeout: 2000 })
    const assertion = expect(promise).rejects.toMatchObject({ code: 'timeout' })
    vi.advanceTimersByTime(2000)
    await assertion
  })

  it('без связи ждёт в очереди и уходит после welcome', async () => {
    const { client } = setup()
    client.start()
    const promise = client.request('presence.focus', { orderId: 'o1' })
    expect(client.getSnapshot().pending).toBe(1)

    FakeSocket.last.open()
    expect(FakeSocket.last.framesOf('req')).toHaveLength(0) // до welcome — только hello
    FakeSocket.last.receive(welcome())
    const req = FakeSocket.last.framesOf('req')[0]!
    FakeSocket.last.receive({ t: 'ack', id: req.id, ok: true, result: { ok: true } })
    await expect(promise).resolves.toEqual({ ok: true })
  })

  it('обрыв после отправки: обычный запрос отклоняется — неизвестно, выполнен ли он', async () => {
    const { client } = setup()
    const socket = connect(client)
    const promise = client.request('presence.focus', { orderId: 'o1' })
    const assertion = expect(promise).rejects.toMatchObject({ code: 'disconnected' })
    socket.drop()
    await assertion
  })

  it('обрыв после отправки: идемпотентный запрос отправляется снова с тем же id', async () => {
    const { client } = setup()
    const socket = connect(client)
    const promise = client.request('note.add', { orderId: 'o1', text: 'привет', clientId: 'c1' }, { retry: true })
    const first = socket.framesOf('req')[0]!

    const next = reconnect()
    next.receive(welcome())
    const second = next.framesOf('req')[0]!
    expect(second).toEqual(first)

    next.receive({ t: 'ack', id: second.id, ok: true, result: { note: { id: 'n1' } } })
    await expect(promise).resolves.toEqual({ note: { id: 'n1' } })
  })
})

describe('состояние для интерфейса', () => {
  it('снимок не меняется по ссылке, пока ничего не изменилось', () => {
    const { client } = setup()
    const socket = connect(client)
    const before = client.getSnapshot()
    socket.receive(event(null, 'metrics', 'metrics.tick'))
    expect(client.getSnapshot()).toBe(before)
  })

  it('оповещает подписчиков об изменении статуса', () => {
    const { client } = setup()
    const listener = vi.fn()
    client.subscribeState(listener)
    connect(client)
    expect(listener).toHaveBeenCalled()
    expect(client.getSnapshot().status).toBe('online')
  })

  it('считает переподключения', () => {
    const { client } = setup()
    connect(client)
    reconnect().receive(welcome())
    expect(client.getSnapshot()).toMatchObject({ status: 'online', reconnects: 1, attempt: 0 })
  })

  it('ведёт журнал кадров ограниченной длины', () => {
    const { client } = setup({ logSize: 5 })
    const socket = connect(client)
    for (let i = 0; i < 20; i++) socket.receive(event(null, 'metrics', 'metrics.tick'))
    expect(client.getFrames()).toHaveLength(5)
    expect(client.getFrames().at(-1)).toMatchObject({ dir: 'in', kind: 'metrics.tick' })
  })
})
