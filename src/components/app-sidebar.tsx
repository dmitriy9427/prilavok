import { Link, useRouterState } from '@tanstack/react-router'
import {
  ActivityIcon,
  ChevronsUpDownIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PackageIcon,
  SettingsIcon,
  ShoppingBagIcon,
  SunIcon,
  UsersIcon,
} from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { UserAvatar } from '@/components/user-avatar'
import { auth, useUser } from '@/lib/auth'
import { useStore } from '@/lib/store'
import { setTheme, useTheme, type Theme } from '@/lib/theme'
import { liveStore } from '@/realtime/live'
import { ROLE_LABELS } from '@/shared/permissions'

const MAIN = [
  { to: '/', label: 'Дашборд', icon: LayoutDashboardIcon, exact: true },
  { to: '/orders', label: 'Заказы', icon: ShoppingBagIcon },
  { to: '/products', label: 'Товары', icon: PackageIcon },
  { to: '/customers', label: 'Клиенты', icon: UsersIcon },
] as const

const SYSTEM = [
  { to: '/realtime', label: 'Соединение', icon: ActivityIcon },
  { to: '/settings', label: 'Настройки', icon: SettingsIcon },
] as const

export function AppSidebar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const fresh = useStore(liveStore, (s) => s.fresh.length)
  const { setOpenMobile } = useSidebar()
  const user = useUser()
  const theme = useTheme()

  // Адрес может начинаться с подпапки (GitHub Pages) — сравниваем без неё.
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const path = pathname.startsWith(base) ? pathname.slice(base.length) || '/' : pathname
  const isActive = (to: string, exact?: boolean) => (exact ? path === to : path === to || path.startsWith(`${to}/`))

  const item = ({ to, label, icon: Icon, exact }: { to: string; label: string; icon: typeof ActivityIcon; exact?: boolean }) => (
    <SidebarMenuItem key={to}>
      <SidebarMenuButton asChild isActive={isActive(to, exact)} tooltip={label}>
        {/* На телефоне меню — выезжающая панель: после перехода её нужно закрыть. */}
        <Link to={to} onClick={() => setOpenMobile(false)}>
          <Icon />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
      {to === '/orders' && fresh > 0 && <SidebarMenuBadge className="bg-primary text-primary-foreground">{fresh > 99 ? '99+' : fresh}</SidebarMenuBadge>}
    </SidebarMenuItem>
  )

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/" onClick={() => setOpenMobile(false)}>
                <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <ShoppingBagIcon className="size-4" />
                </span>
                <span className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">Прилавок</span>
                  <span className="truncate text-xs text-muted-foreground">Кофе, чай и посуда</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Магазин</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{MAIN.map(item)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Система</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{SYSTEM.map(item)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        {user && (
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg" aria-label={`Меню пользователя: ${user.name}`}>
                    <UserAvatar name={user.name} hue={user.hue} />
                    <span className="grid flex-1 text-left leading-tight">
                      <span className="truncate font-medium">{user.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</span>
                    </span>
                    <ChevronsUpDownIcon className="ml-auto size-4" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuLabel className="font-normal text-muted-foreground">{user.email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Тема</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
                    <DropdownMenuRadioItem value="light">
                      <SunIcon /> Светлая
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dark">
                      <MoonIcon /> Тёмная
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="system">
                      <MonitorIcon /> Как в системе
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => auth.clear()}>
                    <LogOutIcon /> Выйти
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
