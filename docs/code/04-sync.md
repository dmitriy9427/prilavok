# 4. События → кэш

[src/realtime/sync.ts](../../src/realtime/sync.ts), [src/realtime/live.ts](../../src/realtime/live.ts),
[src/lib/store.ts](../../src/lib/store.ts). Глава — [07. Сокет и интерфейс](../07-cache-sync.md).

## Где это

Борис сменил статус заказа — у Анны в таблице поменялся значок и строка мигнула; на дашборде
выросло «за сегодня»; в колокольчике появилась единица. Ни один из этих компонентов не знает
про сокет.

## Что делает

- Каждое событие сервера превращает в правку данных, которые читает интерфейс.
- Выбирает одну из трёх реакций: поправить кэш на месте, пометить устаревшим или только
  посчитать «новое».
- Защищает от двойного применения и событий не по порядку — версиями записей.
- Живое состояние, которое не является ответом на запрос (метрики, лента, счётчики), держит в
  своём маленьком хранилище.
- После «досылка невозможна» помечает устаревшим весь кэш.

## Как подключено

```ts
// main.tsx (упрощённо)
attachRealtimeSync(realtime, queryClient, setResyncHandler)
```

Один раз на приложение. Возвращает функцию отключения.

## Три реакции на событие

| Реакция | Когда | Пример |
| --- | --- | --- |
| `setQueryData` — поправить на месте | в событии всё нужное | статус заказа, заметка, остаток |
| `invalidateQueries` — «устарело» | пересчитать сами не можем | статистика дашборда |
| только счётчик | правка «на месте» невозможна или опасна | новые заказы в списке с фильтрами |

## Код по частям

### Статистика — не чаще раза в 10 секунд

```ts
let statsTimer: ReturnType<typeof setTimeout> | null = null
const refreshStatsSoon = () => {
  statsTimer ??= setTimeout(() => {
    statsTimer = null
    void queryClient.invalidateQueries({ queryKey: keys.stats })
  }, 10_000)
}
```

Каждое событие о заказе меняет статистику, но пересчитать выручку на клиенте нельзя (нужны все
заказы). Перезапрашивать на каждое событие — шторм запросов. `??=` заводит таймер, только если
его нет: 30 событий за 10 секунд — один перезапрос.

### `order.updated` — правка с проверкой версии

```ts
client.on('order.updated', (event) => {
  const isNewer = (current: { version: number }) => current.version < event.version

  queryClient.setQueryData<OrderDetail>(keys.order(event.id), (detail) =>
    detail && isNewer(detail.order)
      ? { ...detail, order: { ...detail.order, status: event.status, version: event.version,
          updatedAt: event.updatedAt,
          history: [...detail.order.history, { at: event.updatedAt, status: event.status, by: event.by }] } }
      : detail,
  )
```

- `setQueryData(ключ, функция)` — функция получает текущее значение кэша и возвращает новое.
  Вернули то же самое (`detail`) — ничего не изменилось, перерисовки не будет.
- `detail &&` — карточку этого заказа никто не открывал, в кэше её нет — и не нужно.
- **Версия** защищает от двух гонок:
  1. своя правка: ответ HTTP уже положил версию 4, следом пришло событие с версией 4 —
     `4 < 4` ложно, второй раз запись в историю не добавится;
  2. события не по порядку: версия 6 уже есть, опоздавшая 5 не затрёт её.

```ts
  queryClient.setQueriesData<Page<OrderRow>>({ queryKey: keys.orderLists }, (page) =>
    page?.rows.some((row) => row.id === event.id && isNewer(row))
      ? { ...page, rows: page.rows.map((row) => (row.id === event.id ? { ...row, status: event.status, … } : row)) }
      : page,
  )
```

**`setQueriesData`** (во множественном числе) — «все запросы, чей ключ **начинается** с
`['orders', 'list']`». В кэше могут лежать страницы 1, 2, 5 с разными фильтрами — строка
поправится везде, где она есть. Иерархические ключи для этого и придуманы.

