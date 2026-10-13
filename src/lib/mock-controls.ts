import { useEffect, useState } from 'react'

import { USE_MOCK } from '@/config'

type Controls = (typeof import('@/mocks/browser'))['mockControls']

/**
 * Рычаги мок-сервера (создать заказ, «перезапустить сервер») — только в мок-режиме.
 * Динамический import: в режиме настоящего сервера код мока в сборку не попадает.
 */
export function useMockControls() {
  const [controls, setControls] = useState<Controls | null>(null)
  useEffect(() => {
    if (!USE_MOCK) return
    let alive = true
    void import('@/mocks/browser').then((module) => alive && setControls(module.mockControls))
    return () => {
      alive = false
    }
  }, [])
  return controls
}
