/**
 * Заметки к заказу — маленький чат поверх WebSocket.
 *
 * Отправка заметки показывает сразу три приёма:
 *   - оптимистичный показ: заметка появляется мгновенно, «бледная», пока сервер не подтвердил;
 *   - ack: сервер отвечает на запрос — тогда заметка становится обычной;
 *   - событие note.added: её же получают все, кто смотрит заказ (и другие наши вкладки).
 * Логика — в useAddNote (api/mutations.ts) и в sync.ts.
 */
import { SendIcon } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { useAddNote } from '@/api/mutations'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { UserAvatar } from '@/components/user-avatar'
import { useCan } from '@/lib/auth'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useRealtimeStatus } from '@/realtime/hooks'
import type { Note } from '@/shared/types'

export function Notes({ orderId, notes }: { orderId: string; notes: Note[] }) {
  const [text, setText] = useState('')
  const addNote = useAddNote(orderId)
  const canWrite = useCan('orders.note')
  const online = useRealtimeStatus().status === 'online'
  const listRef = useRef<HTMLUListElement>(null)

  // Новая заметка — прокручиваем список к ней.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [notes.length])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = text.trim()
    if (!value) return
    // clientId придумывает клиент: по нему сервер узнает повтор, а мы — свою заметку в событии.
    addNote.mutate({ text: value, clientId: crypto.randomUUID() })
    setText('')
  }

  return (
    <div className="flex flex-col">
      {notes.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">Заметок пока нет. Их видит только команда — клиенту они не показываются.</p>
      ) : (
        <ul ref={listRef} className="flex max-h-80 flex-col gap-4 overflow-y-auto px-4 py-2" aria-live="polite">
          {notes.map((note) => {
            // У настоящих заметок id выдаёт сервер ('n_…'); всё остальное — ещё не подтверждённые.
            const pending = !note.id.startsWith('n_')
            return (
              <li key={note.id} className={cn('slide-in flex gap-3', pending && 'opacity-60')}>
                <UserAvatar name={note.authorName} hue={note.hue} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{note.authorName}</span>{' '}
                    <span className="text-xs text-muted-foreground">{pending ? 'отправляется…' : formatDateTime(note.at)}</span>
                  </p>
                  <p className="text-sm break-words whitespace-pre-wrap">{note.text}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {canWrite ? (
        <form onSubmit={submit} className="flex items-end gap-2 border-t p-3">
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // Enter отправляет, Shift+Enter — новая строка (как в мессенджерах).
              if (event.key === 'Enter' && !event.shiftKey) submit(event)
            }}
            placeholder="Заметка для команды"
            aria-label="Текст заметки"
            rows={1}
            maxLength={500}
            className="max-h-32 min-h-9 resize-none"
          />
          <Button type="submit" size="icon" aria-label="Отправить заметку" disabled={!text.trim()}>
            <SendIcon />
          </Button>
        </form>
      ) : (
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">У вашей роли нет права писать заметки.</p>
      )}
      {canWrite && !online && <p className="px-4 pb-3 text-xs text-muted-foreground">Нет связи — заметка уйдёт, когда соединение восстановится.</p>}
    </div>
  )
}
