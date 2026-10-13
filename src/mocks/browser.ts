/**
 * Сервер внутри браузера (Mock Service Worker).
 *
 * На GitHub Pages нет бэкенда — только статические файлы. MSW перехватывает
 * запросы приложения и отвечает сам:
 *   - HTTP — через Service Worker: приложение делает обычный fetch, запрос
 *     виден в DevTools → Network, а ответ приходит от обработчика ниже;
 *   - WebSocket — подменой класса WebSocket: приложение пишет `new WebSocket(url)`
 *     и работает с ним как с настоящим.
 *
 * Код приложения о подмене не знает: тот же fetch, тот же WebSocket. Чтобы
 * перейти на настоящий сервер, достаточно не запускать этот файл.
 *
 * Вся логика — в src/backend (общая с Node-сервером). Здесь только переходники.
 */
import { HttpResponse, delay, http } from 'msw'
import { setupWorker } from 'msw/browser'
import { ws } from 'msw/ws'

import { createBackend } from '@/backend'
import type { Snapshot } from '@/backend/db'
import type { Connection } from '@/backend/hub'
import { dayKey } from '@/backend/seed'
import { API_URL, WS_URL } from '@/config'

// ─── Сохранение между перезагрузками ───────────────────────────────────────────

/**
 * sessionStorage — хранилище ОДНОЙ вкладки: переживает перезагрузку, но не
 * закрытие вкладки. Для демо в самый раз: созданный товар не пропадает по F5,
 * а новая вкладка начинает с чистых данных. Ключ содержит дату — на следующий
 * день демо пересоздаётся (данные строятся от «сегодня»).
 */
const STORAGE_KEY = `prilavok:db:${dayKey(Date.now())}`

function loadSnapshot(): Snapshot | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Snapshot) : null
  } catch {
    return null
  }
}

const backend = createBackend({ snapshot: loadSnapshot() })

function save() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(backend.db.snapshot()))
  } catch {
    // Хранилище переполнено или недоступно (приватный режим) — демо работает и без него.
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
backend.db.onChange = () => {
  // Изменений много (симулятор), а запись в хранилище синхронная и небыстрая — копим и пишем не чаще раза в полсекунды.
  saveTimer ??= setTimeout(() => {
    saveTimer = null
    save()
  }, 500)
}
// Страницу закрывают или перезагружают — дописываем то, что ещё не успели.
let resetting = false
window.addEventListener('pagehide', () => {
  if (saveTimer && !resetting) save()
})

// ─── HTTP ──────────────────────────────────────────────────────────────────────

const apiPath = new URL(API_URL).pathname

const handlers = [
  http.all(`${API_URL}/*`, async ({ request }) => {
    const url = new URL(request.url)
    const hasBody = request.method !== 'GET' && request.method !== 'DELETE'
    const body = hasBody ? await request.json().catch(() => null) : null

    // Настоящий сервер отвечает не мгновенно. Без задержки не видно состояний загрузки,
    // а оптимистичные обновления неотличимы от обычных.
    await delay(120 + Math.random() * 230)

    const response = backend.handle({
      method: request.method,
      path: url.pathname.slice(apiPath.length),
      query: url.searchParams,
      body,
      authorization: request.headers.get('Authorization'),
    })
    return response.status === 204 ? new HttpResponse(null, { status: 204 }) : HttpResponse.json(response.body as never, { status: response.status })
  }),
]

// ─── WebSocket ─────────────────────────────────────────────────────────────────

const socket = ws.link(WS_URL)

const wsHandlers = [
  socket.addEventListener('connection', ({ client }) => {
    const conn: Connection = {
      send: (data) => client.send(data),
      close: (code, reason) => {
        client.close(code, reason)
        backend.hub.disconnect(conn)
      },
    }
    backend.hub.connect(conn)
    client.addEventListener('message', (event) => backend.hub.receive(conn, event.data))
    client.addEventListener('close', () => backend.hub.disconnect(conn))
  }),
]

// ─── Запуск ────────────────────────────────────────────────────────────────────

export async function startMockServer() {
  const worker = setupWorker(...handlers, ...wsHandlers)
  await worker.start({
    // Файл воркера лежит рядом с сайтом; на GitHub Pages это подпапка.
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    // Картинки, шрифты, сам сайт — не наше дело: пропускаем молча.
    onUnhandledFrame: 'bypass',
    quiet: true,
  })
  backend.simulator.start()
}

/** Рычаги для экрана «Соединение» — доступны только в мок-режиме. */
export const mockControls = {
  /** Создать заказ прямо сейчас, не дожидаясь симулятора. */
  newOrder: () => backend.simulator.newOrder(),
  /** «Перезапустить сервер»: все отключены, эпоха новая — клиенту придётся делать resync. */
  restartServer: () => backend.hub.restart(),
  /** Вернуть демо-данные к исходным. */
  resetData: () => {
    resetting = true
    backend.db.onChange = null
    sessionStorage.removeItem(STORAGE_KEY)
    location.reload()
  },
  info: () => backend.hub.info,
}
