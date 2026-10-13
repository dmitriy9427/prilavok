/**
 * HTTP-клиент: одна функция поверх fetch.
 *
 * Что она берёт на себя, чтобы не повторять в каждом запросе:
 *   - адрес сервера и заголовок Authorization;
 *   - JSON туда и обратно;
 *   - ошибки: fetch НЕ считает ответ 404 или 500 ошибкой (он «успешно получил
 *     ответ»), поэтому статус проверяем сами и бросаем ApiError;
 *   - 401 — сессия недействительна: выходим.
 */
import { API_URL } from '@/config'
import { auth } from '@/lib/auth'
import type { ApiErrorBody } from '@/shared/types'

export class ApiError extends Error {
  status: number
  code: string
  /** Ошибки по полям формы: { sku: 'Такой артикул уже есть' }. */
  fields: Record<string, string>
  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Параметры строки запроса; пустые значения пропускаются. */
  query?: Record<string, string | number | null | undefined>
  /** Отмена: TanStack Query передаёт сигнал и прерывает запрос, ответ которого уже не нужен. */
  signal?: AbortSignal
}

export async function api<T>(path: string, { method = 'GET', body, query, signal }: Options = {}): Promise<T> {
  const url = new URL(`${API_URL}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }

  let response: Response
  try {
    response = await fetch(url, {
      method,
      signal,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(auth.token && { Authorization: `Bearer ${auth.token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    // Отмену пробрасываем как есть — это не ошибка, Query её ждёт.
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    // fetch бросает только когда ответа нет вовсе: нет сети, сервер недоступен, CORS.
    throw new ApiError(0, 'network', 'Нет связи с сервером')
  }

  if (response.status === 204) return undefined as T

  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = (data as ApiErrorBody | null)?.error
    if (response.status === 401 && auth.session) auth.clear()
    throw new ApiError(response.status, error?.code ?? 'unknown', error?.message ?? `Ошибка ${response.status}`, error?.fields)
  }
  return data as T
}
