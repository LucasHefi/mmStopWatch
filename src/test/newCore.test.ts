import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TimerEngine, type TimerEngineClock } from '../services/timerEngine'
import { clearRecoveryCheckpoints, loadRecoveryCheckpoints, saveRecoveryCheckpoint } from '../services/recovery'
import { sameFileSnapshot, snapshotFromContent } from '../services/safeFileWriter'
import { clearOperationJournal, beginOperation, completeOperation, listPendingOperations, failOperation } from '../services/operationJournal'
import type { TimerInstance } from '../stores/timersStore'

describe('mmStopWatch 2.0 core services', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('tracks timer work across pause and resume with an injected clock', () => {
    let mono = 0
    let wall = 1_000
    const clock: TimerEngineClock = { monotonicNow: () => mono, wallClockNow: () => wall }
    const engine = new TimerEngine('note.md', 500, clock)
    engine.start()
    mono = 1_000
    expect(engine.elapsedMs()).toBe(1_500)
    engine.pause()
    mono = 5_000
    engine.resume()
    mono = 6_500
    expect(engine.elapsedMs()).toBe(3_000)
    expect(engine.snapshot().segments.filter(segment => segment.kind === 'work')).toHaveLength(2)
    expect(engine.snapshot().segments.filter(segment => segment.kind === 'pause')).toHaveLength(1)
  })

  it('finishes a paused timer without counting its pause segment', () => {
    let mono = 0
    const engine = new TimerEngine('note.md', 0, { monotonicNow: () => mono, wallClockNow: () => 1_000 })
    engine.start()
    mono = 1_000
    engine.pause()
    mono = 10_000
    engine.stop()
    expect(engine.elapsedMs()).toBe(1_000)
    expect(engine.snapshot().segments.filter(segment => segment.kind === 'pause')).toHaveLength(1)
  })

  it('does not report sleep wake for a normal interval', () => {
    let mono = 0
    let wall = 1_000
    const engine = new TimerEngine('note.md', 0, { monotonicNow: () => mono, wallClockNow: () => wall })
    engine.start()
    mono = 1_000
    wall = 2_000
    expect(engine.detectSleepWake()).toBe(false)
  })

  it('round trips recovery checkpoints', () => {
    const timer: TimerInstance = { id: 'timer', notePath: 'note.md', name: 'Note', status: 'PAUSED', elapsed: 1200, startTime: 0, pausedOffset: 1200, baseElapsed: 0, color: '#fff' }
    saveRecoveryCheckpoint(timer, 1200, 1200)
    expect(loadRecoveryCheckpoints()).toMatchObject([{ timerId: 'timer', elapsed: 1200 }])
    clearRecoveryCheckpoints()
    expect(loadRecoveryCheckpoints()).toEqual([])
  })

  it('keeps operation journal retryable and idempotent by id', () => {
    clearOperationJournal()
    beginOperation('save', 'note.md', 'operation-1')
    failOperation('operation-1', new Error('temporary'), 'failed')
    expect(listPendingOperations()).toHaveLength(1)
    beginOperation('save', 'note.md', 'operation-1')
    completeOperation('operation-1')
    expect(listPendingOperations()).toEqual([])
  })

  it('compares content snapshots even when metadata is unavailable', () => {
    expect(sameFileSnapshot(snapshotFromContent('note.md', 'abc'), snapshotFromContent('note.md', 'abc'))).toBe(true)
    expect(sameFileSnapshot(snapshotFromContent('note.md', 'abc'), snapshotFromContent('note.md', 'abd'))).toBe(false)
  })
})
