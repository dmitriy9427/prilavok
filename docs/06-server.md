# 06. Сервер

Файлы: `src/backend/hub.ts`, `server/index.ts`, `src/mocks/browser.ts`.

## Хаб не знает про сеть

`Hub` — серверная половина протокола. Ему нужен от транспорта минимум:

```ts
interface Connection {
  send(data: string): void
  close(code: number, reason: string): void
}
```

и три вызова: `hub.connect(conn)`, `hub.receive(conn, raw)`, `hub.disconnect(conn)`.

Поэтому один и тот же хаб работает в трёх местах:

| Где | Кто даёт `Connection` |
| --- | --- |
| Node | библиотека `ws` — `server/index.ts` |
| Браузер (демо) | MSW — `src/mocks/browser.ts` |
| Тесты | объект из двух функций — `hub.test.ts` |

Это приём «порты и адаптеры»: логика в центре, сеть — сменная деталь по краям. Тесты хаба
выполняются за миллисекунды, без единого сокета.

## Что хранит хаб

```ts
sessions: Map<Connection, Session>   // кто подключён
Session = { id, user, channels: Set<string>, lastSeen, focus, helloTimer }
seq: number                          // номер последнего факта
buffer: EventFrame[]                 // последние 500 фактов — для досылки
epoch: string                        // id запуска
```

## Рассылка

```ts
publish(channel, type, data) {
  const fact = !EPHEMERAL.has(type)
  const frame = { t: 'event', seq: fact ? ++this.seq : null, channel, type, data, at }
  if (fact) { buffer.push(frame); if (buffer.length > bufferSize) buffer.shift() }
  const text = encode(frame)                       // сериализуем ОДИН раз
  for (const session of sessions.values())
    if (session.user && session.channels.has(channel)) session.conn.send(text)
}
```

Кто вызывает `publish`:

- `api.ts` — после изменения данных по HTTP (сменили статус → `order.updated`);
- обработчики `req` — заметка добавлена → `note.added`;
- `simulator.ts` — «жизнь» магазина.

Порядок важен: **сначала изменить данные, потом публиковать**. Иначе клиент, получив
событие, пойдёт за подробностями и прочитает старое.

## Настоящий сервер на Node (`server/index.ts`)

```ts
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })

server.on('upgrade', (req, socket, head) => {
  if (url.pathname !== '/ws' || (origin && !isAllowedOrigin(origin))) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    return socket.destroy()
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
})

wss.on('connection', (ws) => {
  const conn = { send: (data) => ws.readyState === ws.OPEN && ws.send(data), close: (c, r) => ws.close(c, r) }
  hub.connect(conn)
  ws.on('message', (data, isBinary) => !isBinary && hub.receive(conn, data.toString('utf8')))
  ws.on('close', () => hub.disconnect(conn))
})
```

Что здесь про безопасность:

| Строка | От чего защищает |
| --- | --- |
| `noServer: true` + проверка в `upgrade` | отказать можно **до** установки соединения |
| проверка `Origin` | чужой сайт не подключится из браузера пользователя (CORS на WebSocket не действует) |
| `maxPayload: 64 КБ` | клиент не уронит сервер гигабайтным сообщением |
| `helloTimeout` в хабе | анонимные соединения не копятся |
| zod на каждом кадре | мусор не доходит до логики |
| `sweep()` | пропавшие клиенты не занимают память |
| проверка прав в обработчике `req` | сокет — такой же вход на сервер, как HTTP |

Чего в демо нет, а в настоящем сервисе нужно: ограничение частоты сообщений (rate limit) на
соединение, лимит соединений на пользователя, шифрование (`wss://` — обычно его делает
nginx или балансировщик перед Node).

Аккуратная остановка: по Ctrl+C сервер закрывает всех кодом 4000 «перезапуск» — клиенты
сразу понимают, что произошло, и переподключаются.

## Присутствие

«Кто сейчас смотрит заказ» хранится не в базе, а в сессиях: `session.focus = orderId`.

```
клиент: req presence.focus {orderId: 'o_15'}
хаб:    session.focus = 'o_15'
        publish('order:o_15', 'presence', { users: viewers('o_15') })
```

Три детали:

- **Привязка к соединению.** Закрыл вкладку без «прощания» — `disconnect()` убирает сессию
  и публикует новый список. Поэтому присутствие нельзя сделать на HTTP без heartbeat.
- **Один человек — один раз.** Две вкладки одного пользователя дают одну запись
  (`Map` по `user.id`).
- **Это состояние, а не факт**: без `seq`, не досылается, при подписке сразу приходит
  текущий список. После переподключения клиент сам заново сообщает `focus` (`usePresence`
  зависит от `sessionId`).

## Мок в браузере (`src/mocks/browser.ts`)

GitHub Pages отдаёт только файлы. Mock Service Worker подменяет сеть прямо в браузере:

