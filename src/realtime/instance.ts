/**
 * Единственный на приложение клиент реального времени.
 *
 * Соединение одно на вкладку — каналы «уплотняются» в него (мультиплексирование).
 * Открывать сокет на каждый компонент было бы расточительно: у браузера лимит
 * соединений, а у сервера — память на каждое.
 */
import { WS_URL } from '@/config'
import { auth, authStore } from '@/lib/auth'

import { RealtimeClient } from './client'

export const realtime = new RealtimeClient({
  url: WS_URL,
  getToken: () => auth.token,
  // Сервер не принял токен — сессия недействительна и для HTTP: выходим.
  onUnauthorized: () => auth.clear(),
  // Обработчик resync назначает sync.ts: ему нужен кэш запросов.
  onResync: () => resyncHandler?.(),
})

let resyncHandler: (() => void) | null = null
export const setResyncHandler = (handler: () => void) => {
  resyncHandler = handler
}

/** Сокет живёт, пока пользователь в системе: вошёл — подключились, вышел — отключились. */
export function bindRealtimeToAuth() {
  let token = auth.token
  if (token) realtime.start()
  authStore.subscribe(() => {
    if (auth.token === token) return
    token = auth.token
    realtime.stop()
    if (token) realtime.start()
  })
}
