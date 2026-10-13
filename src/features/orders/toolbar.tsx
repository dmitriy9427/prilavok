import { ChevronDownIcon, Columns3Icon, DownloadIcon, SearchIcon, XIcon } from 'lucide-react'

import { STATUS_DOT } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ORDER_STATUS_LABELS } from '@/lib/format'
import { useDebouncedInput } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { ORDER_STATUSES, type OrderStatus } from '@/shared/types'

import { COLUMN_LABELS, type useOrdersTable } from './orders-table'
import { activeFilters, type OrdersSearch } from './search'

type Props = {
  search: OrdersSearch
  onSearch: (patch: Partial<OrdersSearch>) => void
  onReset: () => void
  onExport: () => void
  table: ReturnType<typeof useOrdersTable>
}

export function OrdersToolbar({ search, onSearch, onReset, onExport, table }: Props) {
  // Любой фильтр возвращает на первую страницу: на «странице 7» нового списка может не быть вовсе.
  const filter = (patch: Partial<OrdersSearch>) => onSearch({ ...patch, page: 0 })
  const [text, setText] = useDebouncedInput(search.q, (q) => filter({ q }))
  const filters = activeFilters(search)

  const toggleStatus = (status: OrderStatus, on: boolean) => filter({ status: on ? [...search.status, status] : search.status.filter((s) => s !== status) })

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-52 flex-1 sm:max-w-xs">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" value={text} onChange={(event) => setText(event.target.value)} placeholder="Номер, клиент или город" aria-label="Поиск по заказам" className="pl-8" />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            Статус
            {search.status.length > 0 && <span className="rounded bg-primary px-1.5 text-xs text-primary-foreground">{search.status.length}</span>}
            <ChevronDownIcon className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {ORDER_STATUSES.map((status) => (
            <DropdownMenuCheckboxItem
              key={status}
              checked={search.status.includes(status)}
              onCheckedChange={(checked) => toggleStatus(status, checked)}
              // Меню не закрывается после выбора: статусов обычно отмечают несколько.
              onSelect={(event) => event.preventDefault()}
            >
              <span className={cn('size-2 rounded-full', STATUS_DOT[status])} aria-hidden />
              {ORDER_STATUS_LABELS[status]}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex items-center gap-1.5">
        <Input type="date" value={search.from} max={search.to || undefined} onChange={(event) => filter({ from: event.target.value })} aria-label="Создан с" className="w-36" />
        <span className="text-muted-foreground" aria-hidden>
          —
        </span>
        <Input type="date" value={search.to} min={search.from || undefined} onChange={(event) => filter({ to: event.target.value })} aria-label="Создан по" className="w-36" />
      </div>

      {filters > 0 && (
        <Button variant="ghost" onClick={onReset}>
          <XIcon /> Сбросить
        </Button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Столбцы">
              <Columns3Icon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel>Столбцы</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table
              .getAllLeafColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(checked) => column.toggleVisibility(checked)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {COLUMN_LABELS[column.id]}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" onClick={onExport}>
          <DownloadIcon /> <span className="hidden sm:inline">CSV</span>
        </Button>
      </div>
    </div>
  )
}
