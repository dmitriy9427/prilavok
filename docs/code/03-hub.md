# 3. Хаб на сервере

[src/backend/hub.ts](../../src/backend/hub.ts) — ~320 строк. Глава — [06. Сервер](../06-server.md).

## Где это

Серверная половина сокета. Работает в двух местах: в демо — внутри браузера (MSW), в режиме
`npm run server` — в Node.

## Что делает

1. Рукопожатие: ждёт `hello`, проверяет версию и токен, отвечает `welcome`.
2. Подписки: помнит, кто на какой канал подписан, и рассылает события только им.
3. Нумерация и буфер: каждому факту — номер; последние 500 хранятся для досылки.
4. Запросы: проверяет параметры, выполняет `req`, отвечает `ack`.
5. Присутствие: кто какой заказ сейчас смотрит.
6. Уборка: закрывает соединения, которые давно молчат.

## Главный приём: хаб не знает про сеть

```ts
export interface Connection {
  send(data: string): void
  close(code: number, reason: string): void
}
```

Хабу дают объект с двумя методами и сообщают о трёх событиях: `connect(conn)`,
`receive(conn, raw)`, `disconnect(conn)`. Кто доставляет байты — не его дело:

```ts
// server/index.ts (Node, библиотека ws) — упрощённо
wss.on('connection', (ws) => {
  const conn = { send: (d) => ws.send(d), close: (c, r) => ws.close(c, r) }
  hub.connect(conn)
  ws.on('message', (data) => hub.receive(conn, String(data)))
  ws.on('close', () => hub.disconnect(conn))
})
```

В браузере то же делает MSW, в тестах — две функции-заглушки. Один код — три окружения.

## Код по частям

### Подключился: ждём `hello`

```ts
connect(conn: Connection) {
  const session = {
    id: `s${++this.counter}`,
    conn, user: null, channels: new Set(), lastSeen: this.options.now(), focus: null,
    helloTimer: setTimeout(() => conn.close(CLOSE.helloTimeout, 'hello timeout'), this.options.helloTimeout),
  }
  this.sessions.set(conn, session)
}
```

Подключился, но молчит 5 секунд — закрываем (4408). Это сбой или сканер портов; держать
соединение незачем.

`now` — функция из опций, а не `Date.now()`: в тестах время подменяется.

### Пришёл кадр

```ts
receive(conn: Connection, raw: unknown) {
  const session = this.sessions.get(conn)
  if (!session) return
  session.lastSeen = this.options.now()

  const frame = decode(clientFrame, raw)
  if (!frame) return this.send(session, { t: 'error', code: 'bad_frame', message: 'Кадр не распознан' })

  if (frame.t === 'hello') return this.hello(session, frame)
  if (!session.user) return this.send(session, { t: 'error', code: 'no_hello', message: 'Сначала hello' })

  switch (frame.t) {
    case 'ping': return this.send(session, { t: 'pong', ts: frame.ts, seq: this.seq })
    case 'sub':  this.subscribe(session, frame.channel); return this.send(session, { t: 'ack', id: frame.id, ok: true, result: null })
    case 'unsub': session.channels.delete(frame.channel); return this.send(session, { t: 'ack', … })
    case 'req':  return this.request(session, session.user, frame)
  }
}
```

- `lastSeen` обновляется на **любой** кадр — по нему работает уборка.
- Сервер проверяет кадр строго: клиенту доверять нельзя.
- До `hello` разрешён только `hello`.

### Рукопожатие и решение о досылке

```ts
private hello(session, frame) {
  if (frame.v !== PROTOCOL_VERSION) return session.conn.close(CLOSE.unsupported, …)
  const user = this.options.authenticate(frame.token)
  if (!user) return session.conn.close(CLOSE.unauthorized, 'unauthorized')

  session.user = user
  session.channels = new Set(frame.channels)

  const oldest = this.buffer[0]?.seq ?? this.seq + 1
  const resume = frame.resume
  const resumed = !resume || (resume.epoch === this.epoch && resume.seq <= this.seq && resume.seq >= oldest - 1)

  this.send(session, { t: 'welcome', sessionId: session.id, user, epoch: this.epoch, seq: this.seq, resumed, serverTime: this.options.now() })

  if (resume && resumed) {
    for (const event of this.buffer) {
      if (event.seq! > resume.seq && session.channels.has(event.channel)) this.send(session, event)
    }
  }
  for (const channel of session.channels) this.sendSnapshot(session, channel)
}
```

