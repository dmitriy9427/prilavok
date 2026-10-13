/**
 * Тема оформления: светлая, тёмная или «как в системе».
 *
 * Тёмная тема — это класс .dark на <html>: под ним переопределены CSS-переменные
 * цветов (src/index.css), и весь интерфейс перекрашивается без единой строки JS
 * в компонентах.
 *
 * Чтобы при загрузке не мигал белый экран, класс ставит маленький скрипт прямо
 * в index.html — ещё до того, как браузер нарисует страницу и загрузит React.
 */
import { createStore, useStore } from './store'

export type Theme = 'light' | 'dark' | 'system'

const KEY = 'prilavok:theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')

const read = (): Theme => {
  const saved = localStorage.getItem(KEY)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

const themeStore = createStore<Theme>(read())

/** Какая тема получается на деле: «как в системе» превращается в светлую или тёмную. */
const resolve = (theme: Theme) => (theme === 'system' ? (media.matches ? 'dark' : 'light') : theme)

function apply() {
  document.documentElement.classList.toggle('dark', resolve(themeStore.get()) === 'dark')
}

export function setTheme(theme: Theme) {
  if (theme === 'system') localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, theme)
  themeStore.set(theme)
  apply()
}

// Системная тема сменилась (например, вечером) — следуем за ней, если выбрано «как в системе».
media.addEventListener('change', apply)
// Тему поменяли в другой вкладке.
window.addEventListener('storage', (event) => {
  if (event.key !== KEY) return
  themeStore.set(read())
  apply()
})

export const useTheme = () => useStore(themeStore)
