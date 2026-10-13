/**
 * Симулятор жизни магазина.
 *
 * Чтобы реальное время было видно в демо, кто-то должен покупать, а коллеги —
 * работать с заказами. Симулятор делает это по таймерам:
 *   - раз в 2 с — «живые» цифры (посетители, корзины);
 *   - раз в 9–22 с — новый заказ с сайта;
 *   - раз в 6–14 с — один из свежих заказов продвигается по статусам;
 *   - «коллеги» заглядывают в заказ, который открыт у пользователя, и
 *     изредка оставляют заметку.
 *
 * Всё идёт через те же db и hub, что и настоящие действия пользователей:
 * клиент не может отличить симулятор от живых людей.
 */
import { CHANNELS } from '../shared/protocol.ts'
import { STATUS_FLOW } from '../shared/schemas.ts'
import type { LiveMetrics, Notification, Order } from '../shared/types.ts'
import type { Db } from './db.ts'
import { toRow } from './db.ts'
import type { Hub } from './hub.ts'
import { createRng } from './rng.ts'
import { COLLEAGUES, NOTE_TEXTS, makeItems, sumItems } from './seed.ts'

export function createSimulator(db: Db, hub: Hub, now: () => number) {
  // Здесь зерно — текущее время: живая активность и должна быть разной.
  const rng = createRng(now())
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let running = false
  let online = rng.int(38, 64)
  let carts = rng.int(6, 14)

  /** Повторять fn со случайной паузой из [min, max] мс. */
  const loop = (min: number, max: number, fn: () => void) => {
    const schedule = () => {
      const timer = setTimeout(
        () => {
          timers.delete(timer)
          if (!running) return
          fn()
          schedule()
        },
        rng.int(min, max),
      )
      timers.add(timer)
    }
    schedule()
  }

  const metrics = (): LiveMetrics => {
    const today = db.today(now())
    return { online, carts, ordersToday: today.orders, revenueToday: today.revenue }
  }

  const notify = (notification: Omit<Notification, 'id' | 'at'>) => {
    const full: Notification = { ...notification, id: db.nextId('ntf'), at: new Date(now()).toISOString() }
    db.addNotification(full)
    hub.publish(CHANNELS.notifications, 'notification', { notification: full })
  }

  function tickMetrics() {
    // Случайное блуждание вокруг 50: число «дышит», а не скачет.
    online = Math.max(12, Math.min(140, online + rng.int(-4, 4) + (online < 40 ? 1 : online > 70 ? -1 : 0)))
    carts = Math.max(2, Math.min(40, carts + rng.int(-1, 1)))
    hub.publish(CHANNELS.metrics, 'metrics.tick', metrics())
  }

  function newOrder() {
    const customer = db.customers[rng.int(0, 2400)]!
    const items = makeItems(rng, db.products)
    if (!items.length) return
    const at = new Date(now()).toISOString()
    const number = ++db.lastOrderNumber
    const order: Order = {
      id: `o_${number}`,
      number: `П-${number}`,
      createdAt: at,
      updatedAt: at,
      version: 1,
      status: 'new',
      customerId: customer.id,
      customerName: customer.name,
      city: customer.city,
      delivery: rng.pick(['courier', 'courier', 'pickup', 'post'] as const),
      payment: rng.pick(['card', 'card', 'sbp', 'cash'] as const),
      items,
      total: sumItems(items),
      history: [{ at, status: 'new', by: 'Сайт' }],
    }
    db.addOrder(order)
    carts = Math.max(2, carts - 1)
    hub.publish(CHANNELS.orders, 'order.created', { order: toRow(order) })

    if (order.total >= 9000) {
      notify({ kind: 'order', title: `Крупный заказ ${order.number}`, body: `${order.customerName} · ${order.total.toLocaleString('ru-RU')} ₽`, link: `/orders/${order.id}` })
    }

    // Заказ уменьшает остатки; товар на исходе — уведомление.
    for (const item of items) {
      const product = db.product(item.productId)
      if (!product || product.variants.length) continue
      const before = product.stock
      product.stock = Math.max(0, product.stock - item.qty)
      if (product.stock === before) continue
      hub.publish(CHANNELS.products, 'product.stock', { id: product.id, stock: product.stock })
      if (before > 3 && product.stock <= 3) {
        notify({
          kind: 'stock',
          title: product.stock ? 'Товар заканчивается' : 'Товар закончился',
          body: `${product.title} — осталось ${product.stock} шт.`,
          link: `/products/${product.id}`,
        })
      }
    }
  }

  function advanceOrder() {
    // Берём один из последних незавершённых заказов и двигаем на шаг.
    const candidates = db.orders.slice(-40).filter((o) => STATUS_FLOW[o.status].length > 0)
    if (!candidates.length) return
    const order = rng.pick(candidates)
    const next = rng.chance(0.06) ? 'cancelled' : STATUS_FLOW[order.status][0]!
    if (!STATUS_FLOW[order.status].includes(next)) return
    const by = next === 'paid' ? 'Система' : rng.pick(COLLEAGUES).name
    db.setOrderStatus(order, next, by, now())
    hub.publish(CHANNELS.orders, 'order.updated', { id: order.id, status: next, version: order.version, updatedAt: order.updatedAt, by })
  }

  function colleagues() {
    for (const orderId of hub.focusedOrders()) {
      const bots = hub.viewers(orderId).filter((u) => COLLEAGUES.some((c) => c.id === u.id))
      if (bots.length && rng.chance(0.35)) {
        hub.setBots(orderId, bots.slice(1)) // коллега ушёл
      } else if (bots.length < 2 && rng.chance(0.4)) {
        const free = COLLEAGUES.filter((c) => !bots.some((b) => b.id === c.id))
        const joined = rng.pick(free)
        hub.setBots(orderId, [...bots, { id: joined.id, name: joined.name, hue: joined.hue }])
      } else if (bots.length && rng.chance(0.25)) {
        const author = COLLEAGUES.find((c) => c.id === bots[0]!.id)!
        const note = { id: db.nextId('n'), orderId, authorId: author.id, authorName: author.name, hue: author.hue, text: rng.pick(NOTE_TEXTS), at: new Date(now()).toISOString() }
        db.addNote(note)
        hub.publish(CHANNELS.order(orderId), 'note.added', { note, clientId: null })
      }
    }
  }

  return {
    metrics,
    start() {
      if (running) return
      running = true
      loop(2000, 2000, tickMetrics)
      loop(9000, 22_000, newOrder)
      loop(6000, 14_000, advanceOrder)
      loop(4000, 7000, colleagues)
      loop(15_000, 15_000, () => hub.sweep())
    },
    stop() {
      running = false
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    },
    /** Для кнопки «Создать заказ» на экране «Соединение» и для тестов. */
    newOrder,
    advanceOrder,
  }
}
