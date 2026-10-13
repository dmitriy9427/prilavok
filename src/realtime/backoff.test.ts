import { describe, expect, it } from 'vitest'

import { backoffDelay } from './backoff'

const options = { base: 500, max: 30_000, factor: 2 }

describe('backoffDelay', () => {
  it('растёт вдвое с каждой попыткой', () => {
    // random = 1 → верхняя граница паузы
    const top = (attempt: number) => backoffDelay(attempt, options, () => 0.999999)
    expect([0, 1, 2, 3].map(top)).toEqual([500, 1000, 2000, 4000])
  })

  it('не превышает потолок', () => {
    expect(backoffDelay(20, options, () => 0.999999)).toBe(30_000)
  })

  it('пауза случайна, но не меньше половины', () => {
    expect(backoffDelay(2, options, () => 0)).toBe(1000)
    expect(backoffDelay(2, options, () => 0.5)).toBe(1500)
  })

  it('разные клиенты получают разные паузы', () => {
    const delays = new Set(Array.from({ length: 50 }, () => backoffDelay(4, options)))
    expect(delays.size).toBeGreaterThan(10)
  })
})
