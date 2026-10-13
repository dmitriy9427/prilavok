import { useQueryErrorResetBoundary } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { AlertTriangleIcon, InboxIcon, Loader2Icon } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Заголовок экрана: название, пояснение и действия справа. */
export function PageHeader({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6', className)}>{children}</div>
}

/** «Здесь пока пусто» — с подсказкой, что делать дальше. */
export function EmptyState({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <InboxIcon className="size-8 text-muted-foreground/60" aria-hidden />
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {children && <div className="mt-2">{children}</div>}
    </div>
  )
}

/**
 * Ошибка загрузки — с кнопкой «Повторить».
 *
 * retrying — повтор уже идёт. Запрос при сбое сам пробует ещё дважды с паузами, это несколько
 * секунд: без отклика на нажатие кажется, что кнопка не работает.
 */
export function ErrorState({ error, onRetry, retrying = false }: { error: Error; onRetry?: () => void; retrying?: boolean }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <AlertTriangleIcon className="size-8 text-destructive" aria-hidden />
      <p className="font-medium">Не удалось загрузить</p>
      <p className="max-w-sm text-sm text-muted-foreground">{error.message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry} disabled={retrying}>
          {retrying && <Loader2Icon className="animate-spin" />}
          {retrying ? 'Загружаем…' : 'Повторить'}
        </Button>
      )}
    </div>
  )
}

/**
 * Ошибка загрузки целого экрана (упал загрузчик маршрута или useSuspenseQuery).
 *
 * «Повторить» здесь — не просто «перерисовать». Ошибку запомнили трое:
 *   - роутер (результат загрузчика),
 *   - TanStack Query (упавший запрос),
 *   - граница ошибок React.
 * Сбросить нужно всех: иначе кнопка нажимается, а экран остаётся прежним.
 * router.invalidate() заново выполняет загрузчики и сбрасывает границу ошибок.
 */
export function RouteError({ error }: { error: unknown }) {
  const router = useRouter()
  const queryErrors = useQueryErrorResetBoundary()
  const [retrying, setRetrying] = useState(false)
  return (
    <Page>
      <ErrorState
        error={error instanceof Error ? error : new Error(String(error))}
        retrying={retrying}
        onRetry={() => {
          setRetrying(true)
          queryErrors.reset()
          // Удалось — этот компонент исчезнет вместе с ошибкой; не удалось — снимаем «Загружаем…».
          void router.invalidate().finally(() => setRetrying(false))
        }}
      />
    </Page>
  )
}
