import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, stripSearchParams } from '@tanstack/react-router'
import { ArrowDownRightIcon, ArrowUpRightIcon } from 'lucide-react'
import { z } from 'zod'

import { statsQuery } from '@/api/queries'
import { Page, PageHeader } from '@/components/page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CategoryChart, RevenueChart, StatusChart } from '@/features/dashboard/charts'
import { LiveStrip } from '@/features/dashboard/live-strip'
import { OrderFeed } from '@/features/dashboard/order-feed'
import { count, formatMoney, formatNumber, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { StatsPeriod } from '@/shared/types'

const PERIODS: StatsPeriod[] = [7, 30, 90]

export const Route = createFileRoute('/_app/')({
  // Период — в адресе (?period=7): ссылкой можно поделиться, «назад» возвращает прошлый период.
  // .catch(30) — мусор в адресе (?period=abc) не ломает страницу, а заменяется значением по умолчанию.
  validateSearch: z.object({
    period: z
      .union([z.literal(7), z.literal(30), z.literal(90)])
      .default(30)
      .catch(30),
  }),
  search: { middlewares: [stripSearchParams({ period: 30 })] },
  // От чего зависит загрузчик: сменился период — он выполнится снова.
  loaderDeps: ({ search }) => ({ period: search.period }),
  // Загрузчик работает ДО показа экрана (и при наведении на ссылку): экран открывается уже с данными.
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(statsQuery(deps.period)),
  component: DashboardPage,
})

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-muted-foreground">нет данных для сравнения</span>
  const up = value >= 0
  const Icon = up ? ArrowUpRightIcon : ArrowDownRightIcon
  return (
    <span className={cn('tabular inline-flex items-center gap-0.5 text-xs font-medium', up ? 'text-success' : 'text-destructive')}>
      <Icon className="size-3.5" aria-hidden />
      {formatPercent(value)}
      <span className="font-normal text-muted-foreground">&nbsp;к прошлому периоду</span>
    </span>
  )
}

function DashboardPage() {
  const { period } = Route.useSearch()
  // Данные уже в кэше (их положил загрузчик) — useSuspenseQuery отдаёт их сразу, data не бывает undefined.
  const { data: stats } = useSuspenseQuery(statsQuery(period))
  const { kpi } = stats

  const cards = [
    { label: 'Выручка', value: formatMoney(kpi.revenue), delta: kpi.revenueDelta },
    { label: 'Заказы', value: formatNumber(kpi.orders), delta: kpi.ordersDelta },
    { label: 'Средний чек', value: formatMoney(kpi.avgCheck), delta: kpi.avgCheckDelta },
    { label: 'Покупателей', value: formatNumber(kpi.buyers), delta: kpi.buyersDelta },
  ]

  return (
    <Page>
      <PageHeader title="Дашборд" description="Что происходит в магазине: сейчас и за период">
        <div role="group" aria-label="Период" className="inline-flex rounded-lg border bg-card p-0.5">
          {PERIODS.map((value) => (
            <Link
              key={value}
              to="/"
              search={{ period: value }}
              // replace: переключение периода не засоряет историю браузера.
              replace
              aria-current={period === value ? 'true' : undefined}
              className={cn(
                'rounded-md px-3 py-1 text-sm transition-colors',
                period === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {count(value, ['день', 'дня', 'дней'])}
            </Link>
          ))}
        </div>
      </PageHeader>

      <LiveStrip />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader>
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="tabular text-2xl">{card.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <Delta value={card.delta} />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Выручка</CardTitle>
            <CardDescription>По дням, без отменённых заказов. Сегодняшний день ещё не закончился</CardDescription>
          </CardHeader>
          <CardContent>
            <RevenueChart series={stats.series} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Заказы по статусам</CardTitle>
            <CardDescription>Созданные за период</CardDescription>
          </CardHeader>
          <CardContent>
            <StatusChart byStatus={stats.byStatus} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="gap-0 pb-0 lg:col-span-1">
          <CardHeader className="pb-4">
            <CardTitle>Лента заказов</CardTitle>
            <CardDescription>Новые появляются сами — по WebSocket</CardDescription>
          </CardHeader>
          <OrderFeed />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Популярные товары</CardTitle>
            <CardDescription>По выручке за период</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3">
              {stats.topProducts.map((product, i) => (
                <li key={product.id} className="flex items-center gap-3 text-sm">
                  <span className="tabular w-4 text-muted-foreground">{i + 1}</span>
                  <Link to="/products/$productId" params={{ productId: product.id }} className="min-w-0 flex-1 truncate font-medium hover:underline">
                    {product.title}
                  </Link>
                  <span className="tabular text-muted-foreground">{formatNumber(product.qty)} шт.</span>
                  <span className="tabular w-20 text-right font-medium">{formatMoney(product.revenue)}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Категории</CardTitle>
            <CardDescription>Выручка за период</CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryChart byCategory={stats.byCategory} />
          </CardContent>
        </Card>
      </div>
    </Page>
  )
}
