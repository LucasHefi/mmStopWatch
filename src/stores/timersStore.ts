import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Session } from '../types/session'
import { TimerEngine, type TimerSegment, type TimerEngineState } from '../services/timerEngine'
import { clearRecoveryCheckpoint, clearRecoveryCheckpoints, saveRecoveryCheckpoint } from '../services/recovery'

type Status = 'IDLE' | 'RUNNING' | 'PAUSED' | 'STOPPED'

const palette = ['#10b981', '#0ea5e9', '#8b5cf6', '#f59e0b', '#f43f5e', '#14b8a6', '#6366f1', '#84cc16', '#ec4899', '#f97316', '#06b6d4', '#a855f7', '#22c55e', '#eab308', '#3b82f6', '#d946ef', '#2dd4bf', '#fb923c', '#a78bfa', '#34d399']

export interface TimerInstance {
  id: string
  notePath: string
  name: string
  status: Status
  elapsed: number
  startTime: number
  pausedOffset: number
  baseElapsed: number
  color: string
  timeEstimate?: number
  segments?: TimerSegment[]
  saveError?: string
}

interface TimersState {
  timers: TimerInstance[]
  addTimer: (session: Session, restoreState?: { elapsed: number; pausedOffset: number }) => void
  hasTimerForNote: (notePath: string) => boolean
  removeTimer: (id: string) => void
  startTimer: (id: string) => void
  pauseTimer: (id: string) => void
  stopTimer: (id: string, onSave: (elapsed: number, notePath: string, operationId: string) => Promise<void>) => Promise<void>
  checkpointTimer: (id: string) => void
  checkpointAll: () => void
  resetAll: () => void
  setTimeEstimate: (notePath: string, minutes: number | null) => void
}

const pendingStops = new Map<string, Promise<void>>()
const engines = new Map<string, TimerEngine>()

function elapsedFor(timer: TimerInstance, now = performance.now()): number {
  return timer.pausedOffset + (timer.status === 'RUNNING' ? Math.max(0, now - timer.startTime) : 0)
}

function engineFor(timer: TimerInstance): TimerEngine {
  const existing = engines.get(timer.id)
  if (existing) return existing
  const engine = new TimerEngine(timer.notePath, timer.baseElapsed, undefined, timer.id)
  if (timer.status === 'PAUSED' || timer.status === 'STOPPED') engine.restore(timer.elapsed, 'PAUSED')
  engines.set(timer.id, engine)
  return engine
}

function timerFromEngine(timer: TimerInstance, state: TimerEngineState, now: number): TimerInstance {
  const active = state.segments.find(segment => segment.id === state.segments[state.segments.length - 1]?.id && !segment.endedAt && segment.kind === 'work')
  const activeDuration = state.status === 'RUNNING' && active ? Math.max(0, now - active.startedAt) : 0
  const elapsed = state.elapsedMs
  const pausedOffset = Math.max(0, elapsed - activeDuration)
  const status: Status = state.status === 'RUNNING' ? 'RUNNING' : state.status === 'STOPPING' ? 'STOPPED' : state.status === 'SAVED' ? 'STOPPED' : 'PAUSED'
  return {
    ...timer,
    status,
    elapsed,
    startTime: active?.startedAt ?? 0,
    pausedOffset: status === 'RUNNING' ? pausedOffset : elapsed,
    segments: state.segments,
    saveError: undefined,
  }
}

function checkpoint(timer: TimerInstance, now?: number): void {
  const engine = engines.get(timer.id)
  if (engine) {
    const state = engine.snapshot()
    const elapsed = state.status === 'RUNNING' && now !== undefined ? engine.elapsedMs(now) : state.elapsedMs
    const active = state.segments.find(segment => !segment.endedAt && segment.kind === 'work')
    const activeDuration = state.status === 'RUNNING' && now !== undefined && active ? Math.max(0, now - active.startedAt) : 0
    saveRecoveryCheckpoint(timer, elapsed, Math.max(0, elapsed - activeDuration))
    return
  }
  saveRecoveryCheckpoint(timer, elapsedFor(timer, now), timer.status === 'RUNNING' ? timer.pausedOffset : timer.elapsed)
}

