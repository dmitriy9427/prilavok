# 8. Индикатор связи

[src/components/connection.tsx](../../src/components/connection.tsx)

## Где это

В шапке: точка и «На связи · 12 мс» (зелёная), «Переподключение…» (жёлтая мигает), «Нет сети»
(красная). Пропала связь больше чем на полторы секунды — под шапкой полоса «Нет связи с сервером.
Данные на экране могут быть неактуальны. Попытка 3 через 2 с» и кнопка «Подключиться сейчас».

## Зачем

Живые данные **без индикатора хуже обычных**: им доверяют, а они могли перестать обновляться час
назад. Человек должен всегда знать, актуально ли то, что он видит.

## Что делает

- `ConnectionBadge` — статус и задержка; ссылка на экран «Соединение».
- `OfflineBanner` — полоса, только когда связи нет, и не сразу, а через 1,5 с.
- Обратный отсчёт до следующей попытки.
- Кнопка «Подключиться сейчас» — не ждать остаток паузы.

## Код по частям

### Подписка на состояние клиента

```ts
export const useRealtimeStatus = () => useSyncExternalStore(realtime.subscribeState, realtime.getSnapshot)
```

`useSyncExternalStore(подписаться, прочитать)` — штатный способ React читать то, что живёт вне
React (здесь — объект клиента). React вызывает `getSnapshot` и перерисовывает компонент, когда
подписка сообщает «изменилось» и снимок стал **другим объектом**. Поэтому клиент создаёт новый
снимок только при настоящих изменениях (страница 2, `patch`).

### Таблицы вместо `if`

```ts
export const STATUS_TEXT: Record<RealtimeStatus, string> = {
  idle: 'Не подключено', connecting: 'Подключение…', handshaking: 'Подключение…',
  online: 'На связи', reconnecting: 'Переподключение…', offline: 'Нет сети',
  unauthorized: 'Нет доступа', stopped: 'Отключено',
}
```

`Record<RealtimeStatus, string>` — TypeScript требует строку для **каждого** статуса. Добавили в
клиенте новый статус — здесь сразу ошибка компиляции, забыть невозможно.

`connecting` и `handshaking` для человека одинаковы — «Подключение…»: разницу он не поймёт и
не должен.

### Значок

```tsx
export function ConnectionBadge() {
  const { status, latency } = useRealtimeStatus()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/realtime" aria-label={`Соединение: ${STATUS_TEXT[status]}`}>
            <ConnectionDot status={status} />
            <span className="hidden sm:inline">{STATUS_TEXT[status]}</span>
            {status === 'online' && latency !== null && <span className="tabular hidden text-xs lg:inline">{latency} мс</span>}
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>WebSocket-соединение с сервером. Нажмите, чтобы посмотреть подробности</TooltipContent>
    </Tooltip>
  )
}
```

- На телефоне только точка, текст — от `sm`, задержка — от `lg`. Но `aria-label` всегда полный:
  скринридер слышит статус и на телефоне.
- Цвет — не единственный признак (`aria-hidden` у точки, текст рядом): дальтоник отличит
  «Нет сети» от «На связи».
- `tabular` — цифры одной ширины: «12 мс» → «9 мс» не дёргает соседей.

### Полоса — с задержкой

```tsx
export function OfflineBanner() {
  const { status } = useRealtimeStatus()
  return status === 'reconnecting' || status === 'offline' ? <DelayedBanner /> : null
}

function DelayedBanner() {
  const { status, retryAt, attempt } = useRealtimeStatus()
  const seconds = useCountdown(retryAt)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 1500)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null
  …
}
```

Приём «смонтировать только когда нужно»: `DelayedBanner` существует, **только пока связи нет**.
Связь вернулась через секунду — компонент исчез вместе со своим таймером, полоса так и не
показалась. Не нужно сбрасывать `visible` вручную.

Зачем задержка: короткий обрыв (переключение Wi-Fi) клиент чинит за доли секунды. Мигающая полоса
только пугала бы.

### Обратный отсчёт

```ts
function useCountdown(retryAt: number | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (retryAt === null) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [retryAt])
  return retryAt === null ? null : Math.max(0, Math.ceil((retryAt - now) / 1000))
}
```

- Клиент отдаёт **момент** следующей попытки (`retryAt`), а хук сам считает «сколько осталось».
  Если бы клиент отдавал «осталось 3 с», ему пришлось бы обновлять снимок каждые 250 мс — и
  перерисовывать всех, кто читает статус.
- Таймер тикает, только пока есть `retryAt`.
- `Math.ceil` — «через 1 с» до самого конца, а не «через 0 с» за полсекунды до попытки.

## Что будет, если…

| Сделать | Что сломается |
| --- | --- |
| показывать полосу сразу | каждый короткий обрыв — мигание жёлтой полосы |
| хранить «осталось секунд» в снимке клиента | перерисовка всех подписчиков 4 раза в секунду |
| `useState(false)` для `visible` в `OfflineBanner` | после восстановления полоса «помнит», что была видна, и при следующем обрыве появляется без задержки |
| `Record` → обычный объект | новый статус без подписи — пустой текст в шапке |

## Проверьте себя

1. Экран «Соединение» → «Оборвать». Почему полоса «Нет связи» не появилась?
2. Включите «Нет сети». Что в полосе по-другому и почему нет кнопки «Подключиться сейчас»?

<details>
<summary>Ответы</summary>

1. Переподключение заняло меньше 1,5 с: `DelayedBanner` размонтировался раньше, чем сработал его
   таймер.
2. Текст «Нет подключения к сети», нет отсчёта: в состоянии `offline` попыток нет — клиент ждёт
   события `online`. Кнопка бессмысленна: без сети подключиться нельзя.
</details>
