import { createFileRoute } from '@tanstack/react-router'
import { CheckIcon, MinusIcon, MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'

import { Page, PageHeader } from '@/components/page'
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
import { UserAvatar } from '@/components/user-avatar'
import { USE_MOCK } from '@/config'
import { auth, useCan, useUser } from '@/lib/auth'
import { useMockControls } from '@/lib/mock-controls'
import { setTheme, useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { PERMISSIONS, ROLE_LABELS, can, type Permission } from '@/shared/permissions'
import { ROLES } from '@/shared/types'

export const Route = createFileRoute('/_app/settings')({ component: SettingsPage })

const PERMISSION_LABELS: Record<Permission, string> = {
  'orders.update': 'Менять статусы заказов',
  'orders.note': 'Писать заметки к заказам',
  'products.create': 'Создавать товары',
  'products.update': 'Редактировать товары',
  'products.delete': 'Удалять товары',
  'customers.view': 'Смотреть клиентов',
  'settings.manage': 'Сбрасывать демо-данные',
}

const THEMES = [
  { value: 'light', label: 'Светлая', icon: SunIcon },
  { value: 'dark', label: 'Тёмная', icon: MoonIcon },
  { value: 'system', label: 'Как в системе', icon: MonitorIcon },
] as const

function SettingsPage() {
  const user = useUser()
  const theme = useTheme()
  const canManage = useCan('settings.manage')
  const controls = useMockControls()
  if (!user) return null

  return (
    <Page className="max-w-4xl">
      <PageHeader title="Настройки" />

      <Card>
        <CardHeader>
          <CardTitle>Профиль</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <UserAvatar name={user.name} hue={user.hue} className="size-12 text-base" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{user.name}</p>
            <p className="truncate text-sm text-muted-foreground">
              {user.email} · {ROLE_LABELS[user.role]}
            </p>
          </div>
          <Button variant="outline" onClick={() => auth.clear()}>
            Сменить пользователя
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Оформление</CardTitle>
        </CardHeader>
        <CardContent>
          <div role="radiogroup" aria-label="Тема" className="grid gap-2 sm:grid-cols-3">
            {THEMES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={theme === value}
                onClick={() => setTheme(value)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  theme === value ? 'border-primary bg-primary/8 font-medium' : 'hover:bg-muted',
                )}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Роли и права</CardTitle>
          <CardDescription>Одна таблица прав на клиент и сервер: интерфейс прячет недоступное, сервер — не выполняет</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-2 pr-4 font-medium text-muted-foreground">
                  Действие
                </th>
                {ROLES.map((role) => (
                  <th key={role} scope="col" className={cn('px-3 py-2 text-center font-medium', role === user.role ? 'text-primary' : 'text-muted-foreground')}>
                    {ROLE_LABELS[role]}
                    {role === user.role && <span className="block text-xs font-normal">это вы</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((permission) => (
                <tr key={permission} className="border-b last:border-b-0">
                  <th scope="row" className="py-2 pr-4 text-left font-normal">
                    {PERMISSION_LABELS[permission]}
                  </th>
                  {ROLES.map((role) => (
                    <td key={role} className={cn('px-3 py-2 text-center', role === user.role && 'bg-primary/5')}>
                      {can(role, permission) ? (
                        <CheckIcon className="mx-auto size-4 text-success" aria-label="можно" />
                      ) : (
                        <MinusIcon className="mx-auto size-4 text-muted-foreground/50" aria-label="нельзя" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Демо-данные</CardTitle>
          <CardDescription>
            {USE_MOCK
              ? 'Сервера нет: данные живут в этой вкладке и переживают перезагрузку страницы. Новая вкладка начинает с исходных.'
              : 'Подключён настоящий сервер на Node: данные общие для всех вкладок и сбрасываются при его перезапуске.'}
          </CardDescription>
        </CardHeader>
        {USE_MOCK && (
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={!canManage || !controls}>
                  Сбросить данные
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Сбросить демо-данные?</AlertDialogTitle>
                  <AlertDialogDescription>Созданные товары, изменённые статусы и заметки пропадут. Страница перезагрузится.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Отмена</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => controls?.resetData()}>
                    Сбросить
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            {!canManage && <p className="mt-2 text-xs text-muted-foreground">Доступно только администратору.</p>}
          </CardContent>
        )}
      </Card>
    </Page>
  )
}
