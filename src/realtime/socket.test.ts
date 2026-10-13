import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeSocket, asWebSocket } from '@/test/fake-socket'

import { ReconnectingSocket, type CloseInfo, type TransportState } from './socket'

const created: ReconnectingSocket[] = []

function setup(overrides: Partial<ConstructorParameters<typeof ReconnectingSocket>[0]> = {}) {
  const states: TransportState[] = []
  const messages: string[] = []
  const closes: CloseInfo[] = []
  const onOpen = vi.fn()
  const socket = new ReconnectingSocket({
    url: 'ws://test/ws',
    WebSocket: asWebSocket,
    random: () => 0.999999, // пауза = верхняя граница: 500, 1000, 2000…
    onOpen,
    onMessage: (data) => messages.push(data),
    onClose: (info) => closes.push(info),
    onState: (state) => states.push(state),
    ...overrides,
  })
  created.push(socket)
  return { socket, states, messages, closes, onOpen }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.reset()
})
afterEach(() => {
  // Иначе обработчики online/visibilitychange прошлых тестов остались бы висеть на document.
  for (const socket of created.splice(0)) socket.stop()
  vi.useRealTimers()
})

describe('ReconnectingSocket', () => {
  it('подключается и передаёт сообщения', () => {
    const { socket, states, messages, onOpen } = setup()
    socket.start()
    expect(states).toEqual(['connecting'])

    FakeSocket.last.open()
    expect(states).toEqual(['connecting', 'open'])
    expect(onOpen).toHaveBeenCalledOnce()

    FakeSocket.last.receive('привет')
    expect(messages).toEqual(['привет'])
    expect(socket.send('{"t":"ping"}')).toBe(true)
  })

  it('не отправляет, пока соединения нет', () => {
    const { socket } = setup()
    socket.start()
    expect(socket.send('{}')).toBe(false)
  })

  it('переподключается после обрыва с растущей паузой', () => {
    const { socket, states } = setup()
    socket.start()
    FakeSocket.last.open()

    FakeSocket.last.drop()
    expect(states.at(-1)).toBe('waiting')
    expect(FakeSocket.instances).toHaveLength(1)

    vi.advanceTimersByTime(499)
    expect(FakeSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.instances).toHaveLength(2) // первая пауза — 500 мс

    FakeSocket.last.drop() // не удалось подключиться
    vi.advanceTimersByTime(999)
    expect(FakeSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.instances).toHaveLength(3) // вторая — 1000 мс

    FakeSocket.last.drop()
    vi.advanceTimersByTime(2000)
    expect(FakeSocket.instances).toHaveLength(4) // третья — 2000 мс
  })

  it('открытие соединения само по себе не сбрасывает паузу — только markStable', () => {
    const { socket } = setup()
    socket.start()
    FakeSocket.last.open()
    FakeSocket.last.drop()
    vi.advanceTimersByTime(500)

    // Сервер принимает соединение и тут же закрывает: пауза должна расти.
    FakeSocket.last.open()
    FakeSocket.last.drop()
    expect(socket.attempt).toBe(2)

    vi.advanceTimersByTime(1000)
    FakeSocket.last.open()
    socket.markStable()
    FakeSocket.last.drop()
    expect(socket.attempt).toBe(1) // после «стабильно» отсчёт начался заново
  })

  it('сообщает, было ли соединение открыто', () => {
    const { socket, closes } = setup()
    socket.start()
    FakeSocket.last.drop(1006)
    expect(closes[0]).toMatchObject({ code: 1006, wasOpen: false, willRetry: true })

    vi.advanceTimersByTime(500)
    FakeSocket.last.open()
    FakeSocket.last.drop(4000, 'restart')
    expect(closes[1]).toMatchObject({ code: 4000, reason: 'restart', wasOpen: true })
  })

  it('не переподключается, если код закрытия запрещает', () => {
    const { socket, states, closes } = setup({ shouldReconnect: (code) => code !== 4401 })
    socket.start()
    FakeSocket.last.open()
    FakeSocket.last.drop(4401)

    expect(closes[0]!.willRetry).toBe(false)
    expect(states.at(-1)).toBe('stopped')
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('stop() закрывает соединение и отменяет повторы', () => {
    const { socket, states, closes } = setup()
    socket.start()
    FakeSocket.last.open()
    const first = FakeSocket.last
    socket.stop()

    expect(first.closedWith).toEqual({ code: 1000, reason: 'client stop' })
    expect(states.at(-1)).toBe('stopped')
    expect(closes).toHaveLength(0) // сами закрыли — onClose не зовём
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('обрывает зависшее подключение по таймауту', () => {
    const { socket, closes } = setup({ connectTimeout: 3000 })
    socket.start()
    vi.advanceTimersByTime(3000)

    expect(FakeSocket.instances[0]!.closedWith?.reason).toBe('connect timeout')
    expect(closes[0]).toMatchObject({ wasOpen: false })
    expect(socket.state).toBe('waiting')
  })

  it('reconnect() закрывает текущее соединение и открывает новое после паузы', () => {
    const { socket, messages } = setup()
    socket.start()
    FakeSocket.last.open()
    const first = FakeSocket.last

    socket.reconnect('pong timeout')
    expect(first.closedWith).toEqual({ code: 4999, reason: 'pong timeout' })
    // Старый сокет отвязан: его запоздалые сообщения нас не интересуют.
    first.receive('поздно')
    expect(messages).toEqual([])

    vi.advanceTimersByTime(500)
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('без сети не тратит попытки и подключается, когда сеть вернулась', () => {
    const { socket, states } = setup()
    socket.start()
    FakeSocket.last.open()

    socket.setOffline(true)
    expect(states.at(-1)).toBe('offline')
    vi.advanceTimersByTime(120_000)
    expect(FakeSocket.instances).toHaveLength(1)

    socket.setOffline(false)
    expect(FakeSocket.instances).toHaveLength(2)
    expect(states.at(-1)).toBe('connecting')
  })

  it('когда вкладку снова открыли — подключается сразу, не дожидаясь паузы', () => {
    const { socket } = setup()
    socket.start()
    FakeSocket.last.drop()
    expect(socket.state).toBe('waiting')

    document.dispatchEvent(new Event('visibilitychange')) // в jsdom вкладка всегда видима
    expect(FakeSocket.instances).toHaveLength(2)
  })
})
