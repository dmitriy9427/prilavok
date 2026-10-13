/**
 * Крошечное хранилище состояния вне React (25 строк вместо библиотеки).
 *
 * Зачем вне React: значение меняют не компоненты, а сокет и HTTP-клиент —
 * код, который живёт дольше любого компонента. Компоненты подписываются через
 * useSyncExternalStore — штатный способ React читать внешние источники.
 */
import { useSyncExternalStore } from 'react'

export type Store<T> = {
  get: () => T
  set: (next: T | ((current: T) => T)) => void
  subscribe: (listener: () => void) => () => void
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set: (next) => {
      const value = typeof next === 'function' ? (next as (current: T) => T)(state) : next
      if (Object.is(value, state)) return
      state = value
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * Прочитать часть хранилища. Селектор должен возвращать значение из состояния
 * (state.user), а не создавать новый объект: иначе «изменилось» будет всегда.
 */
export function useStore<T, S = T>(store: Store<T>, selector: (state: T) => S = (state) => state as unknown as S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  )
}
