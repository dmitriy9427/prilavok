# 12. Тесты и публикация

## Что проверяется

```bash
npm test          # 138 тестов, ~3 секунды
npm run check     # линтер + типы + тесты + сборка
```

| Файл | Тестов | Что проверяет |
| --- | --- | --- |
| `realtime/backoff.test.ts` | 4 | рост паузы, потолок, разброс |
| `realtime/socket.test.ts` | 11 | переподключение, таймауты, offline, остановка |
| `realtime/client.test.ts` | 28 | рукопожатие, подписки, докачка, heartbeat, запросы, очередь |
| `backend/hub.test.ts` | 26 | сервер: каналы, досылка, присутствие, уборка |
| `backend/api.test.ts` | 36 | REST: права, фильтры, статусы, товары, статистика |
| `realtime/sync.test.ts` | 14 | события → кэш: версии, повторы, оптимистичные заметки |
| `lib/format.test.ts` | 19 | склонения, даты, CSV |

Тестируется логика, а не разметка. Экраны тонкие: всё, что можно сломать незаметно, вынесено
в чистые модули.

## Как тестировать сокет без сети

Настоящая сеть в тестах — медленно и нестабильно. Два приёма.

### 1. Зависимость передаётся параметром

Клиент не берёт глобальный `WebSocket`, а получает класс через опции:

```ts
new RealtimeClient({ url, getToken, WebSocket: FakeSocket, random: () => 0.999 })
```

`FakeSocket` (`src/test/fake-socket.ts`) — класс с тем же интерфейсом, которым управляет тест:

```ts
FakeSocket.last.open()                         // «соединение установлено»
FakeSocket.last.receive({ t: 'welcome', … })   // «сервер прислал кадр»
FakeSocket.last.drop(1006)                     // «связь оборвалась»
expect(FakeSocket.last.sent[0]).toMatchObject({ t: 'hello' })   // что отправил клиент
```

Так же подменяется случайность (`random`) — иначе паузу с jitter не проверить точным числом.

### 2. Поддельное время

Тест «через 30 секунд пауза достигает потолка» не должен идти 30 секунд:

```ts
vi.useFakeTimers()
socket.start(); FakeSocket.last.drop()
vi.advanceTimersByTime(499); expect(FakeSocket.instances).toHaveLength(1)
vi.advanceTimersByTime(1);   expect(FakeSocket.instances).toHaveLength(2)   // ровно через 500 мс
```

### Тест как сценарий

```ts
it('обрыв после отправки: идемпотентный запрос отправляется снова с тем же id', async () => {
  const socket = connect(client)
  const promise = client.request('note.add', {…}, { retry: true })
  const first = socket.framesOf('req')[0]

  const next = reconnect()                 // обрыв + новое соединение
  next.receive(welcome())
  expect(next.framesOf('req')[0]).toEqual(first)

  next.receive({ t: 'ack', id: first.id, ok: true, result: {…} })
  await expect(promise).resolves.toEqual({…})
})
```

Имена тестов — предложения по-русски. Список тестов читается как требования к системе:
откройте `client.test.ts` и прочитайте только строки `it(…)`.

### Сервер — без сети вовсе

Хаб принимает «соединение» из двух функций, API — простой объект запроса. Тесты вызывают их
напрямую. А `sync.test.ts` соединяет настоящий клиент, поддельный сокет и настоящий
`QueryClient` — и проверяет, что событие доходит до кэша.

## Линтер и типы

- **oxlint** — быстрый линтер на Rust: правила хуков, зависимости эффектов, React Compiler.
- **TypeScript** — `strict`, `erasableSyntaxOnly` (только синтаксис, который можно просто
  стереть: без `enum` и параметров-свойств — поэтому Node запускает `.ts` без сборки),
  `verbatimModuleSyntax` (`import type` для типов).

## Публикация на GitHub Pages

`.github/workflows/pages.yml`: `npm ci` → `npm run check` (с `VITE_BASE=/prilavok/`) →
публикация `dist/`. Проверки стоят перед публикацией: сломанный код на сайт не попадёт.

Что нужно статическому хостингу в подпапке:

| Настройка | Где |
| --- | --- |
| пути к файлам сборки | `base` в `vite.config.ts` |
| корень роутера | `basepath: import.meta.env.BASE_URL` |
| прямые ссылки на экраны | `dist/404.html` — копия `index.html` (скрипт `build`) |
| файл воркера MSW | `public/mockServiceWorker.js`, адрес — с учётом `BASE_URL` |
| адрес сокета мока | `WS_URL` выводится из адреса страницы |

## Подключить настоящий бэкенд

Приложение не знает, что сервер поддельный. Чтобы подключить свой:

1. `.env.production`:
   ```
   VITE_BACKEND=real
   VITE_API_URL=https://api.example.com/api
   VITE_WS_URL=wss://api.example.com/ws
   ```
2. Сервер реализует REST из `src/backend/api.ts` и протокол из `src/shared/protocol.ts`
   (на любом языке — это обычные JSON-сообщения).
3. Токен: заменить демо-строку на настоящий (JWT или сессия); лучше — cookie `HttpOnly`.
4. Перед Node — nginx или балансировщик с TLS, пропускающий `Upgrade`:
   ```nginx
   location /ws {
     proxy_pass http://app;
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection "upgrade";
     proxy_read_timeout 75s;      # больше интервала ping (15 с) — соединение не закроют за простой
   }
   ```

Код мока в сборку не попадёт: он подключается динамическим `import()` только при
`USE_MOCK`.

## Что добавить в настоящем проекте

- e2e-тесты (Playwright): вход, смена статуса, создание товара;
- тест «два браузера»: действие в одном видно в другом;
- мониторинг: число соединений, частота переподключений, доля `resumed: false`;
- отправка ошибок клиента (Sentry).

## Ошибки

> **Тестировать сокет с настоящей сетью и `setTimeout`.** Медленно и «иногда» красное.
> Подменяйте `WebSocket` классом-заглушкой, а время — фейковыми таймерами (`vi.useFakeTimers()`).
>
> **Тестировать случайность случайностью.** Разброс паузы проверяется с подменённым
> `random: () => 0` и `() => 0.999`.
>
> **Тесты делят общее состояние** (один экземпляр клиента, один хаб) и мешают друг другу —
> [урок 2](lessons.md).
>
> **Сборка для Pages без `404.html`.** Прямой заход на `/prilavok/orders` отдаёт 404 хостинга.

## Попробуйте сами

1. Найдите в `socket.test.ts` тест, который проверяет, что после кода 4401 нет повторов. Как он
   «закрывает» соединение без сети?
2. Почему у `ReconnectingSocket` в опциях есть `WebSocket` и `random`?
3. Что нужно поменять, чтобы опубликовать «Прилавок» не в `/prilavok/`, а в корень домена?

<details>
<summary>Ответы</summary>

1. Тест подставляет свой класс-заглушку вместо `WebSocket` и сам вызывает его `onclose` с нужным
   кодом.
2. Это **подмены для тестов**: заглушка вместо настоящего сокета и предсказуемая «случайность».
   Класс получает их снаружи, поэтому его можно проверить без сети.
3. `VITE_BASE=/` при сборке — `base` у Vite и `basepath` у роутера берутся из него.
</details>
