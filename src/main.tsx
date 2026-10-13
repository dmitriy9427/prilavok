import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@fontsource-variable/geist'
import './index.css'

import { RouteError } from '@/components/page'
import { TooltipProvider } from '@/components/ui/tooltip'
import { USE_MOCK } from '@/config'
import { queryClient } from '@/lib/query-client'
import { bindRealtimeToAuth, realtime, setResyncHandler } from '@/realtime/instance'
import { attachRealtimeSync } from '@/realtime/sync'

// Дерево маршрутов генерирует плагин роутера из файлов src/routes — руками не правится.
import { routeTree } from './routeTree.gen'

const router = createRouter({
  routeTree,
  // Сайт может жить в подпапке (GitHub Pages) — роутер должен знать, где его корень.
  basepath: import.meta.env.BASE_URL,
  context: { queryClient },
  // Наведение на ссылку заранее загружает код и данные экрана — переход кажется мгновенным.
  defaultPreload: 'intent',
  // Кэшем данных управляет TanStack Query; роутеру свой кэш загрузчиков не нужен.
  defaultPreloadStaleTime: 0,
  // Экран ошибки для любого маршрута, у которого нет своего.
  defaultErrorComponent: RouteError,
})

// Новый экран — с начала страницы. (Встроенный scrollRestoration роутера вставляет в разметку
// тег <script>, на который React 19 в браузере ругается в консоль; для админки хватает этого.)
router.subscribe('onResolved', ({ pathChanged }) => {
  if (pathChanged) window.scrollTo(0, 0)
})

// Регистрация типа роутера: после неё <Link to="…"> и useNavigate проверяют адреса и параметры.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

async function bootstrap() {
  // Сначала «сервер», потом приложение: иначе первые запросы уйдут в никуда.
  // Динамический import — в режиме настоящего сервера код мока не попадает в сборку.
  if (USE_MOCK) {
    const { startMockServer } = await import('@/mocks/browser')
    await startMockServer()
  }

  attachRealtimeSync(realtime, queryClient, setResyncHandler)
  bindRealtimeToAuth()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
}

void bootstrap()
