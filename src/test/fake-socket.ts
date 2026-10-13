/**
 * Поддельный WebSocket для тестов.
 *
 * Настоящая сеть в тестах не нужна: медленно и нестабильно. Вместо неё —
 * класс с тем же интерфейсом, которым тест управляет вручную:
 * «соединение открылось», «сервер прислал кадр», «связь оборвалась».
 * Клиент не видит разницы, потому что получает класс через параметр
 * (options.WebSocket), а не берёт глобальный.
 */
export class FakeSocket {
  static instances: FakeSocket[] = []
  static get last() {
    return FakeSocket.instances[FakeSocket.instances.length - 1]!
  }
  static reset() {
    FakeSocket.instances = []
  }

  url: string
  readyState = 0
  /** Всё, что клиент отправил, уже разобранное из JSON. */
  sent: Record<string, unknown>[] = []
  closedWith: { code?: number; reason?: string } | null = null

  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(JSON.parse(data))
  }

  close(code?: number, reason?: string) {
    this.readyState = 3
    this.closedWith = { code, reason }
  }

  // ─── Управление из теста ─────────────────────────────────────────────────────

  /** Соединение установлено. */
  open() {
    this.readyState = 1
    this.onopen?.()
  }

  /** Сервер прислал кадр. */
  receive(frame: unknown) {
    this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) })
  }

  /** Соединение закрылось (сервером или сетью). */
  drop(code = 1006, reason = '') {
    this.readyState = 3
    this.onclose?.({ code, reason })
  }

  /** Кадры одного вида, отправленные клиентом. */
  framesOf(t: string) {
    return this.sent.filter((frame) => frame.t === t)
  }
}

export const asWebSocket = FakeSocket as unknown as typeof WebSocket
