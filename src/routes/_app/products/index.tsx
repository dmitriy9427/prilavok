import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router'
import { PlusIcon, SearchIcon } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'

import { productsQuery } from '@/api/queries'
import { EmptyState, ErrorState, Page, PageHeader } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCan } from '@/lib/auth'
import { CATEGORY_LABELS, PRODUCT_STATUS_LABELS, count, formatMoney, formatNumber } from '@/lib/format'
import { useDebouncedInput } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { useChannel } from '@/realtime/hooks'
import { CHANNELS } from '@/shared/protocol'
import { CATEGORIES, PRODUCT_STATUSES, type Product } from '@/shared/types'

const DEFAULTS = { q: '', category: '', status: '' } as const

export const Route = createFileRoute('/_app/products/')({
  validateSearch: z.object({
    q: z.string().max(80).default('').catch(''),
    category: z.enum(CATEGORIES).or(z.literal('')).default('').catch(''),
    status: z.enum(PRODUCT_STATUSES).or(z.literal('')).default('').catch(''),
  }),
  search: { middlewares: [stripSearchParams(DEFAULTS)] },
  loaderDeps: ({ search }) => search,
  // prefetchQuery, а не ensureQueryData: он не бросает ошибку. Если запрос упал, экран всё равно
  // откроется и сам покажет «Не удалось загрузить» с кнопкой «Повторить» (useQuery ниже).
  loader: ({ context, deps }) => context.queryClient.prefetchQuery(productsQuery(deps)),
  component: ProductsPage,
})

/** Остаток: число + слово. Цвет — подсказка, смысл — в тексте. */
function Stock({ product }: { product: Product }) {
  const { stock } = product
  // Значение на момент появления строки: подсвечиваем только ИЗМЕНЕНИЯ, а не первый показ.
  const [initial] = useState(stock)
  return (
    // key = остаток: число изменилось (событие из сокета) → элемент создан заново → анимация играет.
    <span
      key={stock}
      className={cn('tabular inline-flex items-center gap-1.5 rounded px-1', stock !== initial && 'flash-row', stock === 0 ? 'text-destructive' : stock <= 5 ? 'text-warning' : '')}
    >
      {formatNumber(stock)}
      {stock === 0 ? <span className="text-xs">нет в наличии</span> : stock <= 5 ? <span className="text-xs">мало</span> : null}
    </span>
  )
}

function ProductsPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const canCreate = useCan('products.create')
  const { data, error, isPending, isPlaceholderData, isFetching, refetch } = useQuery(productsQuery(search))
  // Остатки меняются, когда приходят заказы, — слушаем канал, пока экран открыт.
  useChannel(CHANNELS.products)

  const setSearch = (patch: Partial<typeof search>) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
  const [text, setText] = useDebouncedInput(search.q, (q) => setSearch({ q }))

  return (
    <Page>
      <PageHeader title="Товары" description={data ? count(data.length, ['товар', 'товара', 'товаров']) : 'Загрузка…'}>
        {canCreate && (
          <Button asChild>
            <Link to="/products/new">
              <PlusIcon /> Новый товар
            </Link>
          </Button>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={text} onChange={(event) => setText(event.target.value)} placeholder="Название или артикул" aria-label="Поиск по товарам" className="pl-8" />
        </div>
        {/* У Radix Select нет пустого значения — «все» кодируем словом all. */}
        <Select value={search.category || 'all'} onValueChange={(value) => setSearch({ category: value === 'all' ? '' : (value as Product['category']) })}>
          <SelectTrigger aria-label="Категория" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все категории</SelectItem>
            {CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>
                {CATEGORY_LABELS[category]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={search.status || 'all'} onValueChange={(value) => setSearch({ status: value === 'all' ? '' : (value as Product['status']) })}>
          <SelectTrigger aria-label="Статус" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Любой статус</SelectItem>
            {PRODUCT_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {PRODUCT_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} retrying={isFetching} />
        ) : isPending ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <EmptyState title="Товаров не найдено" description="Измените запрос или фильтры." />
        ) : (
          <Table className={cn('transition-opacity', isPlaceholderData && 'opacity-60')}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Товар</TableHead>
                <TableHead>Категория</TableHead>
                <TableHead className="text-right">Цена</TableHead>
                <TableHead className="text-right">Остаток</TableHead>
                <TableHead className="text-right">Продано</TableHead>
                <TableHead>Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <Link to="/products/$productId" params={{ productId: product.id }} className="font-medium hover:underline">
                      {product.title}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {product.sku}
                      {product.variants.length > 0 && ` · ${count(product.variants.length, ['вариант', 'варианта', 'вариантов'])}`}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{CATEGORY_LABELS[product.category]}</TableCell>
                  <TableCell className="tabular text-right whitespace-nowrap">
                    {product.oldPrice && <s className="mr-1.5 text-xs text-muted-foreground">{formatMoney(product.oldPrice)}</s>}
                    <span className="font-medium">{formatMoney(product.price)}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Stock product={product} />
                  </TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">{formatNumber(product.sold)}</TableCell>
                  <TableCell>
                    <Badge variant={product.status === 'active' ? 'secondary' : 'outline'} className={cn(product.status === 'archived' && 'text-muted-foreground')}>
                      {PRODUCT_STATUS_LABELS[product.status]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </Page>
  )
}
