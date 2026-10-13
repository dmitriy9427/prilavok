/**
 * Адреса сервера.
 *
 * Два режима:
 *   mock (по умолчанию) — сервера нет, его изображает MSW в браузере;
 *   real                — настоящий сервер на Node (npm run server), адреса из .env.real.
 *
 * import.meta.env — переменные, которые Vite подставляет при сборке. В код
 * попадают только те, что начинаются с VITE_ (защита от утечки секретов).
 * BASE_URL — путь, по которому открыт сайт: '/' локально, '/prilavok/' на GitHub Pages.
 */
const base = import.meta.env.BASE_URL

export const USE_MOCK = import.meta.env.VITE_BACKEND !== 'real'

export const API_URL: string = import.meta.env.VITE_API_URL ?? `${location.origin}${base}api`

/** ws:// для http и wss:// (с шифрованием) для https — иначе браузер заблокирует соединение. */
export const WS_URL: string = import.meta.env.VITE_WS_URL ?? `${location.origin.replace(/^http/, 'ws')}${base}ws`
