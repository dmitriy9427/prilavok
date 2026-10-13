import { useQuery } from '@tanstack/react-query'
import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router'
import type { ColumnVisibilityState, RowSelectionState } from '@tanstack/react-table'
import { ChevronLeftIcon, ChevronRightIcon, RefreshCwIcon } from 'lucide-react'
import { useState } from 'react'

import { useBulkStatus } from '@/api/mutations'
import { keys, ordersQuery } from '@/api/queries'
import { EmptyState, ErrorState, Page, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { OrdersTable, useOrdersTable } from '@/features/orders/orders-table'
import { ORDERS_DEFAULTS, PAGE_SIZES, activeFilters, ordersSearch, type OrdersSearch } from '@/features/orders/search'
import { OrdersToolbar } from '@/features/orders/toolbar'
import { useCan } from '@/lib/auth'
import { DELIVERY_LABELS, ORDER_STATUS_ACTIONS, ORDER_STATUS_LABELS, PAYMENT_LABELS, count, downloadFile, formatDateTime, formatNumber, toCsv, toDayKey } from '@/lib/format'
import { queryClient } from '@/lib/query-client'
import { useStore } from '@/lib/store'
import { live, liveStore } from '@/realtime/live'
import type { OrderStatus } from '@/shared/types'

export const Route = createFileRoute('/_app/orders/')({
  validateSearch: ordersSearch,
  // Значения по умолчанию в адрес не пишутся: /orders, а не /orders?page=0&size=20&sort=…
  search: { middlewares: [stripSearchParams(ORDERS_DEFAULTS)] },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(ordersQuery(deps)),
  component: OrdersPage,
})

/** Столбцы, скрытые по умолчанию. Выбор человека запоминается в браузере. */
const VISIBILITY_KEY = 'prilavok:orders:columns'
const loadVisibility = (): ColumnVisibilityState => {
  try {
    return JSON.parse(localStorage.getItem(VISIBILITY_KEY) ?? 'null') ?? { payment: false }
  } catch {
    return { payment: false }
  }
}

const BULK: OrderStatus[] = ['paid', 'packing', 'shipped', 'delivered', 'cancelled']

function OrdersPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const canUpdate = useCan('orders.update')
  const fresh = useStore(liveStore, (s) => s.fresh.length)

  const { data, error, isPending, isPlaceholderData, refetch } = useQuery(ordersQuery(search))
  const bulk = useBulkStatus()

  const [selection, setSelection] = useState<RowSelectionState>({})
  const [visibility, setVisibility] = useState(loadVisibility)

  const onSearch = (patch: Partial<OrdersSearch>) => {
    // Выбор относится к тому списку, который был на экране: сменился список — выбор сброшен.
    setSelection({})
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
  }

  const table = useOrdersTable({
    rows: data?.rows,
    rowCount: data?.rowCount ?? 0,
    search,
    onSearch,
    selection,
    onSelection: setSelection,
    visibility,
    onVisibility: (next) => {
      setVisibility(next)
      localStorage.setItem(VISIBILITY_KEY, JSON.stringify(next))
    },
    canSelect: canUpdate,
  })

  // Показать новые: перезапросить списки и перейти к началу «свежие сверху».
  const showFresh = () => {
    live.clearFresh()
    void queryClient.invalidateQueries({ queryKey: keys.orderLists })
    if (search.page !== 0 || search.sort !== 'createdAt' || search.dir !== 'desc') onSearch({ page: 0, sort: 'createdAt', dir: 'desc' })
  }
  const selectedIds = Object.keys(selection).filter((id) => selection[id])
  const pageCount = Math.max(1, Math.ceil((data?.rowCount ?? 0) / search.size))

  const exportCsv = () => {
    const rows = (data?.rows ?? []).map((o) => [
      o.number,
      formatDateTime(o.createdAt),
      o.customerName,
      o.city,
      ORDER_STATUS_LABELS[o.status],
      DELIVERY_LABELS[o.delivery],
      PAYMENT_LABELS[o.payment],
      o.itemsCount,
      o.total,
    ])
    downloadFile(`orders-${toDayKey(new Date())}.csv`, toCsv(['Номер', 'Создан', 'Клиент', 'Город', 'Статус', 'Доставка', 'Оплата', 'Позиций', 'Сумма'], rows))
  }

  return (
    <Page>
      <PageHeader
        title="Заказы"
        description={data ? `${count(data.rowCount, ['заказ', 'заказа', 'заказов'])}${activeFilters(search) ? ' по фильтрам' : ' за полгода'}` : 'Загрузка…'}
      />

      <OrdersToolbar search={search} onSearch={onSearch} onReset={() => onSearch({ status: [], q: '', from: '', to: '', page: 0 })} onExport={exportCsv} table={table} />

      {fresh > 0 && (
        // Таблицу под рукой у человека не меняем: он мог целиться в строку. Сообщаем и даём кнопку.
        <div role="status" className="slide-in flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/8 px-4 py-2 text-sm">
          <span className="pulse-dot size-2 rounded-full bg-primary" aria-hidden />
          <span>
            Пока вы здесь, {fresh === 1 ? 'пришёл' : 'пришло'} <b>{count(fresh, ['новый заказ', 'новых заказа', 'новых заказов'])}</b>
          </span>
          <Button size="sm" onClick={showFresh}>
            <RefreshCwIcon /> Показать
          </Button>
        </div>
      )}

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm">
          <span className="mr-1 font-medium">Выбрано: {selectedIds.length}</span>
          {BULK.map((status) => (
            <Button
              key={status}
              size="sm"
              variant={status === 'cancelled' ? 'destructive' : 'outline'}
              disabled={bulk.isPending}
              onClick={() => bulk.mutate({ ids: selectedIds, status }, { onSuccess: () => setSelection({}) })}
            >
              {ORDER_STATUS_ACTIONS[status]}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setSelection({})}>
            Снять выбор
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border bg-card">
        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isPending ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 10 }, (_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : data.rows.length === 0 ? (
          <EmptyState title="Ничего не найдено" description="Попробуйте изменить запрос или сбросить фильтры." />
        ) : (
          <OrdersTable table={table} dimmed={isPlaceholderData} />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="hidden sm:inline">Строк на странице</span>
            <Select value={String(search.size)} onValueChange={(value) => table.setPageSize(Number(value))}>
              <SelectTrigger size="sm" aria-label="Строк на странице" className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="tabular text-muted-foreground">
              Страница {formatNumber(search.page + 1)} из {formatNumber(pageCount)}
            </span>
            <Button variant="outline" size="icon" aria-label="Предыдущая страница" disabled={search.page === 0} onClick={() => table.previousPage()}>
              <ChevronLeftIcon />
            </Button>
            <Button variant="outline" size="icon" aria-label="Следующая страница" disabled={search.page + 1 >= pageCount} onClick={() => table.nextPage()}>
              <ChevronRightIcon />
            </Button>
          </div>
        </div>
      </div>
    </Page>
  )
}
