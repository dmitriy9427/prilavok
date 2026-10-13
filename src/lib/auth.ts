/**
 * Сессия пользователя.
 *
 * Токен лежит в localStorage: вход переживает перезагрузку и общий для вкладок.
 * Цена — токен доступен любому скрипту страницы (при XSS его украдут). В
 * настоящем проекте безопаснее cookie с флагами HttpOnly + Secure + SameSite:
 * скрипт её не прочитает. Для демо без сервера cookie не годится.
 */
import type { Permission } from '@/shared/permissions'
import { can } from '@/shared/permissions'
import type { Session } from '@/shared/types'

import { createStore, useStore } from './store'

const KEY = 'prilavok:session'

function load(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export const authStore = createStore<Session | null>(load())

export const auth = {
  get session() {
    return authStore.get()
  },
  get token() {
    return authStore.get()?.token ?? null
  },
  set(session: Session) {
    localStorage.setItem(KEY, JSON.stringify(session))
    authStore.set(session)
  },
  clear() {
    localStorage.removeItem(KEY)
    authStore.set(null)
  },
  can(permission: Permission) {
    const session = authStore.get()
    return session ? can(session.user.role, permission) : false
  },
}

// Вышли в одной вкладке — выйти во всех: событие storage приходит в остальные вкладки.
window.addEventListener('storage', (event) => {
  if (event.key === KEY) authStore.set(load())
})

export const useSession = () => useStore(authStore)
export const useUser = () => useStore(authStore, (session) => session?.user ?? null)

/** Можно ли текущему пользователю это действие (чтобы спрятать или выключить кнопку). */
export function useCan(permission: Permission) {
  const user = useUser()
  return user ? can(user.role, permission) : false
}
