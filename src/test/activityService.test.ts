import { beforeEach, describe, expect, it, vi } from 'vitest'

const persistence = vi.hoisted(() => ({
  loadActivity: vi.fn(),
  saveActivity: vi.fn(),
}))

vi.mock('../services/appConfig', async () => {
  const actual = await vi.importActual<typeof import('../services/appConfig')>('../services/appConfig')
  return {
    ...actual,
    loadActivity: persistence.loadActivity,
    saveActivity: persistence.saveActivity,
  }
})

import { activityService } from '../services/activityService'
import { useSessionStore } from '../stores/sessionStore'

describe('activityService profile isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    persistence.saveActivity.mockResolvedValue(undefined)
  })

  it('does not let a stale profile load replace the active history', async () => {
    let resolveA!: (history: { entries: [] }) => void
    let resolveB!: (history: { entries: [] }) => void
    persistence.loadActivity
      .mockImplementationOnce(() => new Promise(resolve => { resolveA = resolve }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveB = resolve }))

    useSessionStore.setState(state => ({ mdConfig: { ...state.mdConfig, nick: 'alice' } }))
    const loadA = activityService.loadHistory('D:/vault-a')
    useSessionStore.setState(state => ({ mdConfig: { ...state.mdConfig, nick: 'bob' } }))
    const loadB = activityService.loadHistory('D:/vault-b')

    resolveB({ entries: [] })
    const historyB = await loadB
    resolveA({ entries: [] })
    await loadA

    expect(activityService.getHistory()).toBe(historyB)
  })

  it('persists a delayed activity under its captured profile identity', async () => {
    persistence.loadActivity.mockResolvedValue({ entries: [] })
    useSessionStore.setState(state => ({ mdConfig: { ...state.mdConfig, nick: 'bob' } }))
    await activityService.loadHistory('D:/vault-b')

    await activityService.logActivity(1_000, 'D:/vault-a/note.md', 'note', 'D:/vault-a', 'alice')

    expect(persistence.saveActivity).toHaveBeenCalledWith(
      expect.objectContaining({ entries: [expect.objectContaining({ notePath: 'D:/vault-a/note.md' })] }),
      'D:/vault-a',
      'alice',
    )
  })

  it('serializes concurrent writes for the same profile without losing entries', async () => {
    let finishFirstSave!: () => void
    persistence.loadActivity.mockResolvedValue({ entries: [] })
    persistence.saveActivity
      .mockImplementationOnce(() => new Promise<void>(resolve => { finishFirstSave = resolve }))
      .mockResolvedValueOnce(undefined)

    useSessionStore.setState(state => ({ mdConfig: { ...state.mdConfig, nick: 'alice' } }))
    await activityService.loadHistory('D:/vault-a')

    const first = activityService.logActivity(1_000, 'D:/vault-a/one.md', 'one', 'D:/vault-a', 'alice')
    const second = activityService.logActivity(2_000, 'D:/vault-a/two.md', 'two', 'D:/vault-a', 'alice')
    await vi.waitFor(() => expect(persistence.saveActivity).toHaveBeenCalledTimes(1))
    finishFirstSave()
    await Promise.all([first, second])

    expect(persistence.saveActivity).toHaveBeenCalledTimes(2)
    expect(persistence.saveActivity.mock.calls[1][0].entries).toHaveLength(2)
  })

  it('does not write from stale cache after a reload fails', async () => {
    persistence.loadActivity
      .mockResolvedValueOnce({ entries: [{ timestamp: 1, duration_ms: 1_000, notePath: 'D:/vault-a/old.md', noteName: 'old' }] })
      .mockRejectedValue(new Error('activity unreadable'))
    useSessionStore.setState(state => ({ mdConfig: { ...state.mdConfig, nick: 'alice' } }))
    await activityService.loadHistory('D:/vault-a')

    await expect(activityService.loadHistory('D:/vault-a')).rejects.toThrow('activity unreadable')
    await expect(
      activityService.logActivity(2_000, 'D:/vault-a/new.md', 'new', 'D:/vault-a', 'alice'),
    ).rejects.toThrow('activity unreadable')

    expect(persistence.saveActivity).not.toHaveBeenCalled()
  })
})
