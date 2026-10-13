/**
 * Таблица заказов (TanStack Table v9).
 *
 * TanStack Table — «безголовая» библиотека: она не рисует ни одного тега.
 * Она считает МОДЕЛЬ таблицы (какие столбцы видны, как отсортировано, что
 * выбрано), а разметку пишем мы. Поэтому таблица выглядит как остальной
 * интерфейс, а не как чужой виджет.
 *
 * ─── Серверный режим ────────────────────────────────────────────────────────
 * Заказов тысячи — на клиент приходит одна страница. Значит, сортировать и
 * листать должен сервер. Флаги manualSorting / manualPagination говорят
 * таблице: «не обрабатывай строки сама, просто покажи то, что дали, и сообщи,
 * когда человек захочет другую сортировку или страницу». Мы в ответ меняем
 * адрес страницы → меняется ключ запроса → Query идёт на сервер.
 *
 * ─── Стабильные ссылки ──────────────────────────────────────────────────────
 * features и columns объявлены на уровне модуля, а пустой массив — константа.
 * Если создавать их в компоненте, каждая перерисовка давала бы таблице
 * «новые» столбцы и данные, и она пересчитывала бы модель впустую.
 */
import { Link } from '@tanstack/react-router'
import {
  columnVisibilityFeature,
  createColumnHelper,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type RowSelectionState,
  type SortingState,
  type Updater,
  type ColumnVisibilityState,
} from '@tanstack/react-table'
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react'

import { StatusBadge } from '@/components/status-badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DELIVERY_LABELS, PAYMENT_LABELS, formatDateTime, formatMoney } from '@/lib/format'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { isRecent, liveStore } from '@/realtime/live'
import type { OrderRow } from '@/shared/types'

import type { OrdersSearch } from './search'

export const features = tableFeatures({ rowSortingFeature, rowPaginationFeature, rowSelectionFeature, columnVisibilityFeature })
const helper = createColumnHelper<typeof features, OrderRow>()

/** Подписи столбцов — для заголовков и меню «Столбцы». */
export const COLUMN_LABELS: Record<string, string> = {
  number: 'Номер',
  createdAt: 'Создан',
  customerName: 'Клиент',
  itemsCount: 'Позиций',
  delivery: 'Доставка',
  payment: 'Оплата',
  status: 'Статус',
  total: 'Сумма',
}

const columns = helper.columns([
  helper.display({
    id: 'select',
    enableHiding: false,
    header: ({ table }) => (
      <Checkbox
        aria-label="Выбрать все заказы на странице"
        checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? 'indeterminate' : false}
        onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked === true)}
      />
    ),
    cell: ({ row }) => (
      <Checkbox aria-label={`Выбрать заказ ${row.original.number}`} checked={row.getIsSelected()} onCheckedChange={(checked) => row.toggleSelected(checked === true)} />
    ),
  }),
  helper.accessor('number', {
    enableHiding: false,
    cell: ({ row }) => (
      <Link to="/orders/$orderId" params={{ orderId: row.original.id }} className="font-medium hover:underline">
        {row.original.number}
      </Link>
    ),
  }),
  helper.accessor('createdAt', { cell: ({ getValue }) => <span className="tabular whitespace-nowrap text-muted-foreground">{formatDateTime(getValue())}</span> }),
  helper.accessor('customerName', {
    cell: ({ row }) => (
      <div className="min-w-36">
        <div className="truncate">{row.original.customerName}</div>
        <div className="truncate text-xs text-muted-foreground">{row.original.city}</div>
      </div>
    ),
  }),
  helper.accessor('itemsCount', { enableSorting: false, cell: ({ getValue }) => <span className="tabular">{getValue()}</span> }),
  helper.accessor('delivery', { enableSorting: false, cell: ({ getValue }) => DELIVERY_LABELS[getValue()] }),
  helper.accessor('payment', { enableSorting: false, cell: ({ getValue }) => PAYMENT_LABELS[getValue()] }),
  helper.accessor('status', { cell: ({ getValue }) => <StatusBadge status={getValue()} /> }),
  helper.accessor('total', { cell: ({ getValue }) => <span className="tabular font-medium whitespace-nowrap">{formatMoney(getValue())}</span> }),
])

const NUMERIC = new Set(['total', 'itemsCount'])
const EMPTY: OrderRow[] = []