export const useTimersStore = create<TimersState>()(
  subscribeWithSelector((set, get) => ({
    timers: [],

    addTimer: (session, restoreState) => {
      if (get().timers.some(timer => timer.notePath === session.notePath)) return
      const notePath = session.notePath || ''
      const initialElapsed = restoreState ? restoreState.elapsed : (session.duration_ms || 0)
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2)
      const engine = new TimerEngine(notePath, initialElapsed, undefined, id)
      if (restoreState) engine.restore(initialElapsed, 'PAUSED')
      engines.set(id, engine)
      const timer: TimerInstance = {
        id,
        notePath,
        name: session.name,
        status: restoreState ? 'PAUSED' : 'IDLE',
        elapsed: initialElapsed,
        startTime: 0,
        pausedOffset: restoreState ? restoreState.pausedOffset : initialElapsed,
        baseElapsed: initialElapsed,
        color: palette[Math.floor(Math.random() * palette.length)],
        timeEstimate: session.timeEstimate,
        segments: engine.snapshot().segments,
      }
      set({ timers: [...get().timers, timer] })
      if (restoreState) checkpoint(timer)
    },

    hasTimerForNote: notePath => get().timers.some(timer => timer.notePath === notePath && (timer.status === 'RUNNING' || timer.status === 'PAUSED' || timer.status === 'STOPPED')),

    removeTimer: id => {
      engines.delete(id)
      clearRecoveryCheckpoint(id)
      set({ timers: get().timers.filter(timer => timer.id !== id) })
    },

    startTimer: id => {
      const timer = get().timers.find(item => item.id === id)
      if (!timer || timer.status === 'RUNNING' || timer.status === 'STOPPED') return
      const now = performance.now()
      const next = timerFromEngine(timer, engineFor(timer).start(now), now)
      set({ timers: get().timers.map(item => item.id === id ? next : item) })
      checkpoint(next, now)
    },

    pauseTimer: id => {
      const timer = get().timers.find(item => item.id === id)
      if (!timer || timer.status !== 'RUNNING') return
      const now = performance.now()
      const next = timerFromEngine(timer, engineFor(timer).pause(now), now)
      set({ timers: get().timers.map(item => item.id === id ? next : item) })
      checkpoint(next, now)
    },

    stopTimer: async (id, onSave) => {
      const pending = pendingStops.get(id)
      if (pending) return pending
      const timer = get().timers.find(item => item.id === id)
      if (!timer) return
      const now = performance.now()
      const engine = engineFor(timer)
      const stopped = timerFromEngine(timer, engine.stop(now), now)
      set({ timers: get().timers.map(item => item.id === id ? { ...stopped, status: 'STOPPED' } : item) })
      checkpoint(stopped, now)

      const operation = (async () => {
        try {
          await onSave(stopped.elapsed, stopped.notePath, id)
          engine.markSaved()
          clearRecoveryCheckpoint(id)
          engines.delete(id)
          set({ timers: get().timers.filter(item => item.id !== id) })
        } catch (error) {
          engine.markSaveFailed()
          const failed = { ...stopped, status: timer.status === 'RUNNING' ? 'PAUSED' as const : timer.status, saveError: error instanceof Error ? error.message : String(error) }
          set({ timers: get().timers.map(item => item.id === id ? failed : item) })
          checkpoint(failed, now)
          throw error
        }
      })()
      pendingStops.set(id, operation)
      try {
        await operation
      } finally {
        if (pendingStops.get(id) === operation) pendingStops.delete(id)
      }
    },

    checkpointTimer: id => {
      const timer = get().timers.find(item => item.id === id)
      if (!timer || (timer.status !== 'RUNNING' && timer.status !== 'PAUSED' && timer.status !== 'STOPPED')) return
      checkpoint(timer, performance.now())
    },

    checkpointAll: () => {
      const now = performance.now()
      for (const timer of get().timers) {
        if (timer.status === 'RUNNING' || timer.status === 'PAUSED' || timer.status === 'STOPPED') checkpoint(timer, now)
      }
    },

    resetAll: () => {
      engines.clear()
      clearRecoveryCheckpoints()
      set({ timers: [] })
    },

    setTimeEstimate: (notePath, minutes) => set({ timers: get().timers.map(timer => timer.notePath === notePath ? { ...timer, timeEstimate: minutes || undefined } : timer) }),
  })),
)

export const selectTimers = (state: TimersState) => state.timers
export const selectActiveTimers = (state: TimersState) => state.timers.filter(timer => timer.status === 'RUNNING' || timer.status === 'PAUSED' || timer.status === 'STOPPED')
export const selectRunningTimers = (state: TimersState) => state.timers.filter(timer => timer.status === 'RUNNING')
export const selectTimerById = (id: string) => (state: TimersState) => state.timers.find(timer => timer.id === id)
export const selectTimerByNotePath = (notePath: string) => (state: TimersState) => state.timers.find(timer => timer.notePath === notePath)
export { elapsedFor }
