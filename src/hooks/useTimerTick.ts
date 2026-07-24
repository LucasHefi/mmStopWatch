import { useEffect, useRef, useState } from 'react'
import { useTimersStore, selectRunningTimers } from '../stores/timersStore'
import { useShallow } from 'zustand/react/shallow'

export function useTimerTick(onTick: (timers: ReturnType<typeof selectRunningTimers>) => void) {
  const runningTimers = useTimersStore(useShallow(selectRunningTimers))
  const rafRef = useRef<number>(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const tick = () => {
      if (!mountedRef.current) return
      onTick(runningTimers)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      mountedRef.current = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [runningTimers, onTick])
}

export function useTimerElapsed(timerId: string) {
  const timer = useTimersStore(state => state.timers.find(t => t.id === timerId))
  const [elapsed, setElapsed] = useState(timer?.pausedOffset ?? 0)
  
  useTimerTick((runningTimers) => {
    const currentTimer = runningTimers.find(t => t.id === timerId)
    if (!currentTimer) return
    
    const now = performance.now()
    const newElapsed = currentTimer.pausedOffset + (currentTimer.status === 'RUNNING' ? now - currentTimer.startTime : 0)
    setElapsed(prev => prev === newElapsed ? prev : newElapsed)
  })
  
  return { timer, elapsed }
}