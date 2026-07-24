import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../types/session'
import { useTimersStore } from '../stores/timersStore'

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'note-1',
    name: 'Release notes',
    started_at: 0,
    ended_at: 0,
    duration_ms: 500,
    created_at: 0,
    notePath: 'D:/vault/release.md',
    ...overrides,
  }
}

describe('timersStore lifecycle', () => {
  beforeEach(() => {
    useTimersStore.getState().resetAll()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not reset a timer that is already running', () => {
    const now = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(5_000)

    useTimersStore.getState().addTimer(session())
    const id = useTimersStore.getState().timers[0].id

    useTimersStore.getState().startTimer(id)
    useTimersStore.getState().startTimer(id)

    expect(useTimersStore.getState().timers[0].startTime).toBe(1_000)
    expect(now).toHaveBeenCalledTimes(1)
  })

  it('preserves elapsed time across pause, resume, and stop', async () => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(3_000)
      .mockReturnValueOnce(5_000)

    useTimersStore.getState().addTimer(session())
    const id = useTimersStore.getState().timers[0].id
    useTimersStore.getState().startTimer(id)
    useTimersStore.getState().pauseTimer(id)
    useTimersStore.getState().startTimer(id)

    const save = vi.fn().mockResolvedValue(undefined)
    await useTimersStore.getState().stopTimer(id, save)

    expect(save).toHaveBeenCalledWith(3_500, 'D:/vault/release.md', id)
    expect(useTimersStore.getState().timers).toHaveLength(0)
  })

  it('keeps the timer available when persistence fails', async () => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)

    useTimersStore.getState().addTimer(session())
    const id = useTimersStore.getState().timers[0].id
    useTimersStore.getState().startTimer(id)

    const save = vi.fn().mockRejectedValue(new Error('disk full'))
    await expect(useTimersStore.getState().stopTimer(id, save)).rejects.toThrow('disk full')

    expect(useTimersStore.getState().timers).toHaveLength(1)
  })

  it('coalesces concurrent stop requests into one persistence write', async () => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)

    useTimersStore.getState().addTimer(session())
    const id = useTimersStore.getState().timers[0].id
    useTimersStore.getState().startTimer(id)

    let finishSave!: () => void
    const save = vi.fn(() => new Promise<void>(resolve => {
      finishSave = resolve
    }))

    const first = useTimersStore.getState().stopTimer(id, save)
    const second = useTimersStore.getState().stopTimer(id, save)

    expect(save).toHaveBeenCalledTimes(1)
    expect(useTimersStore.getState().hasTimerForNote('D:/vault/release.md')).toBe(true)
    finishSave()
    await Promise.all([first, second])
    expect(useTimersStore.getState().timers).toHaveLength(0)
  })
})
