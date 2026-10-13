import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CLOSE, SERVER_IDLE_TIMEOUT, type ServerFrame } from '../shared/protocol'
import type { User } from '../shared/types'
import { Hub, HubError, type Connection } from './hub'

const ANNA: User = { id: 'u1', name: 'Анна', email: 'a@a', role: 'manager', hue: 10 }
const BORIS: User = { id: 'u2', name: 'Борис', email: 'b@b', role: 'viewer', hue: 20 }

/** Соединение-заглушка: запоминает всё, что хаб отправил. */
function fakeConn() {
  const frames: ServerFrame[] = []
  const conn: Connection & { frames: ServerFrame[]; closed: { code: number; reason: string } | null; of: <T extends ServerFrame['t']>(t: T) => Extract<ServerFrame, { t: T }>[] } =
    {
      frames,
      closed: null,
      send: (data) => frames.push(JSON.parse(data)),
      close(code, reason) {
        conn.closed = { code, reason }
      },
      of: (t) => frames.filter((f) => f.t === t) as never,
    }
  return conn
}

let time = 1_000_000

function setup(bufferSize = 500) {
  const hub = new Hub({
    now: () => time,
    authenticate: (token) => (token === 'anna' ? ANNA : token === 'boris' ? BORIS : null),
    bufferSize,
    handlers: {
      'note.add': ({ orderId, text }, user) => {
        if (user.role === 'viewer') throw new HubError('forbidden', 'Нельзя')
        return { note: { id: 'n1', orderId, text, authorId: user.id, authorName: user.name, hue: user.hue, at: '' } }
      },
    },
    snapshot: (channel) => (channel === 'metrics' ? { type: 'metrics.tick', data: { online: 7, carts: 1, ordersToday: 0, revenueToday: 0 } } : null),
  })
  /** Подключить клиента и поздороваться. */
  const join = (token = 'anna', channels: string[] = [], resume: { epoch: string; seq: number } | null = null) => {
    const conn = fakeConn()
    hub.connect(conn)
    hub.receive(conn, JSON.stringify({ t: 'hello', v: 1, token, channels, resume }))
    return conn
  }
  const say = (conn: Connection, frame: unknown) => hub.receive(conn, JSON.stringify(frame))
  return { hub, join, say }
}

beforeEach(() => {
  vi.useFakeTimers()
  time = 1_000_000
})
afterEach(() => vi.useRealTimers())

describe('рукопожатие', () => {
  it('отвечает welcome с эпохой и текущим номером', () => {
    const { hub, join } = setup()
    hub.publish('orders', 'order.updated', { id: 'o1', status: 'paid', version: 2, updatedAt: '', by: '' })
    const conn = join('anna')
    expect(conn.frames[0]).toMatchObject({ t: 'welcome', user: ANNA, epoch: hub.epoch, seq: 1, resumed: true })
  })

  it('закрывает соединение с неверным токеном', () => {
    const { join } = setup()
    expect(join('чужой').closed).toEqual({ code: CLOSE.unauthorized, reason: 'unauthorized' })
  })

  it('закрывает соединение с неподдерживаемой версией протокола', () => {
    const { hub } = setup()
    const conn = fakeConn()
    hub.connect(conn)
    hub.receive(conn, JSON.stringify({ t: 'hello', v: 99, token: 'anna', channels: [], resume: null }))
    expect(conn.closed?.code).toBe(CLOSE.unsupported)
  })

  it('закрывает соединение, которое не поздоровалось вовремя', () => {
    const { hub } = setup()
    const conn = fakeConn()
    hub.connect(conn)
    vi.advanceTimersByTime(5000)
    expect(conn.closed?.code).toBe(CLOSE.helloTimeout)
  })

  it('до hello ничего не выполняет', () => {
    const { hub, say } = setup()
    const conn = fakeConn()
    hub.connect(conn)
    say(conn, { t: 'sub', id: '1', channel: 'orders' })
    expect(conn.frames[0]).toMatchObject({ t: 'error', code: 'no_hello' })
  })

  it('на мусор отвечает ошибкой, а не падает', () => {
    const { hub, join } = setup()
    const conn = join()
    hub.receive(conn, 'не json')
    hub.receive(conn, JSON.stringify({ t: 'взлом' }))
    expect(conn.of('error')).toHaveLength(2)
  })
})

