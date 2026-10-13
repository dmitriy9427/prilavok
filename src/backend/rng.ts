/**
 * Генератор случайных чисел с зерном (mulberry32).
 *
 * Math.random() каждый раз даёт разное — демо-данные «прыгали» бы при каждой
 * перезагрузке, а тесты нельзя было бы написать. С зерном последовательность
 * одна и та же: одинаковое зерно → одинаковые данные.
 */
export type Rng = {
  /** Число в [0, 1). */
  next: () => number
  /** Целое в [min, max] включительно. */
  int: (min: number, max: number) => number
  pick: <T>(items: readonly T[]) => T
  /** true с вероятностью p. */
  chance: (p: number) => boolean
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  return {
    next,
    int,
    pick: (items) => items[int(0, items.length - 1)]!,
    chance: (p) => next() < p,
  }
}
