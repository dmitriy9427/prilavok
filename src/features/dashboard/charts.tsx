/**
 * Графики дашборда (Recharts).
 *
 * Цвета берутся из CSS-переменных темы (var(--chart-1)…): тёмная тема
 * перекрашивает графики сама, без кода. Recharts рисует SVG, а в SVG
 * переменные работают так же, как в HTML.
 */
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { STATUS_DOT } from '@/components/status-badge'
import { CATEGORY_LABELS, ORDER_STATUS_LABELS, count, formatCompact, formatDay, formatMoney, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ORDER_STATUSES, type OrderStatus, type Stats } from '@/shared/types'

const STATUS_COLORS: Record<OrderStatus, string> = {
  new: 'var(--info)',
  paid: 'var(--chart-3)',
  packing: 'var(--warning)',
  shipped: 'var(--chart-2)',
  delivered: 'var(--success)',
  cancelled: 'var(--destructive)',
}

const tooltipStyle = {
  contentStyle: { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--popover-foreground)' },
  labelStyle: { color: 'var(--muted-foreground)', marginBottom: 2 },
  itemStyle: { color: 'var(--popover-foreground)' },
}

export function RevenueChart({ series }: { series: Stats['series'] }) {
  const total = series.reduce((sum, point) => sum + point.revenue, 0)
  return (
    // График — картинка: скринридеру нужна текстовая замена.
    <div role="img" aria-label={`Выручка по дням за ${count(series.length, ['день', 'дня', 'дней'])}, всего ${formatMoney(total)}`} className="h-72 w-full">
      <ResponsiveContainer>
        <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="day" tickFormatter={formatDay} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} minTickGap={32} />
          <YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} width={60} />
          <Tooltip
            {...tooltipStyle}
            cursor={{ stroke: 'var(--border)' }}
            labelFormatter={(day) => formatDay(String(day))}
            formatter={(value, name) => (name === 'revenue' ? [formatMoney(Number(value)), 'Выручка'] : [formatNumber(Number(value)), 'Заказов'])}
          />
          <Area type="monotone" dataKey="revenue" stroke="var(--chart-1)" strokeWidth={2} fill="url(#revenue-fill)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function StatusChart({ byStatus }: { byStatus: Stats['byStatus'] }) {
  // Порядок сегментов — как у жизненного цикла заказа, а не «как пришло с сервера».
  const data = ORDER_STATUSES.map((status) => ({ status, count: byStatus.find((item) => item.status === status)?.count ?? 0 })).filter((item) => item.count > 0)
  const total = data.reduce((sum, item) => sum + item.count, 0)

  return (
    <div className="flex flex-col items-center gap-5">
      <div role="img" aria-label={`Заказы по статусам, всего ${total}`} className="relative size-44 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="status" innerRadius={56} outerRadius={84} paddingAngle={2} strokeWidth={0} isAnimationActive={false}>
              {data.map((item) => (
                <Cell key={item.status} fill={STATUS_COLORS[item.status]} />
              ))}
            </Pie>
            <Tooltip {...tooltipStyle} formatter={(value, name) => [formatNumber(Number(value)), ORDER_STATUS_LABELS[name as OrderStatus]]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular text-2xl font-semibold">{formatNumber(total)}</span>
          <span className="text-xs text-muted-foreground">всего</span>
        </div>
      </div>
      {/* Легенда — настоящая таблица значений: это и подпись, и доступная замена диаграмме. */}
      <ul className="grid w-full gap-1.5 text-sm">
        {data.map((item) => (
          <li key={item.status} className="flex items-center gap-2">
            <span className={cn('size-2 rounded-full', STATUS_DOT[item.status])} aria-hidden />
            <span className="flex-1 text-muted-foreground">{ORDER_STATUS_LABELS[item.status]}</span>
            <span className="tabular font-medium">{formatNumber(item.count)}</span>
            <span className="tabular w-10 text-right text-xs text-muted-foreground">{Math.round((item.count / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function CategoryChart({ byCategory }: { byCategory: Stats['byCategory'] }) {
  const data = byCategory.map((item) => ({ ...item, label: CATEGORY_LABELS[item.category] }))
  return (
    <div role="img" aria-label={`Выручка по категориям: ${data.map((d) => `${d.label} — ${formatMoney(d.revenue)}`).join(', ')}`} className="h-52 w-full">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={150} tick={{ fontSize: 13, fill: 'var(--foreground)' }} />
          <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--muted)' }} formatter={(value) => [formatMoney(Number(value)), 'Выручка']} />
          <Bar dataKey="revenue" radius={6} barSize={18} isAnimationActive={false}>
            {data.map((item, i) => (
              <Cell key={item.category} fill={`var(--chart-${(i % 5) + 1})`} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
