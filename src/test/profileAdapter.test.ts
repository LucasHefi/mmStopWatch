// @vitest-environment node

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProfileAdapter } from '../../tools/profileAdapter'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('ProfileAdapter', () => {
  it('lists safe profile metadata from vault-local config files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mmstopwatch-profile-'))
    roots.push(root)
    await mkdir(join(root, '.mmST-alice'))
    await mkdir(join(root, '.mmST-bob'))
    await writeFile(join(root, '.mmST-alice', 'config.json'), JSON.stringify({
      activeProfileId: 'vault-a',
      profiles: [
        { id: 'vault-a', name: 'Work', nick: 'alice', notesFolder: '/secret/work' },
        { id: 'vault-b', name: 'Personal', nick: 'bob', notesFolder: '/secret/personal' },
      ],
      token: 'must-not-leak',
    }))
    await writeFile(join(root, '.mmST-bob', 'config.json'), JSON.stringify({
      activeProfileId: 'vault-b',
      profiles: [{ id: 'vault-b', name: 'Personal', nick: 'bob', notesFolder: '/secret/personal' }],
    }))

    const result = await new ProfileAdapter(root).listProfiles()

    expect(result).toEqual({
      profiles: [
        { id: 'vault-a', name: 'Work', nick: 'alice', active: true },
        { id: 'vault-b', name: 'Personal', nick: 'bob', active: false },
      ],
      activeProfileId: 'vault-a',
    })
    expect(JSON.stringify(result)).not.toContain('/secret')
    expect(JSON.stringify(result)).not.toContain('token')
  })

  it('skips malformed config files and keeps readable profiles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mmstopwatch-profile-'))
    roots.push(root)
    await mkdir(join(root, '.mmST-bad'))
    await mkdir(join(root, '.mmST-good'))
    await writeFile(join(root, '.mmST-bad', 'config.json'), '{broken')
    await writeFile(join(root, '.mmST-good', 'config.json'), JSON.stringify({
      profiles: [{ id: 'vault-good', name: 'Good', nick: 'good' }],
    }))

    await expect(new ProfileAdapter(root).listProfiles()).resolves.toEqual({
      profiles: [{ id: 'vault-good', name: 'Good', nick: 'good', active: false }],
    })
  })

  it('returns safe configuration metadata for the selected profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mmstopwatch-profile-'))
    roots.push(root)
    await mkdir(join(root, '.mmST-alice'))
    await writeFile(join(root, '.mmST-alice', 'config.json'), JSON.stringify({
      activeProfileId: 'vault-a',
      profiles: [{ id: 'vault-a', name: 'Work' }],
      notesFolder: '/secret/work',
      frontmatterKey: 'Timework',
      timeEstimateKey: 'timeEstimate',
      timeFormat: 'HH:mm:ss',
      language: 'cs',
      dailyGoalMs: 28_800_000,
      autoRefreshInterval: 10,
      notifications: { enabled: true, intervalMinutes: 60 },
      timerLimitAlert: { soundPath: '/secret/sound.wav' },
      token: 'must-not-leak',
    }))

    const result = await new ProfileAdapter(root).getConfig('alice')

    expect(result).toEqual({ config: {
      activeProfileId: 'vault-a',
      profileCount: 1,
      frontmatterKey: 'Timework',
      timeEstimateKey: 'timeEstimate',
      timeFormat: 'HH:mm:ss',
      language: 'cs',
      dailyGoalMs: 28_800_000,
      autoRefreshInterval: 10,
      notificationsEnabled: true,
    } })
    expect(JSON.stringify(result)).not.toContain('/secret')
    expect(JSON.stringify(result)).not.toContain('token')
  })

  it('returns notification capability metadata without the configured sound path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mmstopwatch-profile-'))
    roots.push(root)
    await mkdir(join(root, '.mmST-alice'))
    await writeFile(join(root, '.mmST-alice', 'config.json'), JSON.stringify({
      notifications: { enabled: true, intervalMinutes: 30 },
      timerLimitAlert: { enabled: true, soundEnabled: false, notificationsEnabled: true, showOverlay: true, soundPath: '/secret/sound.wav' },
    }))

    const result = await new ProfileAdapter(root).getNotificationStatus('alice')

    expect(result).toEqual({ notifications: {
      enabled: true,
      intervalMinutes: 30,
      soundEnabled: false,
      notificationsEnabled: true,
      showOverlay: true,
    } })
    expect(JSON.stringify(result)).not.toContain('/secret')
    expect(JSON.stringify(result)).not.toContain('soundPath')
  })
})
