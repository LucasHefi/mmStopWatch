import { describe, it, expect, vi } from 'vitest'

const fs = vi.hoisted(() => ({
  readDir: vi.fn(),
  readTextFile: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'appData' },
  readDir: fs.readDir,
  readTextFile: fs.readTextFile,
}))

import { loadNotesFromFolder, parseFrontmatter, updateFrontmatter, parseTimeToMs } from '../services/mdStorage'

const directory = (name: string) => ({ name, isDirectory: true, isFile: false, isSymlink: false })
const file = (name: string) => ({ name, isDirectory: false, isFile: true, isSymlink: false })

describe('parseFrontmatter', () => {
  it('parses simple key: value frontmatter', () => {
    const content = '---\ntitle: Test\ncreated: 2024-01-01\n---\nBody text'
    const result = parseFrontmatter(content)
    expect(result.data).toEqual({ title: 'Test', created: '2024-01-01' })
    expect(result.content).toBe('Body text')
  })

  it('parses numeric values', () => {
    const content = '---\ncount: 42\nTimework: 3600\n---\nBody'
    const result = parseFrontmatter(content)
    expect(result.data.count).toBe(42)
    expect(result.data.Timework).toBe(3600)
  })

  it('parses inline arrays', () => {
    const content = '---\ntags: [tag1, tag2, tag3]\n---\nBody'
    const result = parseFrontmatter(content)
    expect(result.data.tags).toEqual(['tag1', 'tag2', 'tag3'])
  })

  it('parses an empty inline array as an empty array', () => {
    const content = '---\ntags: []\n---\nBody'
    const result = parseFrontmatter(content)
    expect(result.data.tags).toEqual([])
  })

  it('parses boolean values', () => {
    const content = '---\nenabled: true\nvisible: false\n---\nBody'
    const result = parseFrontmatter(content)
    expect(result.data.enabled).toBe(true)
    expect(result.data.visible).toBe(false)
  })

  it('handles null/empty values', () => {
    const content = '---\nkey:\n---\nBody'
    const result = parseFrontmatter(content)
    expect(result.data.key).toBeNull()
  })

  it('handles multiline strings with |', () => {
    const content = '---\ndescription: |\n  Line one\n  Line two\n---\nBody'
    const result = parseFrontmatter(content)
    expect(result.data.description).toBeTruthy()
    expect(typeof result.data.description).toBe('string')
  })

  it('returns empty data for no frontmatter', () => {
    const content = 'Just body text'
    const result = parseFrontmatter(content)
    expect(result.data).toEqual({})
    expect(result.content).toBe('Just body text')
  })

  it('handles comments in frontmatter', () => {
    const content = '---\ntitle: Test\n# this is a comment\nversion: 2\n---\nBody'
    const result = parseFrontmatter(content)
    expect(result.data.title).toBe('Test')
    expect(result.data.version).toBe(2)
  })

  it('handles quoted strings', () => {
    const content = "---\ntitle: 'Hello World'\n---\nBody"
    const result = parseFrontmatter(content)
    expect(result.data.title).toBe('Hello World')
  })
})

describe('loadNotesFromFolder directory boundaries', () => {
  it('indexes app-owned .mmST-* directories but skips other hidden directories', async () => {
    vi.clearAllMocks()
    fs.readDir.mockImplementation(async (path: string) => {
      if (path === '/vault') return [directory('.mmST-alice'), directory('.obsidian'), file('root.md')]
      if (path === '/vault/.mmST-alice') return [file('app-note.md')]
      throw new Error('forbidden path: ' + path)
    })
    fs.readTextFile.mockResolvedValue('---\nTimework: 00:05:00\n---\nReadable note')

    const sessions = await loadNotesFromFolder('/vault', 'Timework')

    expect(sessions.map(session => session.relativePath)).toEqual(['.mmST-alice/app-note.md', 'root.md'])
    expect(fs.readDir).toHaveBeenCalledWith('/vault/.mmST-alice')
    expect(fs.readDir).not.toHaveBeenCalledWith('/vault/.obsidian')
  })
})

describe('updateFrontmatter', () => {
  it('adds key to existing frontmatter', () => {
    const content = '---\ntitle: Test\n---\nBody'
    const result = updateFrontmatter(content, 'Timework', '01:30:00')
    expect(result).toContain('Timework: 01:30:00')
    expect(result).toContain('Body')
  })

  it('creates frontmatter if none exists', () => {
    const content = 'Body text'
    const result = updateFrontmatter(content, 'Timework', '3600')
    expect(result).toMatch(/^---\n/)
    expect(result).toContain('Timework: 3600')
    expect(result).toContain('Body text')
  })

  it('updates existing value', () => {
    const content = '---\nTimework: 1000\n---\nBody'
    const result = updateFrontmatter(content, 'Timework', '2000')
    expect(result).toContain('Timework: 2000')
    expect(result).not.toContain('Timework: 1000')
  })

  it('handles number values', () => {
    const content = '---\ntitle: Test\n---\nBody'
    const result = updateFrontmatter(content, 'timeEstimate', 30)
    expect(result).toContain('timeEstimate: 30')
  })

  it('does not overwrite keys with the same prefix', () => {
    const content = '---\nTimeworkTotal: 100\nTimework: 50\n---\nBody'
    const result = updateFrontmatter(content, 'Timework', '75')
    expect(result).toContain('TimeworkTotal: 100')
    expect(result).toContain('Timework: 75')
  })
})

describe('parseTimeToMs', () => {
  it('parses HH:mm:ss format', () => {
    expect(parseTimeToMs('01:30:00').ms).toBe(5400000)
    expect(parseTimeToMs('00:01:00').ms).toBe(60000)
    expect(parseTimeToMs('01:00').ms).toBe(3600000)
  })

  it('parses plain seconds', () => {
    expect(parseTimeToMs('3600').ms).toBe(3600000)
    expect(parseTimeToMs('0').ms).toBe(0)
  })

  it('returns error for empty string', () => {
    expect(parseTimeToMs('').error).toBe('Empty time value')
  })

  it('returns error for negative time', () => {
    const result = parseTimeToMs('-1:00:00')
    expect(result.error).toBeTruthy()
  })

  it('returns error for invalid format', () => {
    expect(parseTimeToMs('abc').error).toBe('Invalid time format')
  })
})
