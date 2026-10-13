/**
 * Экран «Соединение» — WebSocket под микроскопом.
 *
 * Обычно всё это скрыто: соединение рвётся и чинится, а человек видит только
 * актуальные данные. Здесь можно сломать связь нарочно и посмотреть по кадрам,
 * как клиент её восстанавливает.
 */
import { createFileRoute } from '@tanstack/react-router'
import { ArrowDownIcon, ArrowUpIcon, CircleDotIcon, PauseIcon, PlayIcon, Trash2Icon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { ConnectionDot, STATUS_TEXT } from '@/components/connection'
import { Page, PageHeader } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { USE_MOCK, WS_URL } from '@/config'
import { formatClock } from '@/lib/format'
import { useMockControls } from '@/lib/mock-controls'
import { cn } from '@/lib/utils'
import type { FrameLogEntry, RealtimeStatus } from '@/realtime/client'
import { useFrameLog, useRealtimeStatus } from '@/realtime/hooks'
import { realtime } from '@/realtime/instance'

export const Route = createFileRoute('/_app/realtime')({ component: RealtimePage })

// ─── Состояние ─────────────────────────────────────────────────────────────────

/** Путь подключения — подсвечиваем текущий шаг. */
const STEPS: { status: RealtimeStatus[]; label: string; hint: string }[] = [
  { status: ['connecting'], label: 'Подключение', hint: 'открываем соединение' },
  { status: ['handshaking'], label: 'Рукопожатие', hint: 'hello → welcome' },
  { status: ['online'], label: 'На связи', hint: 'события идут' },
]

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular truncate font-medium">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  )
}

/** Сколько секунд осталось до момента time (обновляется 10 раз в секунду, пока идёт отсчёт). */
function useSecondsUntil(time: number | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (time === null) return
    const timer = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(timer)
  }, [time])
  return time === null ? null : Math.max(0, (time - now) / 1000)
}

