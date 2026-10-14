# 1. Транспорт: сокет, который переподключается

[src/realtime/backoff.ts](../../src/realtime/backoff.ts), [src/realtime/socket.ts](../../src/realtime/socket.ts)

## Где это

На экране не видно. Видно последствие: связь пропала — через пару секунд вернулась сама, а в
шапке мелькнуло «Переподключение…».

## Что делает

- Держит «трубу» к серверу открытой: закрылась — откроет новую.
- Ждёт перед повтором всё дольше (0,5 → 1 → 2 → … → 30 с) и со случайным разбросом.
- Не тратит попытки, когда у устройства нет сети, и подключается сразу, когда сеть вернулась.
- Подключается сразу, когда человек вернулся на вкладку.
- Обрывает «зависшее» подключение через 10 секунд.
- Не переподключается после «фатальных» кодов (4401 — нет доступа).
- Ничего не знает о протоколе (hello, каналы) — только о соединении.

## Как пользоваться

```ts
const socket = new ReconnectingSocket({
  url: 'wss://shop.ru/ws',
  onOpen: () => socket.send('{"t":"hello",…}'),
  onMessage: (text) => console.log(text),
  onClose: ({ code, willRetry }) => console.log(code, willRetry),
  onState: (state) => console.log(state),        // connecting / open / waiting / offline…
  shouldReconnect: (code) => code !== 4401,
})
socket.start()
socket.send('…')     // false, если сейчас нет соединения
socket.stop()
```

## Пауза: `backoffDelay`

```ts
export function backoffDelay(attempt: number, options = DEFAULT_BACKOFF, random = Math.random) {
  const ceiling = Math.min(options.max, options.base * options.factor ** attempt)
  return Math.round(ceiling / 2 + random() * (ceiling / 2))
}
```

| `attempt` | потолок | пауза |
| --- | --- | --- |
| 0 | 500 мс | 250–500 мс |
| 1 | 1 с | 0,5–1 с |
| 3 | 4 с | 2–4 с |
| 6+ | 30 с (упёрлись в `max`) | 15–30 с |

- `factor ** attempt` — каждая попытка вдвое дольше. Короткий сбой чинится быстро, долгий не
  долбит сервер.
- Половина паузы фиксирована, половина случайна («equal jitter»). Пауза не бывает почти нулевой, а
  клиенты, отключённые одним деплоем, возвращаются вразнобой.
- `random` — параметр: в тестах подставляют `() => 0` и получают предсказуемое число.

## Состояния

```
idle ──start()──▶ connecting ──открылось──▶ open
                     ▲   │                    │
                     │   └── не вышло ──┐     │ закрылось
                     │                  ▼     ▼
                     └──── таймер ──── waiting
offline — нет сети                 stopped — остановлен (или фатальный код)
```

Всё поведение класса — это переходы между ними. Состояние меняется только в `setState`, который
сообщает о смене наружу (`onState`) и ничего не делает, если состояние то же.

## Код по частям

### Подключение

```ts
private connect() {
  this.clearTimers()
  if (this.isOffline) return this.setState('offline')

  this.setState('connecting')
  const Socket = this.options.WebSocket ?? WebSocket
  const url = typeof this.options.url === 'function' ? this.options.url() : this.options.url
```

- Нет сети — не пытаемся вовсе: попытка всё равно провалится, а пауза вырастет.
- `options.WebSocket` — подмена для тестов (класс-заглушка).
- `url` может быть функцией: адрес вычисляется в момент подключения.

```ts
  let socket: WebSocket
  try {
    socket = new Socket(url)
  } catch (error) {
    console.error('[socket] не удалось создать WebSocket', error)
    return this.setState('stopped')
  }
```

Конструктор бросает только при **неверном адресе** — это ошибка в коде, а не в сети. Повторять
бессмысленно: `stopped`.

```ts
  let opened = false
  socket.onopen = () => {
    opened = true
    if (this.connectTimer) clearTimeout(this.connectTimer)
    this.setState('open')
    this.options.onOpen()
  }
  socket.onmessage = (event) => {
    if (typeof event.data === 'string') this.options.onMessage(event.data)
  }
  socket.onclose = (event) => {
    this.socket = null
    this.handleClosed({ code: event.code, reason: event.reason, wasOpen: opened })
  }
  this.connectTimer = setTimeout(() => this.reconnect('connect timeout'), this.options.connectTimeout ?? 10_000)
}
```

- `opened` — чтобы при закрытии знать: соединение успело открыться или не удалось даже
  подключиться.
- Двоичные кадры (`Blob`) пропускаем — наш протокол текстовый.
- `onerror` не нужен: подробностей в нём нет, а следом всегда приходит `onclose`.
- **Таймаут подключения** — соединение бывает «зависшим» в `connecting`: ни открылось, ни
  закрылось. Через 10 с обрываем и пробуем снова.

