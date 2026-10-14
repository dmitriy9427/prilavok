# 2. Клиент протокола

[src/realtime/client.ts](../../src/realtime/client.ts) — ~600 строк. Идеи — в главах
[03](../03-protocol.md), [04](../04-reconnect.md), [05](../05-resume.md).

## Где это

Всё, что приходит «само»: новые заказы на дашборде, смена статуса чужой рукой, заметки
коллег, задержка «12 мс» в шапке, журнал кадров на экране «Соединение».

## Что делает

- Поверх транспорта (страница 1) ведёт разговор по нашему протоколу: `hello` → `welcome`.
- Даёт приложению четыре вещи:

| Метод | Что делает |
| --- | --- |
| `subscribe(channel, fn)` | слушать канал; возвращает отписку |
| `on(type, fn)` | слушать события одного вида из любых каналов |
| `request(method, params)` | попросить сервер и дождаться ответа (`Promise`) |
| `getSnapshot()` / `subscribeState` | состояние связи для интерфейса |

- Проверяет, жив ли сервер (ping/pong), и измеряет задержку.
- Помнит закладку (эпоха + номер) и после обрыва просит дослать пропущенное.
- Копит запросы, сделанные без связи, и отправляет после рукопожатия.
- Ведёт журнал кадров для экрана «Соединение».

## Как пользоваться

```ts
const off = realtime.subscribe('order:o_15')                    // слушать канал
const offType = realtime.on('note.added', ({ note }) => …)      // слушать вид событий
const { note } = await realtime.request('note.add', { orderId, text, clientId }, { retry: true })
```

В компонентах — через хуки `useChannel`, `useRealtimeEvent`, `useRealtimeStatus`
([hooks.ts](../../src/realtime/hooks.ts)).

## Код по частям

### Подписка со счётчиком и отложенной отпиской

```ts
subscribe(channel: string, listener: ChannelListener = () => {}) {
  const pendingUnsub = this.unsubTimers.get(channel)
  if (pendingUnsub) {
    clearTimeout(pendingUnsub)
    this.unsubTimers.delete(channel)
  }

  let listeners = this.channels.get(channel)
  if (!listeners) {
    listeners = new Set()
    this.channels.set(channel, listeners)
    if (this.snapshot.status === 'online') this.sendFrame({ t: 'sub', id: this.nextId(), channel })
    this.patch({ channels: [...this.channels.keys()] })
  }
  listeners.add(listener)
```

- `channels` — «канал → набор слушателей». Серверу уходит **один** `sub` при первом слушателе,
  сколько бы компонентов ни слушали канал.
- Связи нет — `sub` не шлём: при подключении весь список каналов уйдёт в `hello`.

```ts
  return () => {
    const current = this.channels.get(channel)
    if (!current?.delete(listener) || current.size > 0) return
    this.unsubTimers.set(channel, setTimeout(() => {
      this.unsubTimers.delete(channel)
      if (this.channels.get(channel)?.size) return
      this.channels.delete(channel)
      if (this.snapshot.status === 'online') this.sendFrame({ t: 'unsub', id: this.nextId(), channel })
      this.patch({ channels: [...this.channels.keys()] })
    }, this.options.unsubscribeDelay ?? 300))
  }
}
```

**Отписка с задержкой 300 мс.** При переходе между экранами старый компонент отписывается, а
новый тут же подписывается на тот же канал (React размонтирует одно и монтирует другое). Без
задержки серверу летела бы пара `unsub` + `sub`, и событие между ними могло бы потеряться. Новый
слушатель успевает прийти — таймер отменяется в начале `subscribe`. Этот баг описан в
[уроке 6](../lessons.md).

### Запрос с ответом

```ts
request(method, params, options = {}) {
  return new Promise((resolve, reject) => {
    const id = this.nextId()
    const pending = {
      frame: { t: 'req', id, method, params },
      resolve, reject,
      retry: options.retry ?? false,
      sent: false,
      timer: setTimeout(() => {
        this.pending.delete(id)
        this.patch({ pending: this.pending.size })
        reject(new RealtimeError('timeout', 'Сервер не ответил вовремя'))
      }, options.timeout ?? 8000),
    }
    this.pending.set(id, pending)
    this.patch({ pending: this.pending.size })
    if (this.snapshot.status === 'online') this.dispatch(pending)
  })
}
```

