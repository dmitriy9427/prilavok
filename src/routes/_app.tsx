/**
 * Каркас приложения: боковое меню, шапка и место для экрана.
 *
 * Это «маршрут-обёртка» (layout route): подчёркивание в имени значит, что в
 * адрес он не попадает. Все экраны из папки _app/ рисуются внутри его <Outlet />.
 *
 * Здесь же охрана входа: beforeLoad выполняется ДО загрузки данных и показа
 * экрана. Не вошёл — отправляем на /login и запоминаем, куда человек шёл.
 */
import { Outlet, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

import { AppSidebar } from '@/components/app-sidebar'
import { ConnectionBadge, OfflineBanner } from '@/components/connection'
import { Notifications } from '@/components/notifications'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { auth, useSession } from '@/lib/auth'
import { useChannel } from '@/realtime/hooks'
import { CHANNELS } from '@/shared/protocol'

export const Route = createFileRoute('/_app')({
  beforeLoad: ({ location }) => {
    // Запоминаем, куда человек шёл (главную запоминать незачем — туда попадёт и так).
    if (!auth.session) throw redirect({ to: '/login', search: location.href === '/' ? {} : { redirect: location.href } })
  },
  component: AppLayout,
})

function AppLayout() {
  const session = useSession()
  const navigate = useNavigate()

  // Вышли (кнопкой, в другой вкладке или сервер отклонил токен) — на экран входа.
  useEffect(() => {
    if (!session) void navigate({ to: '/login' })
  }, [session, navigate])

  // Каналы, нужные на любом экране: счётчик новых заказов в меню и «колокольчик».
  // Остальные каналы подключают сами экраны — и отключают, когда с них уходят.
  useChannel(CHANNELS.orders)
  useChannel(CHANNELS.notifications)

  if (!session) return null

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur">
          <SidebarTrigger aria-label="Свернуть или развернуть меню" />
          <div className="flex-1" />
          <ConnectionBadge />
          <Notifications />
        </header>
        <OfflineBanner />
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
