import { initials } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Аватар из инициалов: цвет — оттенок пользователя. Картинок в демо нет. */
export function UserAvatar({ name, hue, className }: { name: string; hue: number; className?: string }) {
  return (
    <span
      className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white select-none', className)}
      style={{ backgroundColor: `oklch(0.6 0.14 ${hue})` }}
      aria-hidden
    >
      {initials(name)}
    </span>
  )
}