- `id` связывает запрос и ответ: `ack` придёт с тем же `id`, и мы найдём, чьё обещание
  выполнить.
- **Таймаут общий** — включает и ожидание связи. Запрос не висит вечно.
- `sent` — ушёл ли запрос в сеть. От этого зависит, что делать при обрыве (ниже).
- Нет связи — запрос остаётся в `pending` (это и есть очередь).

### Подключились: `hello`

```ts
private handleOpen() {
  const { epoch, seq } = this.snapshot
  this.sendFrame({
    t: 'hello',
    v: PROTOCOL_VERSION,
    token: this.options.getToken() ?? '',
    channels: [...this.channels.keys()],
    resume: epoch !== null && seq !== null ? { epoch, seq } : null,
  }, true)
  this.welcomeTimer = setTimeout(() => {
    this.patch({ lastError: 'Сервер не ответил на hello' })
    this.transport.reconnect('welcome timeout')
  }, this.options.welcomeTimeout ?? 8000)
}
```

Первым кадром — всё сразу: версия, токен, **все** каналы, закладка. Сервер не ответил за 8 с —
переподключаемся.

### Разбор входящих кадров

```ts
private handleMessage(raw: string) {
  if (this.muted) return
  const frame = decode(serverFrame, raw)
  if (!frame) {
    this.log('in', 'мусор', raw, raw.length)
    return
  }
```

`decode` проверяет кадр схемой zod. Не прошёл — в журнал как «мусор», дальше не идёт.
`muted` — режим «Сервер молчит» с экрана «Соединение».

**`welcome`:**

```ts
case 'welcome': {
  if (this.welcomeTimer) clearTimeout(this.welcomeTimer)
  const hadBookmark = this.snapshot.seq !== null
  const resync = hadBookmark && !frame.resumed
  this.patch({
    status: 'online',
    sessionId: frame.sessionId,
    epoch: frame.epoch,
    seq: frame.resumed && hadBookmark ? this.snapshot.seq : frame.seq,
    attempt: 0, retryAt: null, lastError: null,
    resyncs: this.snapshot.resyncs + (resync ? 1 : 0),
  })
  this.transport.markStable()
  this.startHeartbeat()
  if (resync) this.options.onResync?.()
  for (const pending of this.pending.values()) if (!pending.sent) this.dispatch(pending)
  return
}
```

| Ситуация | Закладка после `welcome` | Что дальше |
| --- | --- | --- |
| первое подключение | номер сервера | живём |
| досылка возможна (`resumed: true`) | **старая** — её сдвинут досланные события | придут пропущенные |
| досылка невозможна (`resumed: false`) | номер сервера | `onResync()` — перезапросить всё по HTTP |

Затем: соединение стабильно (`markStable` — сбросить паузу), запускаем heartbeat, отправляем
очередь. Именно **после** `welcome`, а не после `open`: до рукопожатия сервер нас не знает.

**`event`:**

```ts
case 'event': {
  if (frame.seq !== null) {
    if (this.snapshot.seq !== null && frame.seq <= this.snapshot.seq) return
    this.patch({ seq: frame.seq })
  }
  for (const listener of this.channels.get(event.channel) ?? []) safely(() => listener(event))
  for (const listener of this.typeListeners.get(event.type) ?? []) safely(() => listener(event.data, event))
  return
}
```

- Факт с номером не больше закладки — уже видели (бывает при досылке): пропускаем.
- `safely` — `try/catch` вокруг каждого слушателя: ошибка в одном не оставит без события
  остальных.

**`ack`** находит запрос по `id`, снимает таймер и выполняет или отклоняет обещание. Нет такого
`id` — ответ на `sub`/`unsub` или на запрос, который уже истёк: игнорируем.

**`pong`:**

