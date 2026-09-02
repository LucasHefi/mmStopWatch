import { useEffect, useRef, useState } from 'react'
import { useTimersStore, selectRunningTimers } from '../stores/timersStore'
import type { TimerInstance } from '../stores/timersStore'

type TickListener = (timers: TimerInstance[], now: number) => void
type TimerTickListener = (timer: TimerInstance | undefined, now: number) => void
type ListenerEntry = {
  timerId?: string
  callback: TickListener | TimerTickListener
}

const listeners = new Set<ListenerEntry>()
let frameId: number | null = null
let intervalId: number | null = null
let lastNow: number | null = null
let lastFrameDispatch = 0
const SLOW_TICK_MS = 1000
const FRAME_INTERVAL_MS = 1000 / 30

function requestNextTick(): void {
  if (listeners.size === 0) return
  if (document.visibilityState === 'visible') frameId = requestAnimationFrame(runFrame)
  else intervalId = window.setTimeout(runSlowTick, SLOW_TICK_MS)
}

function runFrame(): void {
  frameId = null
  if (listeners.size === 0) return
  const now = performance.now()
  if (now - lastFrameDispatch < FRAME_INTERVAL_MS) {
    requestNextTick()
    return
  }
  lastFrameDispatch = now
  lastNow = now
  const runningTimers = selectRunningTimers(useTimersStore.getState())
  const runningById = new Map(runningTimers.map(timer => [timer.id, timer]))
  for (const listener of listeners) {
    if (listener.timerId) {
      (listener.callback as TimerTickListener)(runningById.get(listener.timerId), now)
    } else {
      (listener.callback as TickListener)(runningTimers, now)
    }
  }
  requestNextTick()
}

function runSlowTick(): void {
  intervalId = null
  if (listeners.size === 0) return
  const now = performance.now()
  lastNow = now
  const runningTimers = selectRunningTimers(useTimersStore.getState())
  const runningById = new Map(runningTimers.map(timer => [timer.id, timer]))
  for (const listener of listeners) {
    if (listener.timerId) {
      (listener.callback as TimerTickListener)(runningById.get(listener.timerId), now)
    } else {
      (listener.callback as TickListener)(runningTimers, now)
    }
  }
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
  lastFrameDispatch = 0
}

function subscribeToTicker(listener: TickListener): () => void {
  const entry = { callback: listener }
  listeners.add(entry)
  startTicker()
  return () => {
    listeners.delete(entry)
    if (listeners.size === 0) stopTicker()
  }
}

function subscribeToTimer(timerId: string, listener: TimerTickListener): () => void {
  const entry = { timerId, callback: listener }
  listeners.add(entry)
  startTicker()
  return () => {
    listeners.delete(entry)
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

export function useTimerElapsed(timerId: string, onFrame?: (elapsed: number, timer: TimerInstance) => void) {
  const timer = useTimersStore(state => state.timers.find(item => item.id === timerId))
  const [elapsed, setElapsed] = useState(timer?.pausedOffset ?? 0)
  const publishedBucketRef = useRef(Math.floor((timer?.pausedOffset ?? 0) / 250))
  const frameCallbackRef = useRef(onFrame)
  frameCallbackRef.current = onFrame

  useEffect(() => subscribeToTimer(timerId, (currentTimer, now) => {
    if (!currentTimer) return
    const nextElapsed = currentTimer.pausedOffset + Math.max(0, now - currentTimer.startTime)
    frameCallbackRef.current?.(nextElapsed, currentTimer)
    const nextBucket = Math.floor(nextElapsed / 250)
    if (nextBucket !== publishedBucketRef.current) {
      publishedBucketRef.current = nextBucket
      setElapsed(nextElapsed)
    }
  }), [timerId])

  useEffect(() => {
    if (timer && timer.status !== 'RUNNING') {
      publishedBucketRef.current = Math.floor(timer.pausedOffset / 250)
      setElapsed(timer.pausedOffset)
    }
  }, [timer?.status, timer?.pausedOffset])

  return { timer, elapsed }
}

export { subscribeToTicker, lastNow }
