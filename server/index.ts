/**
 * Настоящий сервер: HTTP + WebSocket на Node.js.
 *
 *   npm run server          → http://localhost:8787
 *   npm run dev:real        → интерфейс, подключённый к этому серверу
 *
 * В демо на GitHub Pages сервера нет — его изображает MSW прямо в браузере.
 * Этот файл показывает, как то же самое выглядит по-настоящему. Логика общая
 * (src/backend): здесь только «проводка» — превратить HTTP-запрос и сокет
 * библиотеки ws в вызовы handle() и hub.
 *
 * Чем настоящий сервер отличается от мока на практике:
 *   - данные общие для всех вкладок и браузеров: откройте два окна, смените
 *     статус заказа в одном — второе обновится через сокет;
 *   - кадры видны в DevTools → Network → WS → Messages;
 *   - сервер можно остановить (Ctrl+C) и запустить снова — и посмотреть, как
 *     клиент переподключается и понимает, что «эпоха» сменилась.
 *
 * ─── Как WebSocket появляется из HTTP ───────────────────────────────────────
 * Соединение начинается обычным GET-запросом с заголовком `Upgrade: websocket`.
 * Сервер отвечает `101 Switching Protocols`, и с этого момента тот же
 * TCP-сокет используется как двусторонний канал. Поэтому WebSocket живёт на
 * том же порту, что и сайт, и проходит через те же прокси. Событие 'upgrade'
 * ниже — как раз этот момент.
 */
import { createServer } from 'node:http'

import { WebSocketServer } from 'ws'

import type { ApiRequest } from '../src/backend/api.ts'
import { createBackend } from '../src/backend/index.ts'
import type { Connection } from '../src/backend/hub.ts'
import { CLOSE } from '../src/shared/protocol.ts'

const PORT = Number(process.env.PORT ?? 8787)
/** Кому разрешено подключаться из браузера: страницы с этого же компьютера (dev-сервер Vite на любом порту). */
const isAllowedOrigin = (origin: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)

const backend = createBackend()
backend.simulator.start()

// ─── HTTP ──────────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

  // CORS: браузер не отдаст странице ответ с другого адреса, пока сервер явно не разрешит.
  const origin = req.headers.origin
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE')
  }
  if (req.method === 'OPTIONS') return res.writeHead(204).end()

  if (!url.pathname.startsWith('/api/')) return res.writeHead(404).end()

  // Тело запроса приходит кусками — собираем и разбираем как JSON.
  let body: unknown = null
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    try {
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: { code: 'bad_json', message: 'Тело запроса — не JSON' } }))
    }
  }

  const request: ApiRequest = {
    method: req.method ?? 'GET',
    path: url.pathname.slice(4),
    query: url.searchParams,
    body,
    authorization: req.headers.authorization ?? null,
  }
  const response = backend.handle(request)
  console.log(`${request.method} ${url.pathname}${url.search} → ${response.status}`)

  if (response.status === 204) return res.writeHead(204).end()
  res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(response.body))
})

// ─── WebSocket ─────────────────────────────────────────────────────────────────

// noServer: рукопожатие проводим сами в 'upgrade' — так можно проверить адрес и Origin ДО соединения.
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const origin = req.headers.origin
  // У WebSocket нет CORS: браузер подключится с любого сайта и пришлёт cookie.
  // Проверка Origin — единственная защита от чужой страницы.
  if (url.pathname !== '/ws' || (origin && !isAllowedOrigin(origin))) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    return socket.destroy()
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
})

wss.on('connection', (ws) => {
  // Переходник: сокет ws → интерфейс Connection, который понимает хаб.
  const conn: Connection = {
    send: (data) => {
      // Сокет мог закрыться между «решили отправить» и «отправляем».
      if (ws.readyState === ws.OPEN) ws.send(data)
    },
    close: (code, reason) => ws.close(code, reason),
  }
  backend.hub.connect(conn)
  console.log(`ws + подключение (всего ${backend.hub.info.connections})`)

  ws.on('message', (data, isBinary) => {
    // Протокол текстовый; двоичные кадры не ждём.
    if (!isBinary) backend.hub.receive(conn, data.toString('utf8'))
  })
  ws.on('close', (code) => {
    backend.hub.disconnect(conn)
    console.log(`ws − отключение, код ${code} (всего ${backend.hub.info.connections})`)
  })
  ws.on('error', (error) => console.warn('ws ошибка', error.message))
})

server.listen(PORT, () => {
  console.log(`Прилавок: сервер на http://localhost:${PORT}  (API: /api, WebSocket: /ws)`)
})

// Аккуратная остановка: предупреждаем клиентов кодом «перезапуск» — они переподключатся.
process.on('SIGINT', () => {
  backend.simulator.stop()
  backend.hub.closeAll(CLOSE.restart, 'server restart')
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 500)
})
