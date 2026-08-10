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
})
