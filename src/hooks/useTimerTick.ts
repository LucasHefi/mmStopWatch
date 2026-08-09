import { useEffect, useRef, useState } from 'react'
import { useTimersStore, selectRunningTimers } from '../stores/timersStore'
import type { TimerInstance } from '../stores/timersStore'

type TickListener = (timers: TimerInstance[], now: number) => void
const listeners = new Set<TickListener>()
let frameId: number | null = null
let intervalId: number | null = null
let lastNow: number | null = null
const SLOW_TICK_MS = 1000

function requestNextTick(): void {
  if (listeners.size === 0) return
  if (document.visibilityState === 'visible') frameId = requestAnimationFrame(runFrame)
  else intervalId = window.setTimeout(runSlowTick, SLOW_TICK_MS)
}

function runFrame(): void {
  frameId = null
  if (listeners.size === 0) return
  const now = performance.now()
  lastNow = now
  const runningTimers = selectRunningTimers(useTimersStore.getState())
  for (const listener of listeners) listener(runningTimers, now)
  requestNextTick()
}

function runSlowTick(): void {
  intervalId = null
  if (listeners.size === 0) return
  const now = performance.now()
  lastNow = now
  const runningTimers = selectRunningTimers(useTimersStore.getState())
  for (const listener of listeners) listener(runningTimers, now)
  requestNextTick()
}

function startTicker(): void {
  if (frameId !== null || intervalId !== null || listeners.size === 0) return
  requestNextTick()
}

function stopTicker(): void {
  if (frameId !== null) cancelAnimationFrame(frameId)
  if (intervalId !== null) window.clearTimeout(intervalId)
  frameId = null
  intervalId = null
  lastNow = null
}

function subscribeToTicker(listener: TickListener): () => void {
  listeners.add(listener)
  startTicker()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) stopTicker()
  }
}

function handleVisibilityChange(): void {
  if (listeners.size === 0) return
  if (document.visibilityState === 'visible') {
    stopTicker()
    startTicker()
  }
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', handleVisibilityChange)

export function useTimerTick(onTick: (timers: TimerInstance[], now: number) => void): void {
  const callbackRef = useRef(onTick)
  callbackRef.current = onTick
  useEffect(() => subscribeToTicker((timers, now) => callbackRef.current(timers, now)), [])
}

export function useTimerElapsed(timerId: string) {
  const timer = useTimersStore(state => state.timers.find(item => item.id === timerId))
  const [elapsed, setElapsed] = useState(timer?.pausedOffset ?? 0)

  useTimerTick((runningTimers, now) => {
    const currentTimer = runningTimers.find(item => item.id === timerId)
    if (!currentTimer) return
    const nextElapsed = currentTimer.pausedOffset + Math.max(0, now - currentTimer.startTime)
    setElapsed(previous => previous === nextElapsed ? previous : nextElapsed)
  })

  useEffect(() => {
    if (timer && timer.status !== 'RUNNING') setElapsed(timer.pausedOffset)
  }, [timer?.status, timer?.pausedOffset])

  return { timer, elapsed }
}

export { subscribeToTicker, lastNow }