```ts
case 'pong': {
  if (this.pongTimer) clearTimeout(this.pongTimer)
  this.pongTimer = null
  this.patch({ latency: Date.now() - frame.ts, seq: Math.max(this.snapshot.seq ?? 0, frame.seq) })
  return
}
```

- Задержка = сейчас − время из нашего же `ping` (сервер вернул его как есть). Часы сервера не
  участвуют — их расхождение не важно.
- Закладка двигается по номеру сервера: в наших каналах может быть тихо, а буфер сервера уходит
  вперёд. Безопасно, потому что порядок в соединении гарантирован (глава 05).

### Обрыв: что делать с запросами

```ts
private handleClose(code, reason, willRetry) {
  this.stopHeartbeat()
  for (const [id, pending] of this.pending) {
    if (!pending.sent) continue
    if (pending.retry) pending.sent = false
    else {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(new RealtimeError('disconnected', 'Связь оборвалась — неизвестно, выполнен ли запрос'))
    }
  }
  …
}
```

| Запрос | Не был отправлен | Отправлен, ответа нет |
| --- | --- | --- |
| обычный | ждёт в очереди | отклоняется честно: «неизвестно, выполнен ли» |
| `retry: true` | ждёт в очереди | `sent = false` → уйдёт снова после следующего `welcome` |

### Heartbeat

```ts
private startHeartbeat() {
  this.stopHeartbeat()
  const ping = () => {
    this.sendFrame({ t: 'ping', ts: Date.now() })
    this.pongTimer ??= setTimeout(() => {
      this.pongTimer = null
      this.patch({ lastError: 'Сервер не отвечает на ping' })
      this.transport.reconnect('pong timeout')
    }, this.options.pongTimeout ?? PONG_TIMEOUT)
  }
  this.pingTimer = setInterval(ping, this.options.pingInterval ?? PING_INTERVAL)
  ping()
}
```

- `??=` — один таймер ожидания: если `pong` задержался, следующий `ping` не заводит второй таймер.
- `ping()` сразу — задержка видна с первой секунды.

### Состояние для React

```ts
private patch(patch: Partial<RealtimeSnapshot>) {
  const keys = Object.keys(patch)
  if (keys.every((key) => key === 'channels'
    ? String(patch.channels) === String(this.snapshot.channels)
    : patch[key] === this.snapshot[key])) return
  this.snapshot = { ...this.snapshot, ...patch }
  this.emitState()
}
```

`useSyncExternalStore` сравнивает снимки **по ссылке**. Новый объект с теми же значениями —
React решит, что всё изменилось, и перерисует; если это случится внутри рендера — бесконечный
цикл. Поэтому новый объект создаётся только при настоящем изменении.

## Что будет, если…

| Сделать | Что сломается |
| --- | --- |
| убрать задержку отписки | при переходах — лишние `unsub`/`sub` и риск потерять событие между ними |
| отправлять очередь после `open` | сервер ответит `no_hello` на каждый запрос |
| убрать проверку `frame.seq <= snapshot.seq` | досланное событие применится дважды |
| повторять все запросы после обрыва | заметка без ключа создастся дважды |
| `patch` всегда создаёт новый снимок | лишние перерисовки всех, кто читает статус связи |

## Проверьте себя

1. Три компонента слушают `orders`. Сколько `sub` уйдёт на сервер? Когда уйдёт `unsub`?
2. Почему задержка считается по `ts` из нашего `ping`, а не по `serverTime`?
3. Что произойдёт с запросом `note.add`, отправленным за секунду до обрыва?

<details>
<summary>Ответы</summary>

1. Один `sub` — при первом. `unsub` — через 300 мс после ухода последнего, если за это время
   никто не подписался снова.
2. Часы клиента и сервера могут расходиться на секунды. Разница двух отметок **одних и тех же**
   часов от этого не зависит.
3. Он помечен `retry: true` — вернётся в очередь (`sent = false`) и уйдёт снова после `welcome`.
   Сервер узнает повтор по `clientId` и не создаст вторую заметку.
</details>
