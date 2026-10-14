# 10. Таблицы и формы

## Таблица заказов (TanStack Table v9)

Файлы: `src/features/orders/orders-table.tsx`, `toolbar.tsx`, `src/routes/_app/orders/index.tsx`.

### «Безголовая» библиотека

TanStack Table не рисует ни одного тега. Она считает **модель** — какие столбцы видны, как
отсортировано, что выбрано, — а `<table>` пишем мы. Таблица выглядит как остальной
интерфейс, а не как чужой виджет.

```ts
const features = tableFeatures({ rowSortingFeature, rowPaginationFeature, rowSelectionFeature, columnVisibilityFeature })
const helper = createColumnHelper<typeof features, OrderRow>()
const columns = helper.columns([ helper.accessor('number', { cell: … }), … ])

const table = useTable({ features, columns, data, … })
```

В v9 возможности подключаются явно (`tableFeatures`): в сборку попадает только то, что
используется, а TypeScript не даст вызвать `getIsSorted()` без `rowSortingFeature`.

### Серверный режим

Заказов 1 800, на клиент приходит страница из 20. Сортировать и листать должен сервер:

```ts
manualSorting: true,
manualPagination: true,
rowCount: data.rowCount,          // сколько всего — чтобы таблица знала число страниц
state: { sorting, pagination, rowSelection, columnVisibility },
onSortingChange: (updater) => onSearch({ sort, dir, page: 0 }),
onPaginationChange: (updater) => onSearch({ page, size }),
```

Цепочка от клика до данных:

```
клик по заголовку → onSortingChange → navigate({ search }) → адрес изменился
   → новый ключ запроса → Query идёт на сервер → новая страница → таблица
```

Состояние таблицы **выводится из адреса**, а не хранится в ней: один источник правды.

### Стабильные ссылки

`features`, `columns` и пустой массив объявлены на уровне модуля:

```ts
const EMPTY: OrderRow[] = []
data: rows ?? EMPTY          // а не rows ?? []
```

`rows ?? []` создаёт новый массив на каждый рендер — таблица считала бы, что данные
изменились, и пересчитывала модель.

### Мелочи, из которых состоит хорошая таблица

| Что | Как | Зачем |
| --- | --- | --- |
| `getRowId: (row) => row.id` | id вместо номера строки | выбор «помнит» заказ, а не «третью строку» |
| `enableSortingRemoval: false` | сортировку нельзя снять | у серверного списка всегда должен быть порядок |
| любой фильтр → `page: 0` | | на «странице 7» нового списка может не быть |
| смена списка → сброс выбора | | галочки относились к прежним строкам |
| `aria-sort` на заголовке | | скринридер знает, как отсортировано |
| числа — `tabular-nums` и вправо | | разряды под разрядами |
| видимость столбцов — в `localStorage` | | настройка человека, а не часть ссылки |

Массовое действие возвращает частичный успех: `{ updated: […], skipped: […] }` — «2 заказа →
оплачен» и отдельно «Пропущено: 1».

## 10 000 клиентов (TanStack Virtual)

Файл: `src/routes/_app/customers.tsx`.

10 000 строк в DOM — это ~100 000 элементов: секунды на отрисовку и рывки при прокрутке.
Виртуализация рисует только видимое:

```ts
const virtualizer = useVirtualizer({
  count: rows.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 56,        // высота строки
  overscan: 12,                  // запас за краями экрана
})
```

```tsx
<div ref={scrollRef} style={{ overflow: 'auto', height: … }}>
  <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>   {/* полная высота → честная полоса прокрутки */}
    {virtualizer.getVirtualItems().map((item) => (
      <div style={{ position: 'absolute', height: item.size, transform: `translateY(${item.start}px)` }}>…</div>
    ))}
  </div>
</div>
```

В подзаголовке экрана видно: «загружено 300, в DOM — 23 строки».

Вместе с бесконечной подгрузкой: когда последняя видимая строка близко к концу загруженного,
вызывается `fetchNextPage()`.

Цена виртуализации: Ctrl+F в браузере не найдёт строку, которой нет в DOM, — нужен свой
поиск. Он здесь есть и работает на сервере.

## Форма товара (react-hook-form + zod)

Файлы: `src/features/products/product-form.tsx`, `src/shared/schemas.ts`.

### Одна схема — три применения

