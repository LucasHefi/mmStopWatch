import { beforeEach, describe, expect, it, vi } from 'vitest'

const fs = vi.hoisted(() => ({
  readDir: vi.fn(),
  readTextFile: vi.fn(),
  stat: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-fs', () => fs)

import { NoteIndex } from '../services/noteIndex'

const options = { folder: '/vault', frontmatterKey: 'Timework' }
const directory = (name: string) => ({ name, isDirectory: true, isFile: false, isSymlink: false })
const file = (name: string) => ({ name, isDirectory: false, isFile: true, isSymlink: false })

beforeEach(() => {
  vi.clearAllMocks()
  fs.stat.mockResolvedValue({ size: 20, mtime: new Date(0) })
  fs.readTextFile.mockResolvedValue('---\nTimework: 00:05:00\n---\nReadable note')
})

describe('NoteIndex directory boundaries', () => {
  it('does not inspect hidden tooling directories such as .kilocode', async () => {
    fs.readDir.mockImplementation(async (path: string) => {
      if (path === '/vault') return [directory('.kilocode'), directory('notes')]
      if (path === '/vault/notes') return [file('work.md')]
      throw new Error('forbidden path: ' + path)
    })

    const sessions = await new NoteIndex().load(options)

    expect(sessions).toHaveLength(1)
    expect(sessions[0].relativePath).toBe('notes/work.md')
    expect(fs.readDir).not.toHaveBeenCalledWith('/vault/.kilocode')
  })

  it('indexes app-owned .mmST-* directories but skips other hidden directories', async () => {
    fs.readDir.mockImplementation(async (path: string) => {
      if (path === '/vault') return [directory('.mmST-alice'), directory('.obsidian'), directory('.hidden'), file('root.md')]
      if (path === '/vault/.mmST-alice') return [file('app-note.md')]
      throw new Error('forbidden path: ' + path)
    })

    const sessions = await new NoteIndex().load(options)

    expect(sessions.map(session => session.relativePath)).toEqual(['.mmST-alice/app-note.md', 'root.md'])
    expect(fs.readDir).toHaveBeenCalledWith('/vault/.mmST-alice')
    expect(fs.readDir).not.toHaveBeenCalledWith('/vault/.obsidian')
    expect(fs.readDir).not.toHaveBeenCalledWith('/vault/.hidden')
  })

  it('skips an inaccessible ordinary child directory and keeps readable notes', async () => {
    fs.readDir.mockImplementation(async (path: string) => {
      if (path === '/vault') return [directory('restricted'), file('root.md')]
      if (path === '/vault/restricted') throw new Error('forbidden path: ' + path)
      throw new Error('unexpected path: ' + path)
    })

    const sessions = await new NoteIndex().load(options)

    expect(sessions).toHaveLength(1)
    expect(sessions[0].relativePath).toBe('root.md')
  })

  it('skips an unreadable Markdown file and keeps the remaining notes', async () => {
    fs.readDir.mockImplementation(async (path: string) => {
      if (path === '/vault') return [file('blocked.md'), file('ok.md')]
      throw new Error('unexpected path: ' + path)
    })
    fs.readTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('blocked.md')) throw new Error('forbidden path: ' + path)
      return '---\nTimework: 00:05:00\n---\nReadable note'
    })

    const sessions = await new NoteIndex().load(options)

    expect(sessions).toHaveLength(1)
    expect(sessions[0].relativePath).toBe('ok.md')
  })

  it('still reports a failure when the selected vault root cannot be read', async () => {
    fs.readDir.mockRejectedValue(new Error('vault root unavailable'))

    await expect(new NoteIndex().load(options)).rejects.toThrow('vault root unavailable')
  })
})