function StatusCard() {
  const state = useRealtimeStatus()
  const seconds = useSecondsUntil(state.retryAt)
  const broken = state.status === 'reconnecting' || state.status === 'offline'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ConnectionDot status={state.status} className="size-2.5" />
          {STATUS_TEXT[state.status]}
        </CardTitle>
        <CardDescription className="truncate font-mono text-xs">{WS_URL}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ol className="grid grid-cols-3 gap-2">
          {STEPS.map((step, i) => {
            const active = step.status.includes(state.status)
            const done = state.status === 'online' || (state.status === 'handshaking' && i === 0)
            return (
              <li
                key={step.label}
                className={cn('rounded-lg border px-3 py-2 text-sm transition-colors', active ? 'border-primary bg-primary/8' : done ? 'text-foreground' : 'text-muted-foreground')}
              >
                <span className="block font-medium">{step.label}</span>
                <span className="block text-xs text-muted-foreground">{step.hint}</span>
              </li>
            )
          })}
        </ol>

        {broken && (
          <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            {state.status === 'offline'
              ? 'Сети нет — попытки не тратим, ждём, когда она вернётся.'
              : `Попытка №${state.attempt} через ${seconds?.toFixed(1) ?? '…'} с. Пауза растёт с каждой неудачей: 0,5 → 1 → 2 → 4 … до 30 с.`}
            {state.lastError && <span className="block text-xs text-muted-foreground">Причина: {state.lastError}</span>}
          </p>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
          <Stat label="Задержка (ping → pong)" value={state.latency === null ? '—' : `${state.latency} мс`} />
          <Stat label="Сессия" value={state.sessionId ?? '—'} hint="новая после каждого подключения" />
          <Stat label="Эпоха сервера" value={state.epoch ?? '—'} hint="меняется при его перезапуске" />
          <Stat label="Номер события (seq)" value={state.seq ?? '—'} hint="«закладка» для докачки" />
          <Stat label="Переподключений" value={state.reconnects} />
          <Stat label="Полных обновлений" value={state.resyncs} hint="когда докачать не удалось" />
        </dl>

        <div>
          <p className="mb-1.5 text-xs text-muted-foreground">Каналы — подписки меняются, когда вы ходите по экранам</p>
          <div className="flex flex-wrap gap-1.5">
            {state.channels.length ? (
              state.channels.map((channel) => (
                <Badge key={channel} variant="secondary" className="font-mono">
                  {channel}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">нет подписок</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Опыты ─────────────────────────────────────────────────────────────────────

function Experiment({ title, watch, children }: { title: string; watch: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{watch}</p>
      </div>
      {children}
    </li>
  )
}

function Experiments() {
  const controls = useMockControls()
  const [muted, setMuted] = useState(() => realtime.debug.isMuted())
  const [offline, setOffline] = useState(false)
  // Этот рычаг НЕ сбрасывается при уходе с экрана: смысл опыта — походить по экранам со сломанным сервером.
  const [failing, setFailing] = useState(false)
  const [syncedControls, setSyncedControls] = useState(controls)
  if (controls !== syncedControls) {
    setSyncedControls(controls)
    setFailing(controls?.isFailingHttp() ?? false)
  }

  // Уходим с экрана — возвращаем всё как было: «сломанная» связь не должна остаться незаметно.
  useEffect(
    () => () => {
      realtime.debug.mute(false)
      realtime.debug.offline(false)
    },
    [],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Опыты</CardTitle>
        <CardDescription>Сломайте связь и смотрите в журнал ниже</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          <Experiment title="Оборвать соединение" watch="close → пауза → hello с закладкой → welcome (resumed: true) → пропущенные события">
            <Button variant="outline" size="sm" onClick={() => realtime.debug.drop()}>
              Оборвать
            </Button>
          </Experiment>
          <Experiment title="Сервер молчит" watch="Соединение «открыто», но кадры не ходят. Через 15 с уйдёт ping, ещё через 5 с клиент признает связь мёртвой">
            <div className="flex items-center gap-2">
              <Label htmlFor="mute" className="sr-only">
                Сервер молчит
              </Label>
              <Switch
                id="mute"
                checked={muted}
                onCheckedChange={(on) => {
                  setMuted(on)
                  realtime.debug.mute(on)
                }}
              />
            </div>
          </Experiment>
          <Experiment title="Нет сети" watch="Клиент не тратит попытки и не ждёт таймаутов. Включите обратно — подключится сразу">
            <div className="flex items-center gap-2">
              <Label htmlFor="offline" className="sr-only">
                Нет сети
              </Label>
              <Switch
                id="offline"
                checked={offline}
                onCheckedChange={(on) => {
                  setOffline(on)
                  realtime.debug.offline(on)
                }}
              />
            </div>
          </Experiment>
          {controls ? (
            <>
              <Experiment title="Перезапустить сервер" watch="Эпоха меняется, буфер событий пуст → welcome (resumed: false) → клиент перезапрашивает все данные по HTTP">
                <Button variant="outline" size="sm" onClick={() => controls.restartServer()}>
                  Перезапустить
                </Button>
              </Experiment>
              <Experiment
                title="Сервер отвечает ошибкой"
                watch="Все HTTP-запросы получают 500. Откройте любой экран — увидите «Не удалось загрузить». Выключите и нажмите «Повторить»"
              >
                <div className="flex items-center gap-2">
                  <Label htmlFor="fail-http" className="sr-only">
                    Сервер отвечает ошибкой
                  </Label>
                  <Switch
                    id="fail-http"
                    checked={failing}
                    onCheckedChange={(on) => {
                      setFailing(on)
                      controls.failHttp(on)
                    }}
                  />
                </div>
              </Experiment>
              <Experiment title="Создать заказ" watch="Событие order.created в канале orders: счётчик в меню, лента на дашборде">
                <Button variant="outline" size="sm" onClick={() => controls.newOrder()}>
                  Создать
                </Button>
              </Experiment>
            </>
          ) : (
            !USE_MOCK && (
              <li className="py-3 text-xs text-muted-foreground">
                Настоящий сервер: остановите его (Ctrl+C в терминале) и запустите снова — увидите смену эпохи. Кадры видны и в DevTools → Network → WS → Messages.
              </li>
            )
          )}
        </ul>
      </CardContent>
    </Card>
  )
}

// ─── Журнал кадров ─────────────────────────────────────────────────────────────

const NOISE = new Set(['ping', 'pong', 'metrics.tick'])

function FrameRow({ frame }: { frame: FrameLogEntry }) {
  const Icon = frame.dir === 'out' ? ArrowUpIcon : frame.dir === 'in' ? ArrowDownIcon : CircleDotIcon
  return (
    <li className={cn('grid grid-cols-[6.5rem_1.25rem_7.5rem_minmax(0,1fr)] items-baseline gap-2 px-3 py-1 font-mono text-xs', frame.dir === 'sys' && 'bg-muted/60')}>
      <span className="tabular text-muted-foreground">{formatClock(frame.at)}</span>
      <Icon
        className={cn('size-3.5 self-center', frame.dir === 'out' ? 'text-chart-2' : frame.dir === 'in' ? 'text-success' : 'text-warning')}
        aria-label={frame.dir === 'out' ? 'отправлен' : frame.dir === 'in' ? 'получен' : 'событие соединения'}
      />
      <span className="truncate font-semibold">{frame.kind}</span>
      <span className={cn('truncate', frame.dir === 'sys' ? 'font-sans text-foreground' : 'text-muted-foreground')} title={frame.text}>
        {frame.text}
      </span>
    </li>
  )
}

function FrameLog() {
  const frames = useFrameLog()
  const [quiet, setQuiet] = useState(true)
  const [paused, setPaused] = useState(false)
  // На паузе показываем снимок на момент остановки — чтобы спокойно читать.
  const [frozen, setFrozen] = useState<FrameLogEntry[]>([])
  const listRef = useRef<HTMLOListElement>(null)

  const source = paused ? frozen : frames
  const visible = quiet ? source.filter((frame) => !NOISE.has(frame.kind)) : source

  // Новый кадр — прокручиваем к нему, но только если человек и так смотрел в конец.
  const stick = useRef(true)
  useEffect(() => {
    if (stick.current) listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [visible.length])

  return (
    <Card className="gap-0 pb-0">
      <CardHeader className="pb-4">
        <CardTitle>Журнал кадров</CardTitle>
        <CardDescription>
          <ArrowUpIcon className="inline size-3.5 text-chart-2" /> отправили · <ArrowDownIcon className="inline size-3.5 text-success" /> получили ·{' '}
          <CircleDotIcon className="inline size-3.5 text-warning" /> событие соединения
        </CardDescription>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <div className="flex items-center gap-2">
            <Switch id="quiet" checked={quiet} onCheckedChange={setQuiet} />
            <Label htmlFor="quiet" className="text-sm font-normal">
              Скрыть ping, pong и метрики
            </Label>
          </div>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFrozen(frames)
                setPaused((value) => !value)
              }}
            >
              {paused ? <PlayIcon /> : <PauseIcon />} {paused ? 'Продолжить' : 'Пауза'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => realtime.clearFrames()}>
              <Trash2Icon /> Очистить
            </Button>
          </div>
        </div>
      </CardHeader>
      {visible.length === 0 ? (
        <p className="border-t px-4 py-10 text-center text-sm text-muted-foreground">Кадров пока нет</p>
      ) : (
        <ol
          ref={listRef}
          onScroll={(event) => {
            const el = event.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          }}
          className="h-96 divide-y overflow-y-auto border-t"
        >
          {visible.map((frame) => (
            <FrameRow key={frame.id} frame={frame} />
          ))}
        </ol>
      )}
    </Card>
  )
}

function RealtimePage() {
  return (
    <Page>
      <PageHeader title="Соединение" description={`WebSocket под микроскопом · ${USE_MOCK ? 'сервер изображает MSW в браузере' : 'настоящий сервер на Node'}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <StatusCard />
        <Experiments />
      </div>
      <FrameLog />
    </Page>
  )
}
