import type { TimerInstance } from '../stores/timersStore'

export interface RecoveryCheckpoint {
  timerId: string
  notePath: string
  name: string
  elapsed: number
  pausedOffset: number
  status: 'RUNNING' | 'PAUSED' | 'STOPPED'
  capturedAt: number
  wallClockAtCapture: number
}

const KEY = 'mmstopwatch_recovery_v1'
const MAX_RECOVERY_ITEMS = 50
const MAX_RECOVERABLE_GAP_MS = 24 * 60 * 60 * 1000

function isCheckpoint(value: unknown): value is RecoveryCheckpoint {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<RecoveryCheckpoint>
  return typeof item.timerId === 'string' && typeof item.notePath === 'string' && typeof item.name === 'string'
    && typeof item.elapsed === 'number' && Number.isFinite(item.elapsed)
    && typeof item.pausedOffset === 'number' && Number.isFinite(item.pausedOffset)
    && (item.status === 'RUNNING' || item.status === 'PAUSED' || item.status === 'STOPPED')
    && typeof item.capturedAt === 'number' && Number.isFinite(item.capturedAt)
    && typeof item.wallClockAtCapture === 'number' && Number.isFinite(item.wallClockAtCapture)
}

function read(): RecoveryCheckpoint[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(value) ? value.filter(isCheckpoint) : []
  } catch (error) {
    console.error('Failed to read recovery checkpoints:', error)
    return []
  }
}

function write(items: RecoveryCheckpoint[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(items.slice(-MAX_RECOVERY_ITEMS)))
  } catch (error) {
    console.error('Failed to persist recovery checkpoint:', error)
  }
}

export function saveRecoveryCheckpoint(timer: TimerInstance, elapsed: number, pausedOffset: number): void {
  const items = read().filter(item => item.timerId !== timer.id)
  const now = Date.now()
  items.push({
    timerId: timer.id,
    notePath: timer.notePath,
    name: timer.name,
    elapsed: Math.max(0, elapsed),
    pausedOffset: Math.max(0, pausedOffset),
    status: timer.status === 'RUNNING' || timer.status === 'PAUSED' || timer.status === 'STOPPED' ? timer.status : 'PAUSED',
    capturedAt: now,
    wallClockAtCapture: now,
  })
  write(items)
}

export function loadRecoveryCheckpoints(): RecoveryCheckpoint[] {
  return read()
}

/** Estimate work since the last checkpoint without silently resuming the timer. */
export function recoveryElapsed(checkpoint: RecoveryCheckpoint, now = Date.now()): number {
  if (checkpoint.status !== 'RUNNING') return checkpoint.elapsed
  const sinceCheckpoint = Math.min(MAX_RECOVERABLE_GAP_MS, Math.max(0, now - checkpoint.wallClockAtCapture))
  return checkpoint.elapsed + sinceCheckpoint
}

export function clearRecoveryCheckpoint(timerId: string): void {
  write(read().filter(item => item.timerId !== timerId))
}

export function clearRecoveryCheckpoints(): void {
  write([])
}
