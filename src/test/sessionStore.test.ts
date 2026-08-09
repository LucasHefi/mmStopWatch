import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultProfile } from '../types/session'

const deps = vi.hoisted(() => ({
  loadHistory: vi.fn(),
  logActivity: vi.fn(),
  loadNotesFromFolder: vi.fn(),
}))

const fs = vi.hoisted(() => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  rename: vi.fn(),
  stat: vi.fn(),
  remove: vi.fn(),
  readDir: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-fs', () => fs)
vi.mock('../services/activityService', () => ({
  activityService: {
    loadHistory: deps.loadHistory,
    logActivity: deps.logActivity,
  },
}))
vi.mock('../services/mdStorage', async () => {
  const actual = await vi.importActual<typeof import('../services/mdStorage')>('../services/mdStorage')
  return { ...actual, loadNotesFromFolder: deps.loadNotesFromFolder }
})

import { defaultConfig } from '../services/appConfig'
import { useSessionStore } from '../stores/sessionStore'

describe('sessionStore initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    fs.exists.mockResolvedValue(false)
    fs.readDir.mockResolvedValue([])
    deps.loadHistory.mockResolvedValue({ entries: [] })
    deps.logActivity.mockResolvedValue(undefined)
    deps.loadNotesFromFolder.mockResolvedValue([])
  })

  it('restores an explicit zero daily goal from the active profile', async () => {
    const profile: VaultProfile = {
      id: 'vault-a',
      name: 'Vault A',
      notesFolder: 'D:/vault-a',
      nick: 'tester',
      frontmatterKey: 'Timework',
      timeEstimateKey: 'timeEstimate',
      timeFormat: 'HH:mm:ss',
      dailyGoalMs: 0,
    }
    localStorage.setItem('mmstopwatch_md_config', JSON.stringify({
      ...defaultConfig(),
      activeProfileId: profile.id,
      profiles: [profile],
    }))

    await useSessionStore.getState().initializeFromConfig()

    expect(useSessionStore.getState().mdConfig.dailyGoalMs).toBe(0)
  })

  it('does not overwrite an existing note when reading it fails', async () => {
    const config = {
      ...defaultConfig(),
      notesFolder: 'D:/vault-a',
      nick: 'tester',
    }
    useSessionStore.setState({ notesFolder: config.notesFolder, mdConfig: config })
    fs.readTextFile.mockRejectedValueOnce(new Error('read denied'))
    fs.exists.mockResolvedValueOnce(true)

    await expect(
      useSessionStore.getState().saveSessionToNote(1_000, 'D:/vault-a/existing.md'),
    ).rejects.toThrow('read denied')

    expect(fs.writeTextFile).not.toHaveBeenCalled()
  })

  it('retries a failed activity write with the original duration', async () => {
    const config = {
      ...defaultConfig(),
      notesFolder: 'D:/vault-a',
      nick: 'tester',
    }
    useSessionStore.setState({ notesFolder: config.notesFolder, mdConfig: config })
    fs.exists.mockResolvedValue(true)
    fs.readTextFile
      .mockResolvedValueOnce('---\nTimework: 00:00:00\n---\nbody')
      .mockResolvedValueOnce('---\nTimework: 00:00:00\n---\nbody')
      .mockResolvedValueOnce('---\nTimework: 00:00:00\n---\nbody')
      .mockResolvedValue('---\nTimework: 00:00:00\n---\nbody')
    deps.logActivity
      .mockRejectedValueOnce(new Error('activity unavailable'))
      .mockResolvedValueOnce(undefined)

    await expect(
      useSessionStore.getState().saveSessionToNote(1_000, 'D:/vault-a/existing.md', true, 'timer-1'),
    ).rejects.toThrow('activity unavailable')
    await useSessionStore.getState().saveSessionToNote(1_000, 'D:/vault-a/existing.md', true, 'timer-1')

    expect(deps.logActivity).toHaveBeenNthCalledWith(
      2,
      1_000,
      'D:/vault-a/existing.md',
      'existing',
      'D:/vault-a',
      'tester',
      'timer-1',
    )
  })
})
