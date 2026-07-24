import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Session } from '../types/session'

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
}

interface TimersState {
  timers: TimerInstance[]
  addTimer: (session: Session, restoreState?: { elapsed: number, pausedOffset: number }) => void
  hasTimerForNote: (notePath: string) => boolean
  removeTimer: (id: string) => void
  startTimer: (id: string) => void
  pauseTimer: (id: string) => void
  stopTimer: (id: string, onSave: (elapsed: number, notePath: string, operationId: string) => Promise<void>) => Promise<void>
  resetAll: () => void
  setTimeEstimate: (notePath: string, minutes: number | null) => void
}

const pendingStops = new Map<string, Promise<void>>()

export const useTimersStore = create<TimersState>()(
  subscribeWithSelector((set, get) => ({
    timers: [],

    addTimer: (session: Session, restoreState?: { elapsed: number; pausedOffset: number }) => {
      if (get().timers.some((t) => t.notePath === session.notePath)) return
      const notePath = session.notePath || ''
      const initialElapsed = restoreState ? restoreState.elapsed : (session.duration_ms || 0)

      const newTimer: TimerInstance = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        notePath,
        name: session.name,
        status: restoreState ? 'PAUSED' : 'IDLE',
        elapsed: initialElapsed,
        startTime: 0,
        pausedOffset: restoreState ? restoreState.pausedOffset : initialElapsed,
        baseElapsed: initialElapsed,
        color: palette[Math.floor(Math.random() * palette.length)],
      }
      set({ timers: [...get().timers, newTimer] })
    },
    hasTimerForNote: (notePath: string) => get().timers.some(t => t.notePath === notePath && (t.status === 'RUNNING' || t.status === 'PAUSED' || t.status === 'STOPPED')),

    removeTimer: (id: string) => {
      set({ timers: get().timers.filter(t => t.id !== id) })
    },

    startTimer: (id: string) => {
      const timer = get().timers.find(t => t.id === id)
      if (!timer || timer.status === 'RUNNING' || timer.status === 'STOPPED') return

      const now = performance.now()
      set({
        timers: get().timers.map(t =>
          t.id === id
            ? { ...t, status: 'RUNNING', startTime: now }
            : t
        ),
      })
    },

    pauseTimer: (id: string) => {
      const now = performance.now()
      set({
        timers: get().timers.map(t => {
          if (t.id === id && t.status === 'RUNNING') {
            const newOffset = t.pausedOffset + now - t.startTime
            return { ...t, status: 'PAUSED', pausedOffset: newOffset, elapsed: newOffset }
          }
          return t
        }),
      })
    },

    stopTimer: async (id: string, onSave: (elapsed: number, notePath: string, operationId: string) => Promise<void>) => {
      const pending = pendingStops.get(id)
      if (pending) return pending

      const timer = get().timers.find(t => t.id === id)
      if (!timer) return
      const now = performance.now()
      const finalElapsed = timer.pausedOffset + (timer.status === 'RUNNING' ? now - timer.startTime : 0)
      set({ timers: get().timers.map(t => t.id === id ? { ...t, status: 'STOPPED' } : t) })

      const operation = (async () => {
        try {
          await onSave(finalElapsed, timer.notePath, id)
          set({ timers: get().timers.filter(t => t.id !== id) })
        } catch (error) {
          set({
            timers: get().timers.map(t => t.id === id
              ? {
                  ...t,
                  status: timer.status === 'RUNNING' ? 'PAUSED' : timer.status,
                  pausedOffset: finalElapsed,
                  elapsed: finalElapsed,
                }
              : t),
          })
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
    resetAll: () => set({ timers: [] }),

    setTimeEstimate: (notePath: string, minutes: number | null) => {
      set({
        timers: get().timers.map(t =>
          t.notePath === notePath
            ? { ...t, timeEstimate: minutes || undefined }
            : t
        ),
      })
    },
  }))
)

export const selectTimers = (state: TimersState) => state.timers
export const selectActiveTimers = (state: TimersState) => state.timers.filter(t => t.status === 'RUNNING' || t.status === 'PAUSED' || t.status === 'STOPPED')
export const selectRunningTimers = (state: TimersState) => state.timers.filter(t => t.status === 'RUNNING')
export const selectTimerById = (id: string) => (state: TimersState) => state.timers.find(t => t.id === id)
export const selectTimerByNotePath = (notePath: string) => (state: TimersState) => state.timers.find(t => t.notePath === notePath)
