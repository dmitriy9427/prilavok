# 9. 10 000 клиентов

[src/routes/_app/customers.tsx](../../src/routes/_app/customers.tsx)

## Где это

Экран «Клиенты»: один длинный список без страниц, поиск и фильтр по сегменту. В заголовке честная
статистика: «10 000 клиентов · загружено 300, в DOM — 38 строк». Клик по строке открывает
карточку справа (и адрес меняется — ссылкой можно поделиться).

## Что делает

Два приёма вместе:

1. **Бесконечная подгрузка** (`useInfiniteQuery`): сервер отдаёт по 100 клиентов и «курсор»
   следующей порции. Докрутили почти до конца — загружаем ещё.
2. **Виртуализация** (`@tanstack/react-virtual`): даже загруженные строки в DOM не попадают —
   рисуются только видимые плюс запас.

## Зачем виртуализация

10 000 строк × ~15 элементов в строке = 150 000 узлов DOM. Браузер секунды считает раскладку,
прокрутка дёргается, память растёт. Глазу видно ~15 строк — их и рисуем.

```
┌─ окно прокрутки (видно 15 строк) ─┐
│  [пустое место высотой 50 000px]  │ ← контейнер: высота ВСЕГО списка (честная полоса прокрутки)
│  строка 1000  translateY(56000)   │
│  строка 1001  translateY(56056)   │ ← только видимые (+ 12 запаса сверху и снизу)
│  …                                │
└───────────────────────────────────┘
```

## Код по частям

### Адрес — источник состояния

```ts
export const Route = createFileRoute('/_app/customers')({
  validateSearch: z.object({
    q: z.string().max(80).default('').catch(''),
    segment: z.enum(SEGMENTS).or(z.literal('')).default('').catch(''),
    id: z.string().default('').catch(''),
  }),
  search: { middlewares: [stripSearchParams(DEFAULTS)] },
  component: CustomersPage,
})
```

- Поиск, сегмент и **открытая карточка** — в адресе: ссылка `…/customers?segment=vip&id=c_42`
  откроет то же самое у коллеги.
- `.catch('')` — мусор в адресе не роняет экран.
- `stripSearchParams(DEFAULTS)` — значения по умолчанию в адрес не пишутся: `/customers`, а не
  `/customers?q=&segment=&id=`.

### Поиск с задержкой

```ts
const [text, setText] = useDebouncedInput(search.q, (q) => setSearch({ q }))
```

В поле — `text` (меняется на каждую букву), в адрес и запрос — `q` (через паузу после последней
буквы). Иначе «иванов» — шесть запросов.

`setSearch` использует `replace: true`: каждая буква не создаёт запись в истории «Назад».

### Подгрузка порциями

```ts
const { data, …, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery(
  customersQuery({ q: search.q, segment: search.segment }),
)
const rows = data?.pages.flatMap((page) => page.rows) ?? []
const total = data?.pages[0]?.total ?? 0
```

`useInfiniteQuery` хранит **массив страниц**. `flatMap` склеивает их в один список. Новая
порция — новая страница в массиве, старые не перезапрашиваются.

### Виртуализатор

```ts
const virtualizer = useVirtualizer({
  count: rows.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => ROW_HEIGHT,     // 56px — у всех строк одна высота
  overscan: 12,
})
const items = virtualizer.getVirtualItems()
```

- `count` — сколько строк **всего** (загружено).
- `getScrollElement` — что прокручивается (свой блок, а не окно).
- `estimateSize` — высота строки. Раз она одинакова, виртуализатору не нужно измерять каждую.
- `overscan: 12` — запас строк за краями: при быстрой прокрутке не видно «пустоты».
- `items` — какие строки рисовать сейчас: `{ index, start, size }`.

### Когда грузить ещё

```ts
const lastIndex = items.at(-1)?.index ?? 0
useEffect(() => {
  if (lastIndex >= rows.length - 20 && hasNextPage && !isFetchingNextPage) void fetchNextPage()
}, [lastIndex, rows.length, hasNextPage, isFetchingNextPage, fetchNextPage])
```

Последняя нарисованная строка в 20 строках от конца загруженного — просим следующую порцию.
Заранее, чтобы человек не упирался в «Загружаем ещё…». `!isFetchingNextPage` — не просить ту же
порцию дважды.

### Разметка строк

```tsx
<div ref={scrollRef} className="h-[calc(100svh-19rem)] min-h-80 overflow-y-auto">
  <div role="list" aria-label="Клиенты" className="relative" style={{ height: virtualizer.getTotalSize() }}>
    {items.map((item) => {
      const customer = rows[item.index]!
      return (
        <div key={customer.id} role="listitem" className="absolute top-0 left-0 w-full"
             style={{ height: item.size, transform: `translateY(${item.start}px)` }}>
          <button type="button" onClick={() => setSearch({ id: customer.id })}
                  aria-label={`${customer.name}, ${customer.city}: открыть карточку`} …>
            …
          </button>
        </div>
      )
    })}
  </div>
</div>
```

- Внутренний блок высотой **со весь список** (`getTotalSize`) — полоса прокрутки честная.
- Каждая строка — `position: absolute` и сдвиг `translateY(start)`. `transform` дешевле `top`:
  браузер не пересчитывает раскладку.
- `key={customer.id}`, а не `item.index` — при новом поиске строки с тем же номером — другие
  клиенты.
- `role="list"` / `listitem` — это не `<table>` (столбцы на CSS-сетке), но скринридер узнает
  список.
- Строка — `<button>`: работает с клавиатуры, Enter открывает карточку.

### Карточка — запрос только когда открыта

```ts
const { data } = useQuery({ ...customerQuery(id), enabled: id !== '' })
```

`enabled: false` — запрос не отправляется. Карточка закрыта — `id` пустой — нет запроса.

## Что будет, если…

| Убрать | Что сломается |
| --- | --- |
| виртуализацию (рендерить `rows.map`) | после нескольких подгрузок прокрутка тормозит, вкладка ест сотни МБ |
| `overscan` | при быстрой прокрутке мелькают пустые места |
| `!isFetchingNextPage` | одна и та же порция запрашивается несколько раз |
| `key={item.index}` | при смене поиска React переиспользует строки чужих клиентов (мигание, сбитый фокус) |
| `replace: true` в поиске | «Назад» перебирает каждую напечатанную букву |

## Проверьте себя

1. Откройте DevTools → Elements и прокрутите список. Что происходит с элементами строк?
2. Почему высота строки задана константой, и что делать, если у строк разная высота?
3. Найдите клиента, откройте карточку и обновите страницу. Что откроется?

<details>
<summary>Ответы</summary>

1. Их число почти не меняется: уходящие за край удаляются, входящие добавляются, а у оставшихся
   меняется только `transform`.
2. Так виртуализатор знает положение любой строки без замеров. Для разной высоты — передать
   `measureElement` и ставить `ref={virtualizer.measureElement}` на строку: высота измерится
   после отрисовки.
3. Тот же поиск и та же карточка: всё в адресе (`?q=…&id=…`).
</details>
