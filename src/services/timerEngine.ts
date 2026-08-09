export type TimerEngineStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'STOPPING' | 'SAVE_PENDING' | 'SAVED' | 'SAVE_FAILED' | 'RECOVERY_REQUIRED'

export interface TimerEngineClock {
  monotonicNow(): number
  wallClockNow(): number
}

export interface TimerSegment {
  id: string
  kind: 'work' | 'pause'
  startedAt: number
  endedAt?: number
  durationMs: number
}

export interface TimerEngineState {
  id: string
  notePath: string
  status: TimerEngineStatus
  baseElapsedMs: number
  elapsedMs: number
  startedAt?: number
  lastWallClock?: number
  segments: TimerSegment[]
}

export function systemClock(): TimerEngineClock {
  return { monotonicNow: () => performance.now(), wallClockNow: () => Date.now() }
}

function makeId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2)
}

/** React-free timer state machine. Monotonic timestamps are used for durations;
 * wall-clock timestamps are retained only for recovery and calendar context. */
export class TimerEngine {
  private state: TimerEngineState
  private activeSegmentId: string | null = null
  private readonly clock: TimerEngineClock

  constructor(notePath: string, initialElapsedMs = 0, clock: TimerEngineClock = systemClock(), existingId = makeId('session_')) {
    this.clock = clock
    const elapsed = Math.max(0, initialElapsedMs)
    this.state = { id: existingId, notePath, status: 'IDLE', baseElapsedMs: elapsed, elapsedMs: elapsed, segments: [] }
  }

  snapshot(): TimerEngineState {
    return { ...this.state, segments: this.state.segments.map(segment => ({ ...segment })) }
  }

  restore(elapsedMs: number, status: 'IDLE' | 'PAUSED' = 'PAUSED'): TimerEngineState {
    const elapsed = Math.max(0, elapsedMs)
    this.activeSegmentId = null
    this.state = { ...this.state, status, baseElapsedMs: elapsed, elapsedMs: elapsed, segments: [], lastWallClock: this.clock.wallClockNow() }
    return this.snapshot()
  }

  private updateElapsed(now = this.clock.monotonicNow()): number {
    const active = this.state.segments.find(segment => segment.id === this.activeSegmentId)
    const completedWork = this.state.segments
      .filter(segment => segment.kind === 'work' && segment.id !== active?.id)
      .reduce((sum, segment) => sum + segment.durationMs, 0)
    const activeWork = active?.kind === 'work' ? Math.max(0, now - active.startedAt) : 0
    this.state.elapsedMs = this.state.baseElapsedMs + completedWork + activeWork
    return this.state.elapsedMs
  }

  private closeActiveSegment(now: number): void {
    if (!this.activeSegmentId) return
    this.state.segments = this.state.segments.map(segment => segment.id === this.activeSegmentId
      ? { ...segment, endedAt: now, durationMs: Math.max(0, now - segment.startedAt) }
      : segment)
    this.activeSegmentId = null
  }

  start(now = this.clock.monotonicNow()): TimerEngineState {
    if (this.state.status === 'RUNNING') return this.snapshot()
    if (this.state.status === 'STOPPING' || this.state.status === 'SAVED') return this.snapshot()
    if (this.state.status === 'PAUSED') this.closeActiveSegment(now)
    const wall = this.clock.wallClockNow()
    const segment: TimerSegment = { id: makeId('segment_'), kind: 'work', startedAt: now, durationMs: 0 }
    this.state = { ...this.state, status: 'RUNNING', startedAt: this.state.startedAt ?? wall, lastWallClock: wall, segments: [...this.state.segments, segment] }
    this.activeSegmentId = segment.id
    return this.snapshot()
  }

  pause(now = this.clock.monotonicNow()): TimerEngineState {
    if (this.state.status !== 'RUNNING') return this.snapshot()
    this.updateElapsed(now)
    this.closeActiveSegment(now)
    const pauseSegment: TimerSegment = { id: makeId('segment_'), kind: 'pause', startedAt: now, durationMs: 0 }
    this.state = { ...this.state, status: 'PAUSED', lastWallClock: this.clock.wallClockNow(), segments: [...this.state.segments, pauseSegment] }
    this.activeSegmentId = pauseSegment.id
    return this.snapshot()
  }

  resume(now = this.clock.monotonicNow()): TimerEngineState {
    if (this.state.status !== 'PAUSED') return this.start(now)
    this.closeActiveSegment(now)
    const wall = this.clock.wallClockNow()
    const segment: TimerSegment = { id: makeId('segment_'), kind: 'work', startedAt: now, durationMs: 0 }
    this.state = { ...this.state, status: 'RUNNING', lastWallClock: wall, segments: [...this.state.segments, segment] }
    this.activeSegmentId = segment.id
    return this.snapshot()
  }

  stop(now = this.clock.monotonicNow()): TimerEngineState {
    if (this.state.status === 'RUNNING') {
      this.updateElapsed(now)
      this.closeActiveSegment(now)
    } else if (this.state.status === 'PAUSED') {
      this.closeActiveSegment(now)
    }
    if (this.state.status === 'STOPPING' || this.state.status === 'SAVED') return this.snapshot()
    this.state = { ...this.state, status: 'STOPPING', lastWallClock: this.clock.wallClockNow() }
    return this.snapshot()
  }

  markSaved(): TimerEngineState { this.state = { ...this.state, status: 'SAVED' }; return this.snapshot() }
  markSaveFailed(): TimerEngineState { this.state = { ...this.state, status: 'SAVE_FAILED' }; return this.snapshot() }

  detectSleepWake(maxGapMs = 5 * 60 * 1000): boolean {
    if (!this.state.lastWallClock || this.state.status !== 'RUNNING') return false
    const active = this.state.segments.find(segment => segment.id === this.activeSegmentId)
    if (!active) return false
    const wallGap = this.clock.wallClockNow() - this.state.lastWallClock
    const monotonicGap = this.clock.monotonicNow() - active.startedAt
    return wallGap - monotonicGap > maxGapMs
  }

  elapsedMs(now = this.clock.monotonicNow()): number { return this.updateElapsed(now) }
}