### Закрытие и следующая попытка

```ts
private handleClosed({ code, reason, wasOpen }) {
  if (this.state === 'stopped') return
  this.clearTimers()
  const willRetry = this.options.shouldReconnect?.(code) ?? true
  this.options.onClose({ code, reason, wasOpen, willRetry })
  if (!willRetry) return this.setState('stopped')
  if (this.isOffline) return this.setState('offline')

  const delay = backoffDelay(this.attempt, this.backoff, this.options.random)
  this.attempt += 1
  this.retryAt = Date.now() + delay
  this.setState('waiting')
  this.retryTimer = setTimeout(() => this.connect(), delay)
}
```

- Остановили сами (`stop`) — ничего не делаем.
- Спрашиваем верхний слой «повторять ли?» (по коду). Клиент протокола отвечает «нет» на 4401 и
  4426.
- `retryAt` — **момент** следующей попытки, а не длительность: индикатор покажет «через 3 с» и
  будет честно убавлять.

### Ручной обрыв: `reconnect`

```ts
reconnect(reason = 'reconnect') {
  if (this.state === 'stopped' || this.state === 'idle') return
  if (this.state === 'waiting' || this.state === 'offline') return this.connect()
  const socket = this.detach()
  const wasOpen = this.state === 'open'
  socket?.close(CLIENT_ABORT, reason)
  this.handleClosed({ code: CLIENT_ABORT, reason, wasOpen })
}

private detach() {
  const socket = this.socket
  if (socket) socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
  this.socket = null
  return socket
}
```

Зовут его клиент протокола (нет `pong`, нет `welcome`) и кнопка «Подключиться сейчас».

**`detach` снимает обработчики до `close`.** Иначе старый сокет мог бы прислать `close`
**позже**, когда уже открылся новый, — и класс решил бы, что оборвался новый. Раз обработчики
сняты, о закрытии сообщаем сами — вызовом `handleClosed`.

### Когда сбрасывать счётчик попыток

```ts
markStable() {
  this.attempt = 0
}
```

Не при `open`! Сервер может принимать соединение и тут же закрывать (перегружен, токен не
подошёл) — тогда каждое «успешное» открытие обнуляло бы паузу, и клиент долбил бы сервер.
Стабильность объявляет протокол — после `welcome`.

### Подсказки браузера

```ts
private handleOnline = () => {
  if (this.forcedOffline) return
  if (this.state === 'offline' || this.state === 'waiting') {
    this.attempt = 0
    this.connect()
  }
}

private handleOffline = () => {
  if (this.state === 'stopped' || this.state === 'idle') return
  const wasOpen = this.state === 'open'
  const had = this.detach()
  had?.close(CLIENT_ABORT, 'offline')
  this.clearTimers()
  if (had) this.options.onClose({ code: CLIENT_ABORT, reason: 'offline', wasOpen, willRetry: true })
  this.setState('offline')
}

private handleVisibility = () => {
  if (globalThis.document?.visibilityState === 'visible' && this.state === 'waiting') {
    this.attempt = 0
    this.connect()
  }
}
```

- Обработчики — **стрелочные поля класса**: `this` привязан навсегда, и в `removeEventListener`
  уходит та же функция, что и в `addEventListener`.
- **`online`** — сеть вернулась: не ждём остаток 30-секундной паузы.
- **`offline`** — соединение всё равно мертво: закрываем сразу, а не ждём, пока это заметит
  heartbeat.
- **Вернулись на вкладку** — человеку нужны свежие данные сейчас.

## Что будет, если…

| Сделать | Что сломается |
| --- | --- |
| `attempt = 0` в `onopen` | сервер, закрывающий сразу после открытия, получает подключения без паузы |
| убрать `detach` в `reconnect` | запоздалый `close` старого сокета «закроет» новый — лишний цикл переподключения |
| убрать `connectTimer` | зависшее подключение висит минутами, статус «Подключение…» навсегда |
| убрать `shouldReconnect` | после «нет доступа» клиент бесконечно стучится с неверным токеном |
| `retryAt` → длительность | отсчёт «через N с» не убавлялся бы |

## Проверьте себя

1. Почему `onerror` не используется вовсе?
2. Что произойдёт при `reconnect()`, если сейчас идёт пауза перед повтором?
3. Почему обработчики `online`/`offline` — стрелочные поля, а не методы?

<details>
<summary>Ответы</summary>

1. Подробностей в нём нет (браузер скрывает их), и после него всегда приходит `onclose` — вся
   логика там.
2. Соединения и так нет: `connect()` сразу, без остатка паузы.
3. Метод, переданный в `addEventListener`, потерял бы `this`; `.bind(this)` каждый раз давал бы
   новую функцию, и `removeEventListener` её не снял бы.
</details>
