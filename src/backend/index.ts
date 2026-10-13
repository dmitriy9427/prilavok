/**
 * Сборка бэкенда: база + хаб + API + симулятор.
 *
 * Возвращает три точки входа, к которым подключается транспорт:
 *   handle(request)             — HTTP-запрос → ответ;
 *   hub.connect/receive/…       — события WebSocket;
 *   simulator.start()           — «жизнь» магазина.
 */
import { CHANNELS } from '../shared/protocol.ts'
import type { Note } from '../shared/types.ts'
import { can } from '../shared/permissions.ts'
import { createApi, userByToken } from './api.ts'
import { Db, type Snapshot } from './db.ts'
import { Hub, HubError } from './hub.ts'
import { createSimulator } from './simulator.ts'

export type BackendOptions = { now?: () => number; snapshot?: Snapshot | null }

export function createBackend({ now = Date.now, snapshot = null }: BackendOptions = {}) {
  const db = new Db(now(), snapshot)

  // Симулятор нужен хабу (снимок метрик), а хаб — симулятору: связываем через замыкание.
  let simulator: ReturnType<typeof createSimulator>

  // Идемпотентность: клиент после обрыва связи может прислать тот же запрос ещё раз
  // (он не знает, дошёл ли первый). По clientId сервер узнаёт повтор и возвращает
  // уже созданную заметку, а не создаёт вторую.
  const notesByClientId = new Map<string, Note>()

  const hub = new Hub({
    now,
    authenticate: userByToken,
    snapshot: (channel) => (channel === CHANNELS.metrics ? { type: 'metrics.tick', data: simulator.metrics() } : null),
    handlers: {
      'note.add': ({ orderId, text, clientId }, user) => {
        // Права проверяются и здесь: сокет — такой же вход на сервер, как HTTP.
        if (!can(user.role, 'orders.note')) throw new HubError('forbidden', 'Недостаточно прав, чтобы писать заметки')
        if (!db.order(orderId)) throw new HubError('not_found', 'Заказ не найден')
        const duplicate = notesByClientId.get(clientId)
        if (duplicate) return { note: duplicate }
        const note: Note = { id: db.nextId('n'), orderId, authorId: user.id, authorName: user.name, hue: user.hue, text, at: new Date(now()).toISOString() }
        db.addNote(note)
        notesByClientId.set(clientId, note)
        // Заметку получат все, кто смотрит заказ, — в том числе автор (по clientId он узнает свою).
        hub.publish(CHANNELS.order(orderId), 'note.added', { note, clientId })
        return { note }
      },
    },
  })

  simulator = createSimulator(db, hub, now)

  return { db, hub, simulator, handle: createApi(db, hub, now) }
}

export type Backend = ReturnType<typeof createBackend>
