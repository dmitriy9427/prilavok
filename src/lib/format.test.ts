import { describe, expect, it } from 'vitest'

import { count, formatRelative, initials, plural, toCsv } from './format'

describe('plural', () => {
  const forms: [string, string, string] = ['заказ', 'заказа', 'заказов']
  it.each([
    [1, 'заказ'],
    [2, 'заказа'],
    [4, 'заказа'],
    [5, 'заказов'],
    [11, 'заказов'],
    [12, 'заказов'],
    [21, 'заказ'],
    [22, 'заказа'],
    [100, 'заказов'],
    [111, 'заказов'],
    [1781, 'заказ'],
  ])('%i → %s', (n, expected) => expect(plural(n, forms)).toBe(expected))

  it('count добавляет число с разделителем тысяч', () => {
    expect(count(1781, forms).replace(/\s/g, ' ')).toBe('1 781 заказ')
  })
})

describe('formatRelative', () => {
  const now = new Date('2026-10-13T12:00:00Z').getTime()
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString()

  it('недавнее — «только что»', () => expect(formatRelative(ago(20), now)).toBe('только что'))
  it('минуты', () => expect(formatRelative(ago(5 * 60), now)).toBe('5 минут назад'))
  it('часы', () => expect(formatRelative(ago(3 * 3600), now)).toBe('3 часа назад'))
  it('вчера', () => expect(formatRelative(ago(86_400), now)).toBe('вчера'))
})

describe('initials', () => {
  it('берёт первые буквы двух слов', () => expect(initials('алина морозова')).toBe('АМ'))
  it('одно слово — одна буква', () => expect(initials('Гость')).toBe('Г'))
})

describe('toCsv', () => {
  it('экранирует кавычки и начинается с BOM', () => {
    const csv = toCsv(['Клиент', 'Сумма'], [['ООО "Ромашка"; Москва', 990]])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.slice(1)).toBe('"Клиент";"Сумма"\r\n"ООО ""Ромашка""; Москва";"990"')
  })
})
