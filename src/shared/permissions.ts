/**
 * Права доступа (RBAC — role-based access control).
 *
 * Код проверяет не роль («если админ»), а ПРАВО («может ли удалять товары»).
 * Роль — лишь набор прав. Появится новая роль — меняется одна таблица ниже,
 * а не условия по всему приложению.
 *
 * Важно: проверка в интерфейсе — это удобство (спрятать недоступную кнопку).
 * Защита — только на сервере: тот же can() вызывает бэкенд перед изменением.
 * Поэтому файл лежит в shared.
 */
import type { Role } from './types.ts'

export const PERMISSIONS = ['orders.update', 'orders.note', 'products.create', 'products.update', 'products.delete', 'customers.view', 'settings.manage'] as const
export type Permission = (typeof PERMISSIONS)[number]

const BY_ROLE: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  manager: ['orders.update', 'orders.note', 'products.create', 'products.update', 'customers.view'],
  viewer: ['customers.view'],
}

export const can = (role: Role, permission: Permission) => BY_ROLE[role].includes(permission)

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  viewer: 'Наблюдатель',
}

export const ROLE_HINTS: Record<Role, string> = {
  admin: 'Всё, включая удаление товаров и настройки',
  manager: 'Заказы и товары, без удаления',
  viewer: 'Только просмотр',
}
