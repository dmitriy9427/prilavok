import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { ArrowLeftIcon, CheckIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { ApiError } from '@/api/http'
import { useOrderStatus } from '@/api/mutations'
import { orderQuery } from '@/api/queries'
import { ErrorState, Page } from '@/components/page'
import { STATUS_DOT, StatusBadge } from '@/components/status-badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Notes } from '@/features/orders/notes'
import { Presence, usePresence } from '@/features/orders/presence'
import { useCan, useUser } from '@/lib/auth'
import { DELIVERY_LABELS, ORDER_STATUS_ACTIONS, ORDER_STATUS_LABELS, PAYMENT_LABELS, SEGMENT_LABELS, count, formatDateTime, formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useRealtimeEvent } from '@/realtime/hooks'
import { STATUS_FLOW } from '@/shared/schemas'

export const Route = createFileRoute('/_app/orders/$orderId')({
  loader: async ({ context, params }) => {
    try {
      return await context.queryClient.ensureQueryData(orderQuery(params.orderId))
    } catch (error) {
      // 404 от API превращаем в «страница не найдена» роутера — сработает notFoundComponent.
      if (error instanceof ApiError && error.status === 404) throw notFound()
      throw error
    }
  },
  component: OrderPage,
  errorComponent: ({ error, reset }) => (
    <Page>
      <ErrorState error={error instanceof Error ? error : new Error(String(error))} onRetry={reset} />
    </Page>
  ),
  notFoundComponent: () => (
    <Page className="items-center py-20 text-center">
      <p className="text-lg font-medium">Заказ не найден</p>
      <Button asChild variant="outline">
        <Link to="/orders">К списку заказов</Link>
      </Button>
    </Page>
  ),
})

function OrderPage() {
  const { orderId } = Route.useParams()
  const { data } = useSuspenseQuery(orderQuery(orderId))
  const { order, notes, customer } = data
  const me = useUser()
  const canUpdate = useCan('orders.update')
  const status = useOrderStatus(orderId)
  const viewers = usePresence(orderId)

  // Кэш уже обновил sync.ts; здесь — только сообщить человеку, что заказ изменили не мы.
  useRealtimeEvent('order.updated', (event) => {
    if (event.id === orderId && event.by !== me?.name)
      toast.info(`${event.by}: ${ORDER_STATUS_LABELS[event.status].toLowerCase()}`, { description: `Заказ ${order.number} изменён` })
  })

  const next = STATUS_FLOW[order.status]

  return (
    <Page>
      <div className="flex flex-col gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2 self-start text-muted-foreground">
          <Link to="/orders">
            <ArrowLeftIcon /> Заказы
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Заказ {order.number}</h1>
          <StatusBadge status={order.status} />
          <span className="text-sm text-muted-foreground">создан {formatDateTime(order.createdAt)}</span>
        </div>
        <Presence users={viewers} />
      </div>

      {canUpdate && next.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {next.map((target) =>
            target === 'cancelled' ? (
              // Необратимое действие — с подтверждением.
              <AlertDialog key={target}>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" disabled={status.isPending}>
                    {ORDER_STATUS_ACTIONS[target]}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Отменить заказ {order.number}?</AlertDialogTitle>
                    <AlertDialogDescription>Отменённый заказ нельзя вернуть в работу. Клиент получит уведомление об отмене.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Не отменять</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => status.mutate({ status: target, version: order.version })}>
                      Отменить заказ
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <Button key={target} disabled={status.isPending} onClick={() => status.mutate({ status: target, version: order.version })}>
                {status.isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
                {ORDER_STATUS_ACTIONS[target]}
              </Button>
            ),
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Состав</CardTitle>
              <CardDescription>{count(order.items.length, ['позиция', 'позиции', 'позиций'])}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {order.items.map((item) => (
                  <li key={item.productId + item.title} className="flex items-center gap-3 py-2.5 text-sm first:pt-0">
                    <Link to="/products/$productId" params={{ productId: item.productId }} className="min-w-0 flex-1 truncate font-medium hover:underline">
                      {item.title}
                    </Link>
                    <span className="tabular text-muted-foreground">
                      {item.qty} × {formatMoney(item.price)}
                    </span>
                    <span className="tabular w-24 text-right font-medium">{formatMoney(item.qty * item.price)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center justify-between border-t pt-3">
                <span className="text-sm text-muted-foreground">Итого</span>
                <span className="tabular text-lg font-semibold">{formatMoney(order.total)}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="gap-0 pb-0">
            <CardHeader className="pb-3">
              <CardTitle>Заметки команды</CardTitle>
              <CardDescription>В реальном времени: их сразу видят все, кто открыл заказ</CardDescription>
            </CardHeader>
            <Notes orderId={orderId} notes={notes} />
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Клиент</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 text-sm">
              <p className="font-medium">{order.customerName}</p>
              {customer && (
                <>
                  <a href={`tel:${customer.phone.replace(/[^\d+]/g, '')}`} className="text-muted-foreground hover:text-foreground">
                    {customer.phone}
                  </a>
                  <a href={`mailto:${customer.email}`} className="truncate text-muted-foreground hover:text-foreground">
                    {customer.email}
                  </a>
                  <p className="mt-1 text-muted-foreground">
                    {SEGMENT_LABELS[customer.segment]} · {count(customer.ordersCount, ['заказ', 'заказа', 'заказов'])} на {formatMoney(customer.totalSpent)}
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Доставка и оплата</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Город</dt>
                <dd>{order.city}</dd>
                <dt className="text-muted-foreground">Доставка</dt>
                <dd>{DELIVERY_LABELS[order.delivery]}</dd>
                <dt className="text-muted-foreground">Оплата</dt>
                <dd>{PAYMENT_LABELS[order.payment]}</dd>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>История</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col">
                {order.history.map((entry, i) => (
                  <li key={entry.at + entry.status} className="slide-in relative flex gap-3 pb-4 last:pb-0">
                    {i < order.history.length - 1 && <span className="absolute top-3 left-[5px] h-full w-px bg-border" aria-hidden />}
                    <span className={cn('relative mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-card', STATUS_DOT[entry.status])} aria-hidden />
                    <div className="text-sm">
                      <p className="font-medium">{ORDER_STATUS_LABELS[entry.status]}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(entry.at)} · {entry.by}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </Page>
  )
}