Условие `resumed` по частям:

| Проверка | Зачем |
| --- | --- |
| `!resume` | первое подключение — досылать нечего, «успех» |
| `resume.epoch === this.epoch` | клиент был на **этом** запуске сервера |
| `resume.seq <= this.seq` | закладка не из будущего (иначе — точно другой запуск) |
| `resume.seq >= oldest - 1` | всё после закладки ещё лежит в буфере |

`oldest` при пустом буфере — `this.seq + 1`: тогда условие сводится к «клиент видел последнее».

Порядок отправки важен: сначала `welcome`, потом досланные события, потом снимки состояний.
Клиент к приходу событий уже знает, что сессия открыта.

### Рассылка

```ts
publish(channel, type, data) {
  const fact = !EPHEMERAL.has(type)
  const frame = { t: 'event', seq: fact ? ++this.seq : null, channel, type, data, at: this.options.now() }
  if (fact) {
    this.buffer.push(frame)
    if (this.buffer.length > this.options.bufferSize) this.buffer.shift()
  }
  const text = encode(frame)
  for (const session of this.sessions.values()) {
    if (session.user && session.channels.has(channel)) session.conn.send(text)
  }
  return frame
}
```

- Номер и буфер — только у фактов. Состояния (`presence`, `metrics.tick`) уходят без номера.
- Буфер — кольцо на 500: новое в конец, старое из начала.
- **`encode` один раз** — для тысячи подписчиков одна сериализация.

### Запросы

```ts
private request(session, user, frame) {
  const fail = (code, message) => this.send(session, { t: 'ack', id: frame.id, ok: false, error: { code, message } })
  if (!(frame.method in requestParams)) return fail('unknown_method', …)
  const params = requestParams[method].safeParse(frame.params)
  if (!params.success) return fail('bad_params', params.error.issues[0]?.message ?? 'Неверные параметры')
  try {
    const result = method === 'presence.focus' ? this.focus(…) : this.options.handlers[method](params.data, user)
    this.send(session, { t: 'ack', id: frame.id, ok: true, result })
  } catch (error) {
    if (error instanceof HubError) return fail(error.code, error.message)
    console.error('[hub] ошибка запроса', frame.method, error)
    fail('internal', 'Внутренняя ошибка')
  }
}
```

- Неизвестный метод и неверные параметры — понятный `ack` с ошибкой, а не тишина.
- `HubError` — «ожидаемая» ошибка с текстом для человека (заказа нет, нет права). Всё остальное —
  «Внутренняя ошибка» клиенту и подробности в журнал сервера.

### Уборка

```ts
sweep() {
  const deadline = this.options.now() - SERVER_IDLE_TIMEOUT
  for (const session of [...this.sessions.values()]) {
    if (session.lastSeen < deadline) session.conn.close(CLOSE.idle, 'idle')
  }
}
```

Клиент шлёт ping раз в 15 с; молчит 45 с — его, скорее всего, нет (выключили Wi-Fi, уснул
ноутбук, а `close` до сервера не дошёл). Копия `[...]` — потому что `close` вызывает
`disconnect`, а тот удаляет сессию из того же `Map`.

## Что будет, если…

| Убрать | Что сломается |
| --- | --- |
| `helloTimer` | молчаливые соединения висят вечно и едят память |
| проверку эпохи | после перезапуска сервера клиент «досылает» чужие события по совпавшим номерам |
| `encode` до цикла | сериализация на каждого подписчика |
| проверку `session.user` | неавторизованный клиент подписывается и получает события |
| `sweep` | сессии пропавших клиентов копятся, им шлются события в пустоту |

## Проверьте себя

1. Клиент видел событие 120, сервер перезапустился и уже успел выдать 130 событий. Что ответит
   хаб на `hello` с закладкой 120?
2. Почему досылаются только события из каналов клиента?
3. Где хаб узнаёт, что пользователь закрыл вкладку?

<details>
<summary>Ответы</summary>

1. `resumed: false` — эпоха другая. Клиент перезапросит данные по HTTP.
2. На другие он не подписан и не должен их получать — ни сейчас, ни при досылке.
3. В `disconnect(conn)` — его вызывает транспорт при закрытии соединения. Если закрытие не дошло,
   сессию уберёт `sweep` по `lastSeen`.
</details>
