/**
 * Кэш серверных данных (TanStack Query).
 *
 * staleTime — сколько данные считаются свежими. Пока они свежие, повторный
 * показ экрана не делает запрос. 30 секунд — компромисс: переходы между
 * экранами мгновенные, а данные не слишком старые. Самое важное (заказы)
 * обновляется событиями из сокета, не дожидаясь устаревания.
 */
import { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/http'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Повторять есть смысл при сбое сети или сервера (5xx). Ошибку 404 или 403 повтор не исправит.
      retry: (failures, error) => failures < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
})
