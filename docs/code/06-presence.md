# 6. «Сейчас смотрят»

[src/features/orders/presence.tsx](../../src/features/orders/presence.tsx)

## Где это

Под заголовком заказа: аватары коллег и «Борис тоже смотрит этот заказ». Зачем: два менеджера
открыли один заказ и оба звонят клиенту. Подсказка «этим уже занимаются» экономит неловкий звонок.

## Что делает

- Подписывается на канал заказа `order:<id>` — сервер сразу присылает текущий список смотрящих.
- Сообщает серверу «я смотрю этот заказ» и «я ушёл».
- Показывает всех, **кроме себя**.
- Переживает переподключение: после новой сессии снова говорит «я здесь».
- Закрыли вкладку без «прощания» — сервер уберёт вас сам, по закрытию соединения.

## Как пользоваться

```tsx
const viewers = usePresence(orderId)   // хук: данные
<Presence users={viewers} />           // компонент: отображение
```

Хук и компонент разделены: данные можно использовать и в другом месте (например, иконка
«занято» в строке таблицы).

## Код по частям

### Хук

```ts
export function usePresence(orderId: string) {
  const channel = CHANNELS.order(orderId)
  const [users, setUsers] = useState<PresenceUser[]>([])
  const { sessionId } = useRealtimeStatus()

  useChannel(channel)
```

`useChannel` — подписка, пока компонент на экране:

```ts
export function useChannel(channel: string | null) {
  useEffect(() => (channel ? realtime.subscribe(channel) : undefined), [channel])
}
```

`subscribe` возвращает функцию отписки, а `useEffect` вызывает возвращённую функцию при уходе.
Одна строка — и подписка не может «утечь».

```ts
  useRealtimeEvent('presence', (data, frame) => {
    if (frame.channel === channel) setUsers(data.users)
  })
```

`presence` приходит из **всех** каналов заказов, на которые есть подписка (в другой вкладке
этого же окна мог быть открыт другой заказ). Берём только свой канал.

`useRealtimeEvent` внутри использует `useEffectEvent`: обработчик всегда видит свежий `channel`,
но эффект не переподписывается на каждый рендер.

Список хранится в `useState`, а не в кэше запросов: это **состояние**, а не данные заказа.
Ушли со страницы — оно никому не нужно.

```ts
  useEffect(() => {
    if (!sessionId) return
    realtime.request('presence.focus', { orderId }).catch(() => {})
    return () => {
      realtime.request('presence.focus', { orderId: null }).catch(() => {})
    }
  }, [orderId, sessionId])

  return users
}
```

- **Зависимость от `sessionId`** — главная деталь. Присутствие сервер хранит **в сессии**. После
  переподключения сессия новая, и сервер о нас ничего не помнит. Новый `sessionId` → эффект
  перезапустится → `focus` уйдёт снова.
- Нет сессии (связи) — ничего не шлём: всё равно не дойдёт.
- `.catch(() => {})` — присутствие украшение: если запрос не прошёл, ничего не должно ломаться
  и никаких тостов.
- Уборка — «я больше не смотрю» (`orderId: null`).

### Компонент

```tsx
export function Presence({ users }) {
  const me = useUser()
  const others = users.filter((user) => user.id !== me?.id)
  if (!others.length) return null
  return (
    <div className="slide-in flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <div className="flex -space-x-2">
        {others.map((user) => (
          <Tooltip key={user.id}>…<UserAvatar name={user.name} hue={user.hue} />…</Tooltip>
        ))}
      </div>
      <span>{others.length === 1 ? `${others[0]!.name} тоже смотрит этот заказ` : `Ещё ${others.length} человека смотрят этот заказ`}</span>
    </div>
  )
}
```

- Себя не показываем: «вы смотрите этот заказ» — бесполезная информация.
- `-space-x-2` — аватары внахлёст, `ring-2 ring-background` — белая обводка между ними.
- `role="status"` — скринридер сообщит, что кто-то присоединился.

## Сервер: кто смотрит

```ts
// hub.ts
viewers(orderId) {
  const users = new Map<string, PresenceUser>()
  for (const { user, focus } of this.sessions.values()) {
    if (user && focus === orderId) users.set(user.id, { id: user.id, name: user.name, hue: user.hue })
  }
  …
  return [...users.values()]
}
```

`Map` по `user.id` — один человек в двух вкладках показывается один раз. При `disconnect` хаб
сам рассылает новый список: закрыли вкладку без `focus(null)` — всё равно исчезли.

## Что будет, если…

| Сделать | Что сломается |
| --- | --- |
| убрать `sessionId` из зависимостей | после обрыва связи вы «пропадаете» из смотрящих |
| не фильтровать по `frame.channel` | в карточке заказа появятся смотрящие **другого** заказа |
| не фильтровать себя | всегда «вы тоже смотрите» |
| убрать `.catch` | без связи — необработанная ошибка в консоли на каждом переходе |

## Проверьте себя

1. Откройте один заказ в двух окнах под разными ролями (настоящий сервер). Закройте одно окно
   крестиком. Как второе узнало об этом, если `focus(null)` не отправлялся?
2. Почему список смотрящих не кладут в кэш TanStack Query?

<details>
<summary>Ответы</summary>

1. Закрылось соединение → `hub.disconnect` → у сессии был `focus` → хаб разослал новый список в
   канал заказа.
2. Это не ответ на HTTP-запрос и не данные заказа, а мгновенное состояние. Его нечем
   «перезапросить», и после ухода со страницы оно не нужно.
</details>