describe('каналы', () => {
  it('событие получают только подписчики канала', () => {
    const { hub, join } = setup()
    const anna = join('anna', ['orders'])
    const boris = join('boris', ['metrics'])
    hub.publish('orders', 'order.updated', { id: 'o1', status: 'paid', version: 2, updatedAt: '', by: '' })

    expect(anna.of('event').filter((e) => e.channel === 'orders')).toHaveLength(1)
    expect(boris.of('event').filter((e) => e.channel === 'orders')).toHaveLength(0)
  })

  it('sub и unsub подтверждаются и действуют', () => {
    const { hub, join, say } = setup()
    const conn = join()
    say(conn, { t: 'sub', id: 'a', channel: 'orders' })
    expect(conn.of('ack')[0]).toMatchObject({ id: 'a', ok: true })

    hub.publish('orders', 'order.updated', { id: 'o1', status: 'paid', version: 2, updatedAt: '', by: '' })
    say(conn, { t: 'unsub', id: 'b', channel: 'orders' })
    hub.publish('orders', 'order.updated', { id: 'o1', status: 'packing', version: 3, updatedAt: '', by: '' })
    expect(conn.of('event')).toHaveLength(1)
  })

  it('новому подписчику сразу приходит текущее состояние канала', () => {
    const { join, say } = setup()
    const conn = join()
    say(conn, { t: 'sub', id: 'a', channel: 'metrics' })
    expect(conn.of('event')[0]).toMatchObject({ channel: 'metrics', type: 'metrics.tick', seq: null, data: { online: 7 } })
  })

  it('факты нумеруются подряд, состояния — без номера', () => {
    const { hub, join } = setup()
    const conn = join('anna', ['orders', 'metrics'])
    hub.publish('orders', 'order.updated', { id: 'o1', status: 'paid', version: 2, updatedAt: '', by: '' })
    hub.publish('metrics', 'metrics.tick', { online: 1, carts: 1, ordersToday: 1, revenueToday: 1 })
    hub.publish('orders', 'order.updated', { id: 'o2', status: 'paid', version: 2, updatedAt: '', by: '' })

    expect(
      conn
        .of('event')
        .slice(1)
        .map((e) => e.seq),
    ).toEqual([1, null, 2])
  })
})

describe('досылка пропущенного', () => {
  const update = (id: string) => ({ id, status: 'paid' as const, version: 2, updatedAt: '', by: '' })

  it('досылает события после закладки — только по каналам клиента', () => {
    const { hub, join } = setup()
    hub.publish('orders', 'order.updated', update('o1')) // 1
    hub.publish('products', 'product.stock', { id: 'p1', stock: 3 }) // 2
    hub.publish('orders', 'order.updated', update('o2')) // 3
    hub.publish('orders', 'order.updated', update('o3')) // 4

    const conn = join('anna', ['orders'], { epoch: hub.epoch, seq: 1 })
    expect(conn.frames[0]).toMatchObject({ t: 'welcome', resumed: true })
    expect(conn.of('event').map((e) => e.seq)).toEqual([3, 4])
  })

  it('если пропущенное вытеснено из буфера — честно говорит resumed: false', () => {
    const { hub, join } = setup(3)
    for (let i = 1; i <= 10; i++) hub.publish('orders', 'order.updated', update(`o${i}`))

    const conn = join('anna', ['orders'], { epoch: hub.epoch, seq: 2 })
    expect(conn.frames[0]).toMatchObject({ t: 'welcome', resumed: false, seq: 10 })
    expect(conn.of('event')).toHaveLength(0)
  })

  it('граница буфера: закладка ровно перед самым старым событием — досылка возможна', () => {
    const { hub, join } = setup(3)
    for (let i = 1; i <= 10; i++) hub.publish('orders', 'order.updated', update(`o${i}`))
    // В буфере 8, 9, 10. Клиент видел 7 — ничего не потеряно.
    const conn = join('anna', ['orders'], { epoch: hub.epoch, seq: 7 })
    expect(conn.frames[0]).toMatchObject({ resumed: true })
    expect(conn.of('event').map((e) => e.seq)).toEqual([8, 9, 10])
  })

  it('закладка от другого запуска сервера (эпохи) не принимается', () => {
    const { hub, join } = setup()
    hub.publish('orders', 'order.updated', update('o1'))
    const conn = join('anna', ['orders'], { epoch: 'старая', seq: 1 })
    expect(conn.frames[0]).toMatchObject({ resumed: false })
  })

  it('клиент ничего не пропустил — resumed: true и пусто', () => {
    const { hub, join } = setup()
    hub.publish('orders', 'order.updated', update('o1'))
    const conn = join('anna', ['orders'], { epoch: hub.epoch, seq: 1 })
    expect(conn.frames[0]).toMatchObject({ resumed: true })
    expect(conn.of('event')).toHaveLength(0)
  })
})