```ts
export const productInput = z.object({
  title: z.string().trim().min(3, 'Не короче 3 символов').max(80),
  sku: z.string().trim().regex(/^[A-Z0-9-]{3,16}$/, 'Заглавные латинские буквы, цифры и дефис…'),
  price: money('Цена').min(1),
  oldPrice: money('Старая цена').nullable(),
  variants: z.array(z.object({ … })).max(8),
})
  .refine((v) => v.oldPrice === null || v.oldPrice > v.price, { path: ['oldPrice'], message: '…' })
```

1. форма показывает ошибки под полями (`zodResolver(productInput)`);
2. сервер проверяет тело запроса той же схемой (`api.ts` → `parse`);
3. тип данных выводится из схемы.

`.refine` — правила на несколько полей; `path` говорит, под каким полем показать ошибку.

### Почему не `useState`

Форма на `useState` перерисовывается целиком на каждую букву. RHF хранит значения вне React
и подписывает на изменения только то, что их показывает.

```tsx
<Input {...register('title')} />                                   // обычное поле
<Input type="number" {...register('price', { valueAsNumber: true })} />   // число, а не строка
<Controller control={control} name="category" render={({ field }) => <Select … />} />   // не-нативный элемент
```

### Список вариантов

```tsx
const variants = useFieldArray({ control, name: 'variants' })
variants.fields.map((field, i) => <div key={field.id}>…register(`variants.${i}.name`)…</div>)
```

`key={field.id}`, а не индекс: при удалении строки из середины значения не «съезжают» в
соседние поля.

### Ошибки сервера — в те же поля

Сервер знает то, чего не знает браузер: «артикул занят». Ответ 409 с `fields: { sku: '…' }`:

```ts
for (const [field, message] of Object.entries(error.fields)) setError(field, { message })
```

Человек видит ошибку там же, где и ошибки схемы.

### Когда проверять

`mode: 'onBlur'` + `reValidateMode: 'onChange'`: первая проверка — при уходе с поля (не
ругаться, пока человек печатает), а после ошибки — на каждое изменение (ошибка исчезает,
как только исправили).

### Несохранённые изменения

`useBlocker` спрашивает перед уходом со страницы и перед закрытием вкладки. Тонкость после
успешного сохранения — в [lessons.md](lessons.md), баг №7.

### Доступность формы

- у каждого поля `<label htmlFor>`;
- ошибка связана с полем: `aria-invalid` + `aria-describedby`, сам текст — `role="alert"`;
- `noValidate` на форме — проверяем сами, без всплывашек браузера;
- `inputMode="numeric"` — цифровая клавиатура на телефоне.

## Ошибки

> **Сортировать и фильтровать 1 800 заказов на клиенте**, загрузив их все. Таблица в серверном
> режиме (`manualPagination`, `manualSorting`) только показывает, а считает сервер.
>
> **Рисовать 10 000 строк.** 10 000 элементов DOM — секунды на отрисовку и дёрганая прокрутка.
> Виртуализация рисует только видимые (~30) плюс запас.
>
> **Разная высота строк при `estimateSize` константой.** Прокрутка «прыгает». Либо строки одной
> высоты (как здесь), либо `measureElement`.
>
> **Проверка только на клиенте.** Сервер обязан проверить всё ещё раз — и вернуть ошибки так,
> чтобы форма показала их под полями (`422` + `fields`).
>
> **«Несохранённые изменения» после сохранения.** Форма ещё «грязная» в момент перехода —
> подробности в [уроке 7](lessons.md).

## Попробуйте сами

1. Откройте «Клиенты» и в DevTools → Elements посчитайте строки таблицы. Сколько их, если клиентов
   10 000?
2. Создайте товар с артикулом, который уже есть. Где появилась ошибка и кто её нашёл — форма или
   сервер?
3. Выделите несколько заказов и смените им статус массово так, чтобы часть переходов была
   невозможна. Что покажет интерфейс?

<details>
<summary>Ответы</summary>

1. Несколько десятков: только видимые плюс `overscan: 12` сверху и снизу.
2. Под полем «Артикул»: проверить уникальность может только сервер (`409` с `fields.sku`), форма
   показала его ответ под полем.
3. Два тоста: «N заказов → статус» и предупреждение «Пропущено: M» — частичный успех не ошибка, но
   человек должен о нём знать.
</details>