/** Применить «обновление» таблицы: она присылает либо новое значение, либо функцию от старого. */
const resolve = <T,>(updater: Updater<T>, current: T): T => (typeof updater === 'function' ? (updater as (old: T) => T)(current) : updater)

type Props = {
  rows: OrderRow[] | undefined
  rowCount: number
  search: OrdersSearch
  onSearch: (patch: Partial<OrdersSearch>) => void
  selection: RowSelectionState
  onSelection: (selection: RowSelectionState) => void
  visibility: ColumnVisibilityState
  onVisibility: (visibility: ColumnVisibilityState) => void
  canSelect: boolean
  /** Идёт загрузка другой страницы — показываем прежнюю приглушённой. */
  dimmed: boolean
}

export function useOrdersTable({ rows, rowCount, search, onSearch, selection, onSelection, visibility, onVisibility, canSelect }: Omit<Props, 'dimmed'>) {
  const sorting: SortingState = [{ id: search.sort, desc: search.dir === 'desc' }]
  const pagination = { pageIndex: search.page, pageSize: search.size }

  return useTable({
    features,
    columns,
    data: rows ?? EMPTY,
    rowCount,
    // Свой id строки вместо номера по порядку: выбор «помнит» заказ, а не «третью строку».
    getRowId: (row) => row.id,
    manualSorting: true,
    manualPagination: true,
    // Сортировку нельзя «снять»: у серверного списка всегда должен быть порядок.
    enableSortingRemoval: false,
    enableRowSelection: canSelect,
    state: { sorting, pagination, rowSelection: selection, columnVisibility: { ...visibility, select: canSelect } },
    onSortingChange: (updater) => {
      const next = resolve(updater, sorting)[0]
      // Новая сортировка — снова с первой страницы.
      if (next) onSearch({ sort: next.id as OrdersSearch['sort'], dir: next.desc ? 'desc' : 'asc', page: 0 })
    },
    onPaginationChange: (updater) => {
      const next = resolve(updater, pagination)
      onSearch({ page: next.pageSize === pagination.pageSize ? next.pageIndex : 0, size: next.pageSize as OrdersSearch['size'] })
    },
    onRowSelectionChange: (updater) => onSelection(resolve(updater, selection)),
    onColumnVisibilityChange: (updater) => onVisibility(resolve(updater, visibility)),
  })
}

export function OrdersTable({
  table,
  dimmed,
  highlighted,
}: {
  table: ReturnType<typeof useOrdersTable>
  dimmed: boolean
  /** Заказы, показанные по кнопке «Показать новые». */ highlighted: Set<string>
}) {
  const touched = useStore(liveStore, (s) => s.touched)

  return (
    <Table className={cn('transition-opacity', dimmed && 'opacity-60')} aria-busy={dimmed}>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="hover:bg-transparent">
            {group.headers.map((header) => {
              const sorted = header.column.getIsSorted()
              const label = COLUMN_LABELS[header.column.id]
              return (
                <TableHead
                  key={header.id}
                  className={cn(NUMERIC.has(header.column.id) && 'text-right', header.column.id === 'select' && 'w-10')}
                  // aria-sort сообщает скринридеру, по какому столбцу и как отсортировано.
                  aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                >
                  {header.column.id === 'select' ? (
                    <table.FlexRender header={header} />
                  ) : header.column.getCanSort() ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className={cn('-mx-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 hover:bg-muted', sorted && 'text-foreground')}
                    >
                      {label}
                      {sorted === 'asc' ? (
                        <ArrowUpIcon className="size-3.5" />
                      ) : sorted === 'desc' ? (
                        <ArrowDownIcon className="size-3.5" />
                      ) : (
                        <ArrowUpDownIcon className="size-3.5 opacity-40" />
                      )}
                    </button>
                  ) : (
                    label
                  )}
                </TableHead>
              )
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow
            // Метка времени в key: строку изменило событие из сокета → React создаёт её заново → анимация подсветки играет.
            key={`${row.id}:${touched[row.id] ?? 0}`}
            data-state={row.getIsSelected() ? 'selected' : undefined}
            // Отметка «новый»: полоска слева и лёгкий фон — держится, пока человек её не снимет.
            className={cn(isRecent(touched[row.id]) && 'flash-row', highlighted.has(row.id) && 'bg-primary/10 shadow-[inset_3px_0_0_var(--primary)]')}
          >
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id} className={cn(NUMERIC.has(cell.column.id) && 'text-right')}>
                <table.FlexRender cell={cell} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