```ts
// HTTP — через Service Worker: настоящий fetch, запрос виден в DevTools
http.all(`${API_URL}/*`, async ({ request }) => {
  await delay(120 + Math.random() * 230)                 // как у настоящей сети
  const response = backend.handle({ method, path, query, body, authorization })
  return HttpResponse.json(response.body, { status: response.status })
})

// WebSocket — подменой класса WebSocket
const socket = ws.link(WS_URL)
socket.addEventListener('connection', ({ client }) => {
  const conn = { send: (data) => client.send(data), close: … }
  backend.hub.connect(conn)
  client.addEventListener('message', (event) => backend.hub.receive(conn, event.data))
  client.addEventListener('close', () => backend.hub.disconnect(conn))
})
```

Сравните с `server/index.ts` — те же три вызова хаба. Приложение о подмене не знает: оно
пишет `fetch(url)` и `new WebSocket(url)`.

Задержка в HTTP-обработчике нужна не для красоты: без неё не видно состояний загрузки, а
оптимистичное обновление неотличимо от обычного.

Данные мока сохраняются в `sessionStorage` (хранилище одной вкладки): переживают F5, но
новая вкладка начинает с чистых.

## Симулятор

`simulator.ts` по таймерам создаёт заказы, двигает статусы, меняет «онлайн», а «коллеги»
заглядывают в открытый у вас заказ и изредка пишут заметку. Всё идёт через те же `db` и
`hub`, что и действия людей, — клиент не может отличить симулятор от пользователя. Это
хороший способ разрабатывать реальное время без второго человека.

## Что изменится при росте

В демо всё в памяти одного процесса. Так нельзя, когда серверов больше одного:

```
клиент А ──▶ сервер 1 ─┐
                       ├──▶ шина (Redis pub/sub, NATS, Kafka)
клиент Б ──▶ сервер 2 ─┘
```

| Что | В демо | В настоящем сервисе |
| --- | --- | --- |
| Рассылка | цикл по `sessions` | сервер публикует в шину; каждый сервер раздаёт своим клиентам |
| `seq` и буфер | переменные в памяти | поток с номерами в шине (Redis Streams, Kafka) — общий для всех серверов |
| Эпоха | меняется при перезапуске | не нужна, если нумерация общая и долговечная |
| Присутствие | `session.focus` | ключи с временем жизни в Redis |
| Идемпотентность | `Map` в памяти | таблица в базе с уникальным ключом |
| Балансировщик | нет | должен пропускать `Upgrade` и не рвать долгие соединения |
| Деплой | перезапуск | постепенный: по одному серверу, чтобы не переподключить всех разом |

Клиент при этом **не меняется**: протокол тот же. Поэтому и стоит выделять его в отдельный
файл.

Готовые серверы реального времени (Centrifugo, Soketi, Supabase Realtime, Ably) решают эти
задачи за вас — в продукте обычно берут их.

## Ошибки

> **Не проверять `Origin`.** Любой сайт может открыть сокет к вашему серверу.
>
> **Держать сессии мёртвых клиентов.** Выключили Wi-Fi — `close` серверу может не прийти. Без
> уборки по `lastSeen` сервер копит сессии и шлёт в пустоту.
>
> **Сериализовать кадр для каждого получателя.** 1 000 подписчиков — 1 000 вызовов
> `JSON.stringify` одного и того же. Один раз до цикла.
>
> **Доверять параметрам клиента.** Запрос можно отправить в обход интерфейса. Сервер проверяет
> каждый `req` своей схемой (`requestParams`).
>
> **Отдавать клиенту текст внутренней ошибки.** Там пути файлов и SQL. Клиенту — «Внутренняя
> ошибка», подробности — в журнал сервера.
>
> **Присутствие по пользователю, а не по сессии.** Один человек в двух вкладках закрыл одну —
> и пропал из списка смотрящих, хотя вторая открыта.

## Попробуйте сами

1. Клиент прислал `sub` до `hello`. Что ответит хаб?
2. Где в хабе проверялись бы права «может ли этот пользователь слушать канал `order:o_15`»?
   Допишите проверку для роли «наблюдатель».
3. Почему `sweep()` и `closeAll()` обходят копию `[...this.sessions.values()]`, а не сам `Map`?
4. Как хаб работает и в браузере, и в Node, если в браузере нет сокетов-серверов?

<details>
<summary>Ответы</summary>

1. `{ t: 'error', code: 'no_hello', message: 'Сначала hello' }`.
2. В `subscribe(session, channel)` — там уже стоит комментарий. Например:
   ```ts
   if (channel.startsWith('order:') && !can(session.user!.role, 'orders.read')) return
   ```
   (и ответить `ack` с `ok: false`, а не молча).
3. `close()` у соединения вызывает `disconnect()`, который **удаляет** сессию из `Map` прямо во
   время обхода. Обход копии от этого не сбивается.
4. Хаб не знает про сеть: ему дают объект `{ send, close }` и сообщают о событиях. В браузере этот
   объект делает MSW, в Node — библиотека `ws`, в тестах — две функции-заглушки.
</details>
