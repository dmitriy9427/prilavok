import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { Loader2Icon, ShoppingBagIcon } from 'lucide-react'
import { z } from 'zod'

import { useLogin } from '@/api/mutations'
import { UserAvatar } from '@/components/user-avatar'
import { auth } from '@/lib/auth'
import { ROLE_HINTS, ROLE_LABELS } from '@/shared/permissions'
import type { User } from '@/shared/types'

/** Демо-аккаунты. В настоящем приложении здесь были бы поля «почта» и «пароль». */
const ACCOUNTS: Pick<User, 'id' | 'name' | 'role' | 'hue'>[] = [
  { id: 'u_admin', name: 'Дмитрий Рябов', role: 'admin', hue: 152 },
  { id: 'u_manager', name: 'Алина Морозова', role: 'manager', hue: 262 },
  { id: 'u_viewer', name: 'Гость', role: 'viewer', hue: 30 },
]

export const Route = createFileRoute('/login')({
  // Параметры адреса проверяются схемой: в компонент попадает уже типизированный объект.
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: () => {
    if (auth.session) throw redirect({ to: '/' })
  },
  component: LoginPage,
})

function LoginPage() {
  const login = useLogin()
  const navigate = useNavigate()
  const search = Route.useSearch()

  const enter = (userId: string) =>
    login.mutate(userId, {
      onSuccess: () => {
        // Возвращаем туда, куда человек шёл. Только внутренние адреса: иначе ссылкой
        // вида /login?redirect=https://злой.сайт можно увести пользователя (open redirect).
        const target = search.redirect?.startsWith('/') && !search.redirect.startsWith('//') ? search.redirect : null
        if (target) void navigate({ href: target, replace: true })
        else void navigate({ to: '/', replace: true })
      },
    })

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShoppingBagIcon className="size-5" />
          </span>
          <div>
            <p className="text-xl font-semibold tracking-tight">Прилавок</p>
            <p className="text-sm text-muted-foreground">Админка интернет-магазина</p>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-2 shadow-sm">
          <h1 className="px-3 pt-3 text-sm font-medium">Войти как</h1>
          <p className="px-3 pb-2 text-xs text-muted-foreground">Демо: пароль не нужен. У ролей разные права — попробуйте каждую.</p>
          <ul className="flex flex-col">
            {ACCOUNTS.map((account) => {
              const pending = login.isPending && login.variables === account.id
              return (
                <li key={account.id}>
                  <button
                    type="button"
                    disabled={login.isPending}
                    onClick={() => enter(account.id)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
                  >
                    <UserAvatar name={account.name} hue={account.hue} className="size-10 text-sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{ROLE_LABELS[account.role]}</span>
                      <span className="block truncate text-sm text-muted-foreground">{ROLE_HINTS[account.role]}</span>
                    </span>
                    {pending && <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label="Входим" />}
                  </button>
                </li>
              )
            })}
          </ul>
          {login.isError && (
            <p role="alert" className="px-3 pb-2 text-sm text-destructive">
              {login.error.message}
            </p>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">Сервера нет: его изображает код в браузере. Заказы приходят сами — по WebSocket.</p>
      </div>
    </div>
  )
}