describe('запросы', () => {
  it('выполняет запрос и отвечает ack с результатом', () => {
    const { join, say } = setup()
    const conn = join('anna')
    say(conn, { t: 'req', id: 'r1', method: 'note.add', params: { orderId: 'o1', text: ' привет ', clientId: 'c1' } })
    expect(conn.of('ack')[0]).toMatchObject({ id: 'r1', ok: true, result: { note: { text: 'привет', authorName: 'Анна' } } })
  })

  it('проверяет параметры', () => {
    const { join, say } = setup()
    const conn = join('anna')
    say(conn, { t: 'req', id: 'r1', method: 'note.add', params: { orderId: 'o1', text: '   ', clientId: 'c1' } })
    expect(conn.of('ack')[0]).toMatchObject({ ok: false, error: { code: 'bad_params', message: 'Пустая заметка' } })
  })

  it('возвращает ошибку обработчика с её кодом', () => {
    const { join, say } = setup()
    const conn = join('boris')
    say(conn, { t: 'req', id: 'r1', method: 'note.add', params: { orderId: 'o1', text: 'x', clientId: 'c1' } })
    expect(conn.of('ack')[0]).toMatchObject({ ok: false, error: { code: 'forbidden' } })
  })

  it('неизвестный метод — ошибка, а не падение', () => {
    const { join, say } = setup()
    const conn = join('anna')
    say(conn, { t: 'req', id: 'r1', method: 'drop.database', params: {} })
    expect(conn.of('ack')[0]).toMatchObject({ ok: false, error: { code: 'unknown_method' } })
  })

  it('отвечает на ping и сообщает текущий номер события', () => {
    const { hub, join, say } = setup()
    const conn = join('anna')
    hub.publish('orders', 'order.updated', { id: 'o1', status: 'paid', version: 2, updatedAt: '', by: '' })
    say(conn, { t: 'ping', ts: 123 })
    expect(conn.of('pong')[0]).toEqual({ t: 'pong', ts: 123, seq: 1 })
  })
})

describe('присутствие', () => {
  const focus = (orderId: string | null) => ({ t: 'req', id: 'f', method: 'presence.focus', params: { orderId } })
  const lastPresence = (conn: ReturnType<typeof fakeConn>) =>
    (
      conn
        .of('event')
        .filter((e) => e.type === 'presence')
        .at(-1)!.data as { users: { name: string }[] }
    ).users.map((u) => u.name)

  it('показывает, кто смотрит заказ, и убирает ушедших', () => {
    const { hub, join, say } = setup()
    const anna = join('anna', ['order:o1'])
    const boris = join('boris', ['order:o1'])

    say(anna, focus('o1'))
    say(boris, focus('o1'))
    expect(lastPresence(anna)).toEqual(['Анна', 'Борис'])

    hub.disconnect(boris) // закрыл вкладку
    expect(lastPresence(anna)).toEqual(['Анна'])
  })

  it('один человек в двух вкладках считается один раз', () => {
    const { join, say } = setup()
    const first = join('anna', ['order:o1'])
    const second = join('anna', ['order:o1'])
    say(first, focus('o1'))
    say(second, focus('o1'))
    expect(lastPresence(first)).toEqual(['Анна'])
  })

  it('переход к другому заказу убирает из прежнего', () => {
    const { join, say } = setup()
    const watcher = join('boris', ['order:o1'])
    const anna = join('anna')
    say(anna, focus('o1'))
    say(anna, focus('o2'))
    expect(lastPresence(watcher)).toEqual([])
  })

  it('присутствие — состояние: приходит при подписке и не нумеруется', () => {
    const { join, say } = setup()
    const anna = join('anna')
    say(anna, focus('o1'))
    const late = join('boris', ['order:o1'])
    expect(late.of('event')[0]).toMatchObject({ type: 'presence', seq: null, data: { users: [{ name: 'Анна' }] } })
  })
})

describe('уборка', () => {
  it('закрывает молчащие соединения и не трогает живые', () => {
    const { hub, join, say } = setup()
    const silent = join('anna')
    const alive = join('boris')

    time += SERVER_IDLE_TIMEOUT - 1000
    say(alive, { t: 'ping', ts: 1 })
    time += 2000
    hub.sweep()

    expect(silent.closed?.code).toBe(CLOSE.idle)
    expect(alive.closed).toBeNull()
  })

  it('closeAll закрывает всех кодом «перезапуск»', () => {
    const { hub, join } = setup()
    const conn = join()
    hub.closeAll()
    expect(conn.closed?.code).toBe(CLOSE.restart)
  })
})
