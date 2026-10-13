/**
 * Корневой маршрут: то, что есть на любом экране.
 *
 * Файлы в src/routes — это и есть карта приложения:
 *   __root.tsx              оболочка всего
 *   login.tsx               /login
 *   _app.tsx                каркас с боковым меню (подчёркивание = в адрес не попадает)
 *   _app/index.tsx          /
 *   _app/orders/index.tsx   /orders
 *   _app/orders/$orderId.tsx /orders/o_15   ($ = параметр)
 */
import type { QueryClient } from '@tanstack/react-query'
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'

/** Контекст роутера: то, что доступно загрузчикам всех маршрутов. */
type RouterContext = { queryClient: QueryClient }

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <>
      <Outlet />
      <Toaster position="bottom-right" richColors closeButton />
    </>
  ),
  notFoundComponent: () => (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-6xl font-semibold tracking-tight">404</p>
      <p className="text-muted-foreground">Такой страницы нет</p>
      <Button asChild>
        <Link to="/">На главную</Link>
      </Button>
    </div>
  ),
})
