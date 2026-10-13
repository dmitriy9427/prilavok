/**
 * Клиенты: 10 000 строк без пагинации.
 *
 * Два приёма вместе:
 *
 * 1. Бесконечная подгрузка (useInfiniteQuery). Сервер отдаёт по 100 клиентов и
 *    «курсор» следующей порции. Докрутили почти до конца — просим ещё.
 *
 * 2. Виртуализация (TanStack Virtual). Даже загруженные 10 000 строк в DOM не
 *    попадают: рисуются только те ~20, что видны, плюс небольшой запас.
 *    Контейнеру задаётся полная высота списка (чтобы полоса прокрутки была
 *    честной), а видимые строки ставятся на свои места через translateY.
 *    Прокрутка остаётся плавной, сколько бы строк ни было.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Loader2Icon, SearchIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { z } from 'zod'

import { customerQuery, customersQuery } from '@/api/queries'
import { EmptyState, ErrorState, Page, PageHeader } from '@/components/page'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/user-avatar'
import { SEGMENT_LABELS, count, formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format'
import { useDebouncedInput } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { SEGMENTS, type Customer, type Segment } from '@/shared/types'

const DEFAULTS = { q: '', segment: '', id: '' } as const

export const Route = createFileRoute('/_app/customers')({
  validateSearch: z.object({
    q: z.string().max(80).default('').catch(''),
    segment: z.enum(SEGMENTS).or(z.literal('')).default('').catch(''),
    /** Открытая карточка клиента — тоже в адресе: ссылкой можно поделиться. */
    id: z.string().default('').catch(''),
  }),
  search: { middlewares: [stripSearchParams(DEFAULTS)] },
  component: CustomersPage,
})

const ROW_HEIGHT = 56
/** Одна сетка для шапки и строк — столбцы совпадают без <table>. */
const GRID = 'grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_6rem] md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_7rem_5rem_7rem] items-center gap-4 px-4'

/** Оттенок аватара из id: у одного клиента цвет всегда один и тот же. */
const hueOf = (id: string) => (Number(id.slice(2)) * 47) % 360

function CustomersPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const setSearch = (patch: Partial<typeof search>) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
  const [text, setText] = useDebouncedInput(search.q, (q) => setSearch({ q }))

  const { data, error, isPending, isPlaceholderData, isFetching, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = useInfiniteQuery(
    customersQuery({ q: search.q, segment: search.segment }),
  )

  // Страницы склеиваются в один плоский список.
  const rows = data?.pages.flatMap((page) => page.rows) ?? []
  const total = data?.pages[0]?.total ?? 0

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    // Высота строки известна заранее — виртуализатору не нужно измерять каждую.
    estimateSize: () => ROW_HEIGHT,
    // Запас строк за краями экрана: при быстрой прокрутке не видно «пустоты».
    overscan: 12,
  })
  const items = virtualizer.getVirtualItems()
  const lastIndex = items.at(-1)?.index ?? 0

  // Последняя видимая строка близко к концу загруженного — подгружаем следующую порцию.
  useEffect(() => {
    if (lastIndex >= rows.length - 20 && hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [lastIndex, rows.length, hasNextPage, isFetchingNextPage, fetchNextPage])

  // Новый поиск — список начинается сначала.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [search.q, search.segment])

  return (
    <Page>
      <PageHeader
        title="Клиенты"
        description={
          data
            ? `${count(total, ['клиент', 'клиента', 'клиентов'])}${search.q || search.segment ? ' по фильтрам' : ''} · загружено ${formatNumber(rows.length)}, в DOM — ${items.length} строк`
            : 'Загрузка…'
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Имя, почта, телефон или город"
            aria-label="Поиск по клиентам"
            className="pl-8"
          />
        </div>
        <Select value={search.segment || 'all'} onValueChange={(value) => setSearch({ segment: value === 'all' ? '' : (value as Segment) })}>
          <SelectTrigger aria-label="Сегмент" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все сегменты</SelectItem>
            {SEGMENTS.map((segment) => (
              <SelectItem key={segment} value={segment}>
                {SEGMENT_LABELS[segment]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className={cn(GRID, 'h-10 border-b text-sm font-medium text-muted-foreground')} aria-hidden>
          <span>Клиент</span>
          <span className="hidden md:block">Контакты</span>
          <span>Город</span>
          <span className="hidden md:block">Сегмент</span>
          <span className="hidden text-right md:block">Заказов</span>
          <span className="text-right">Сумма</span>
        </div>

        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} retrying={isFetching} />
        ) : isPending ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 9 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="Никого не нашли" description="Попробуйте другой запрос." />
        ) : (
          // Высота окна списка: экран минус шапка, заголовок и фильтры.
          <div ref={scrollRef} className={cn('h-[calc(100svh-19rem)] min-h-80 overflow-y-auto transition-opacity', isPlaceholderData && 'opacity-60')}>
            {/* role="list": для скринридера это список, хотя в DOM лишь его видимая часть. */}
            <div role="list" aria-label="Клиенты" className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {items.map((item) => {
                const customer = rows[item.index]!
                return (
                  <div key={customer.id} role="listitem" className="absolute top-0 left-0 w-full" style={{ height: item.size, transform: `translateY(${item.start}px)` }}>
                    <button
                      type="button"
                      onClick={() => setSearch({ id: customer.id })}
                      aria-label={`${customer.name}, ${customer.city}: открыть карточку`}
                      className={cn(GRID, 'h-full w-full border-b text-left text-sm outline-none hover:bg-muted/50 focus-visible:bg-muted')}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <UserAvatar name={customer.name} hue={hueOf(customer.id)} />
                        <span className="truncate font-medium">{customer.name}</span>
                      </span>
                      <span className="hidden min-w-0 md:block">
                        <span className="block truncate">{customer.email}</span>
                        <span className="tabular block truncate text-xs text-muted-foreground">{customer.phone}</span>
                      </span>
                      <span className="truncate text-muted-foreground">{customer.city}</span>
                      <span className="hidden md:block">
                        <Badge variant={customer.segment === 'vip' ? 'default' : 'secondary'}>{SEGMENT_LABELS[customer.segment]}</Badge>
                      </span>
                      <span className="tabular hidden text-right md:block">{customer.ordersCount}</span>
                      <span className="tabular text-right font-medium">{formatMoney(customer.totalSpent)}</span>
                    </button>
                  </div>
                )
              })}
            </div>
            {isFetchingNextPage && (
              <p className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" /> Загружаем ещё…
              </p>
            )}
          </div>
        )}
      </div>

      <CustomerSheet id={search.id} onClose={() => setSearch({ id: '' })} />
    </Page>
  )
}

function CustomerSheet({ id, onClose }: { id: string; onClose: () => void }) {
  // enabled: запрос уходит, только когда карточка открыта.
  const { data, error, isPending } = useQuery({ ...customerQuery(id), enabled: id !== '' })

  return (
    <Sheet open={id !== ''} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {error ? (
          <>
            <SheetHeader>
              <SheetTitle>Клиент</SheetTitle>
              <SheetDescription>Не удалось загрузить</SheetDescription>
            </SheetHeader>
            <ErrorState error={error} />
          </>
        ) : isPending ? (
          <>
            <SheetHeader>
              <SheetTitle>Клиент</SheetTitle>
              <SheetDescription>Загрузка…</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-3 px-4">
              <Skeleton className="h-16" />
              <Skeleton className="h-32" />
            </div>
          </>
        ) : (
          <CustomerCard customer={data.customer} orders={data.orders} />
        )}
      </SheetContent>
    </Sheet>
  )
}

function CustomerCard({
  customer,
  orders,
}: {
  customer: Customer
  orders: { id: string; number: string; createdAt: string; total: number; status: Parameters<typeof StatusBadge>[0]['status'] }[]
}) {
  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-3">
          <UserAvatar name={customer.name} hue={hueOf(customer.id)} className="size-11 text-sm" />
          <div className="min-w-0">
            <SheetTitle>{customer.name}</SheetTitle>
            <SheetDescription>
              {SEGMENT_LABELS[customer.segment]} · с {formatDate(customer.registeredAt)}
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>
      <div className="flex flex-col gap-6 px-4 pb-6">
        <dl className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">Заказов</dt>
            <dd className="tabular text-lg font-semibold">{formatNumber(customer.ordersCount)}</dd>
          </div>
          <div className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">Потрачено</dt>
            <dd className="tabular text-lg font-semibold">{formatMoney(customer.totalSpent)}</dd>
          </div>
        </dl>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Почта</dt>
          <dd className="truncate">
            <a href={`mailto:${customer.email}`} className="hover:underline">
              {customer.email}
            </a>
          </dd>
          <dt className="text-muted-foreground">Телефон</dt>
          <dd className="tabular">
            <a href={`tel:${customer.phone.replace(/[^\d+]/g, '')}`} className="hover:underline">
              {customer.phone}
            </a>
          </dd>
          <dt className="text-muted-foreground">Город</dt>
          <dd>{customer.city}</dd>
        </dl>
        <div>
          <h3 className="mb-2 text-sm font-medium">Заказы за полгода</h3>
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">За последние полгода заказов не было.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {orders.map((order) => (
                <li key={order.id}>
                  <Link to="/orders/$orderId" params={{ orderId: order.id }} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50">
                    <span className="flex-1">
                      <span className="block font-medium">{order.number}</span>
                      <span className="text-xs text-muted-foreground">{formatDateTime(order.createdAt)}</span>
                    </span>
                    <StatusBadge status={order.status} />
                    <span className="tabular w-20 text-right font-medium">{formatMoney(order.total)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
