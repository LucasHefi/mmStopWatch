import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MDConfig, VaultProfile } from '../types/session'

const fs = vi.hoisted(() => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  readDir: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-fs', () => fs)

import {
  defaultConfig,
  loadActivity,
  saveActivity,
  saveConfig,
  saveCurrentProfile,
  saveDeleted,
  switchProfile,
} from '../services/appConfig'

function profile(overrides: Partial<VaultProfile> = {}): VaultProfile {
  return {
    id: 'vault-a',
    name: 'Vault A',
    notesFolder: 'D:/vault-a',
    nick: 'tester',
    frontmatterKey: 'Timework',
    timeEstimateKey: 'timeEstimate',
    timeFormat: 'HH:mm:ss',
    dailyGoalMs: 3_600_000,
    ...overrides,
  }
}

describe('multi-profile config persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fs.exists.mockResolvedValue(false)
    fs.mkdir.mockResolvedValue(undefined)
    fs.writeTextFile.mockResolvedValue(undefined)
  })

  it('persists config in the active vault profile directory', async () => {
    const config = { ...defaultConfig(), notesFolder: 'D:/vault-a', nick: 'tester' }

    await saveConfig(config, config.notesFolder, config.nick)

    expect(fs.mkdir).toHaveBeenCalledWith('D:/vault-a/.mmST-tester', { recursive: true })
    expect(fs.writeTextFile).toHaveBeenCalledWith(
      'D:/vault-a/.mmST-tester/config.json',
      JSON.stringify(config, null, 2),
    )
  })

  it('updates only the active profile before saving', async () => {
    const config: MDConfig = {
      ...defaultConfig(),
      notesFolder: 'D:/vault-a-new',
      nick: 'new-nick',
      activeProfileId: 'vault-a',
      profiles: [profile(), profile({ id: 'vault-b', name: 'Vault B', notesFolder: 'D:/vault-b' })],
    }

    const saved = await saveCurrentProfile(config)

    expect(saved.profiles?.find(item => item.id === 'vault-a')).toMatchObject({
      notesFolder: 'D:/vault-a-new',
      nick: 'new-nick',
    })
    expect(saved.profiles?.find(item => item.id === 'vault-b')).toMatchObject({
      name: 'Vault B',
      notesFolder: 'D:/vault-b',
    })
  })

  it('preserves an explicit zero daily goal when switching profiles', async () => {
    const config: MDConfig = {
      ...defaultConfig(),
      dailyGoalMs: 3_600_000,
      profiles: [profile({ dailyGoalMs: 0 })],
    }

    const switched = await switchProfile(config, 'vault-a')

    expect(switched.dailyGoalMs).toBe(0)
  })

  it('rejects config persistence when the profile directory cannot be created', async () => {
    const config = { ...defaultConfig(), notesFolder: 'D:/vault-a', nick: 'tester' }
    fs.mkdir.mockRejectedValueOnce(new Error('mkdir denied'))

    await expect(saveConfig(config, config.notesFolder, config.nick)).rejects.toThrow('mkdir denied')
    expect(fs.writeTextFile).not.toHaveBeenCalled()
  })

  it('rejects activity persistence when the file write fails', async () => {
    fs.writeTextFile.mockRejectedValueOnce(new Error('disk full'))

    await expect(saveActivity({ entries: [] }, 'D:/vault-a', 'tester')).rejects.toThrow('disk full')
  })

  it('rejects activity loading when an existing history cannot be read', async () => {
    fs.exists.mockResolvedValueOnce(true)
    fs.readTextFile.mockRejectedValueOnce(new Error('read denied'))

    await expect(loadActivity('D:/vault-a', 'tester')).rejects.toThrow('read denied')
  })

  it('rejects deleted-session persistence when the file write fails', async () => {
    fs.writeTextFile.mockRejectedValueOnce(new Error('read only'))

    await expect(saveDeleted([], 'D:/vault-a', 'tester')).rejects.toThrow('read only')
  })
})
