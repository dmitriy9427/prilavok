import { useEffect, useRef, useState } from 'react'

/**
 * Поле ввода, значение которого «доезжает» до получателя с задержкой.
 *
 * Поиск по каждой букве — это запрос на каждую букву. Ждём паузу в наборе
 * (debounce) и только тогда сообщаем значение. Само поле при этом обновляется
 * сразу — иначе печатать было бы невозможно.
 *
 * @param value    значение «снаружи» (например, из адреса страницы)
 * @param onCommit куда сообщить, когда человек перестал печатать
 */
export function useDebouncedInput(value: string, onCommit: (value: string) => void, delay = 300) {
  const [text, setText] = useState(value)
  // Таймер сработает позже, когда компонент мог уже получить другую функцию onCommit.
  // В ref лежит самая свежая — её и вызовем.
  const latest = useRef(onCommit)
  useEffect(() => {
    latest.current = onCommit
  })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Значение снаружи изменилось не нами («назад» в браузере, «сбросить фильтры») — показываем его.
  const [synced, setSynced] = useState(value)
  if (synced !== value) {
    setSynced(value)
    setText(value)
  }

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const onChange = (next: string) => {
    setText(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => latest.current(next.trim()), delay)
  }
  return [text, onChange] as const
}

/** Текущее время, обновляемое по интервалу, — чтобы «5 минут назад» не застывало. */
export function useNow(interval = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(timer)
  }, [interval])
  return now
}