```ts
  live.orderTouched(event.id, { status: event.status, … })
  refreshStatsSoon()
})
```

`orderTouched` запоминает время — строка таблицы подсветится (глава 07, `flash-row`).

### `note.added` — заменить свою бледную заметку настоящей

```ts
client.on('note.added', ({ note, clientId }) => {
  queryClient.setQueryData<OrderDetail>(keys.order(note.orderId), (detail) => {
    if (!detail || detail.notes.some((existing) => existing.id === note.id)) return detail
    const optimistic = clientId ? detail.notes.findIndex((existing) => existing.id === clientId) : -1
    const notes = optimistic >= 0 ? detail.notes.with(optimistic, note) : [...detail.notes, note]
    return { ...detail, notes }
  })
})
```

- Уже есть заметка с таким `id` — пришла второй раз (ответ `ack` успел раньше): пропускаем.
- Есть временная заметка с `id === clientId` — это наша, показанная «оптимистично». Заменяем её
  **на том же месте** (`Array.with` — копия массива с заменой одного элемента), без прыжка в
  списке.
- Иначе — чужая заметка, в конец.

### Новые заказы — только счётчик

```ts
client.on('order.created', ({ order }) => {
  live.orderCreated(order)
  refreshStatsSoon()
}),
```

Таблицу заказов **не трогаем**: под фильтр ли он попадёт, на какую страницу — решает сервер; а
вставка сдвинула бы строки под курсором. `live` копит `fresh` — список покажет «Пришло 3 новых
заказа — Показать».

### Ресинк

```ts
onResync(() => {
  void queryClient.invalidateQueries()
  toast.info('Связь восстановлена', { description: 'Данные обновлены' })
})
```

`invalidateQueries()` без ключа — **всё** устарело. Перезапросится только то, что сейчас на
экране; остальное — при следующем показе.

## Хранилище для «живого»: `createStore`

Кэш запросов — это «что сервер ответил на такой-то запрос». А «посетителей сейчас 42» или «с
открытия списка пришло 3 заказа» — не ответы на запросы. Для них 25 строк своего хранилища:

```ts
export function createStore<T>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set: (next) => {
      const value = typeof next === 'function' ? next(state) : next
      if (Object.is(value, state)) return
      state = value
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}

export function useStore(store, selector = (state) => state) {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()))
}
```

- Хранилище живёт **вне React**: значения меняет сокет, который живёт дольше любого компонента.
- `Object.is(value, state)` — вернули то же — никого не будим.
- `useStore(liveStore, (s) => s.fresh.length)` — компонент перерисуется, только когда изменилось
  **число**, а не любая часть состояния. Селектор должен возвращать значение из состояния, а не
  новый объект — иначе «изменилось» будет каждый раз.

## Что будет, если…

| Убрать | Что сломается |
| --- | --- |
| проверку версии | своя правка попадает в историю заказа дважды; опоздавшее событие откатывает статус |
| `setQueriesData` → `setQueryData` с одним ключом | строка обновится только на одной странице списка |
| таймер статистики | шторм запросов при всплеске заказов |
| замену по `clientId` | своя заметка показывается дважды: бледная и настоящая |
| `Object.is` в `set` | каждый `set` с тем же значением будит всех подписчиков |

## Проверьте себя

1. Почему `order.updated` правит кэш на месте, а `order.created` — нет?
2. Что означает `setQueriesData({ queryKey: ['orders', 'list'] }, …)`?
3. Зачем метрики хранятся в `liveStore`, а не в кэше TanStack Query?

<details>
<summary>Ответы</summary>

1. Строка изменившегося заказа уже есть там, где она есть, — её можно поправить без сервера и без
   сдвига таблицы. Место нового заказа в отфильтрованном отсортированном списке знает только
   сервер.
2. Применить функцию ко **всем** закэшированным запросам, ключ которых начинается с
   `['orders', 'list']` — ко всем страницам и фильтрам.
3. Это не ответ на HTTP-запрос: их нечем «перезапросить», у них нет ключа и свежести. Это поток
   состояния из сокета.
</details>
