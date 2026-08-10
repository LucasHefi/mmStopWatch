// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, symlink, rm, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { VaultAdapter, parseLimit } from '../../tools/vaultAdapter'

let testDir = ''

afterEach(async () => {
  if (testDir) {
    await rm(testDir, { recursive: true, force: true }).catch(() => {})
    testDir = ''
  }
})

async function createTempVault(): Promise<string> {
  testDir = await mkdtemp(join(tmpdir(), 'mmst-vault-'))
  return testDir
}

async function addNote(vaultRoot: string, relPath: string, content: string): Promise<void> {
  const fullPath = join(vaultRoot, relPath)
  const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
  await mkdir(dir, { recursive: true })
  await writeFile(fullPath, content)
}

async function addSymlink(vaultRoot: string, targetRel: string, linkPath: string): Promise<void> {
  const target = join(vaultRoot, targetRel)
  const link = join(vaultRoot, linkPath)
  const slashIndex = link.lastIndexOf('/')
  if (slashIndex > 0) {
    await mkdir(link.substring(0, slashIndex), { recursive: true })
  }
  await symlink(target, link)
}

describe('VaultAdapter', () => {
  it('loads md files, parses frontmatter durationMs, tags, and hasFrontmatter', async () => {
    const vault = await createTempVault()
    await addNote(vault, 'proj/daily.md', '---\nTimework: 00:30:00\ntags: [dev, meeting]\n---\nSome content')
    await addNote(vault, 'readme.md', '# No frontmatter\nJust content')

    const adapter = new VaultAdapter({ vaultPath: vault, frontmatterKey: 'Timework' })
    await adapter.load()

    const result = adapter.listNotes({})
    expect(result.notes).toHaveLength(2)
    expect(result.revision).toBeTruthy()

    const daily = result.notes.find(n => n.relativePath === 'proj/daily.md')
    expect(daily).toBeDefined()
    expect(daily!.durationMs).toBe(30 * 60_000)
    expect(daily!.tags).toEqual(['dev', 'meeting'])
    expect(daily!.hasFrontmatter).toBe(true)

    const readme = result.notes.find(n => n.relativePath === 'readme.md')
    expect(readme).toBeDefined()
    expect(readme!.durationMs).toBe(0)
    expect(readme!.tags).toEqual([])
    expect(readme!.hasFrontmatter).toBe(false)
  })

  it('gets note metadata by a validated relative path without exposing vault paths', async () => {
    const vault = await createTempVault()
    await addNote(vault, 'proj/daily.md', '---\nTimework: 00:30:00\ntags: [dev]\n---\nbody')

    const adapter = new VaultAdapter({ vaultPath: vault, frontmatterKey: 'Timework' })
    await adapter.load()

    const found = adapter.getNote({ relativePath: 'proj/daily.md' })
    expect(found.note).toMatchObject({ relativePath: 'proj/daily.md', durationMs: 30 * 60_000, tags: ['dev'] })
    expect(found.revision).toBeTruthy()
    expect(adapter.getNote({ relativePath: 'missing.md' }).note).toBeUndefined()
    expect(() => adapter.getNote({ relativePath: '../escape.md' })).toThrow()
    expect(JSON.stringify(found)).not.toContain(vault)
  })

  it('skips hidden directories, node_modules, and symlinks', async () => {
    const vault = await createTempVault()
    await addNote(vault, 'src/app.md', '---\nTimework: 01:00:00\n---\napp')

    await mkdir(join(vault, '.obsidian'))
    await writeFile(join(vault, '.obsidian', 'secret.md'), '---\nTimework: 99:00:00\n---\nsecret')

    await mkdir(join(vault, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(vault, 'node_modules', 'pkg', 'readme.md'), '---\nTimework: 99:00:00\n---\nlib')

    await writeFile(join(vault, 'real-target.md'), '---\nTimework: 00:15:00\n---\ntarget')
    await addSymlink(vault, 'real-target.md', 'link-note.md')
    await mkdir(join(vault, 'real-dir'))
    await writeFile(join(vault, 'real-dir', 'inner.md'), '---\nTimework: 99:00:00\n---\ninner')
    await symlink(join(vault, 'real-dir'), join(vault, 'link-dir'))

    const adapter = new VaultAdapter({ vaultPath: vault, frontmatterKey: 'Timework' })
    await adapter.load()

    const result = adapter.listNotes({})
    expect(result.notes).toHaveLength(3)
    expect(result.notes.map(n => n.relativePath)).toEqual(expect.arrayContaining([
      'src/app.md',
      'real-dir/inner.md',
      'real-target.md',
    ]))
    const paths = result.notes.map(n => n.relativePath)
    expect(paths).not.toContain('link-note.md')
  })

  it('handles malformed frontmatter gracefully, not exposing absolute paths', async () => {
    const vault = await createTempVault()
    await addNote(vault, 'broken.md', '---\nTimework: broken\n---\n\nBody here')

    const adapter = new VaultAdapter({ vaultPath: vault, frontmatterKey: 'Timework' })
    await adapter.load()

    const result = adapter.listNotes({})
    expect(result.notes).toHaveLength(1)
    expect(result.notes[0].durationMs).toBe(0)
    expect(result.notes[0].hasFrontmatter).toBe(true)
    expect(result.notes[0].name).toBe('broken')
    expect(JSON.stringify(result)).not.toContain(vault)
  })

  it('supports limit and cursor pagination', async () => {
    const vault = await createTempVault()
    for (let i = 0; i < 5; i++) {
      await addNote(vault, `note-${i}.md`, `---\nTimework: 00:${String(i).padStart(2, '0')}:00\n---\nnote ${i}`)
    }

    const adapter = new VaultAdapter({ vaultPath: vault, frontmatterKey: 'Timework' })
    await adapter.load()

    const page1 = adapter.listNotes({ limit: 2 })
    expect(page1.notes).toHaveLength(2)
    expect(page1.nextCursor).toBe('2')
    expect(page1.revision).toBeTruthy()

    const page2 = adapter.listNotes({ limit: 2, cursor: page1.nextCursor })
    expect(page2.notes).toHaveLength(2)
    expect(page2.nextCursor).toBe('4')

    const page3 = adapter.listNotes({ limit: 2, cursor: page2.nextCursor })
    expect(page3.notes).toHaveLength(1)
    expect(page3.nextCursor).toBeUndefined()
  })

  it('rejects limit with out-of-range or non-integer values, defaults only undefined', async () => {
    const vault = await createTempVault()
    for (let i = 0; i < 25; i++) {
      await addNote(vault, `note-${String(i).padStart(2, '0')}.md`, '---\nTimework: 00:00:00\n---\n\nnote')
    }

    const adapter = new VaultAdapter({ vaultPath: vault, frontmatterKey: 'Timework' })
    await adapter.load()

    expect(adapter.listNotes({}).notes).toHaveLength(20)

    expect(() => adapter.listNotes({ limit: 0 })).toThrow()
    expect(() => adapter.listNotes({ limit: 101 })).toThrow()
    expect(() => adapter.listNotes({ limit: -1 })).toThrow()
    expect(() => adapter.listNotes({ limit: 1.5 })).toThrow()
    expect(() => adapter.listNotes({ limit: NaN })).toThrow()
    expect(() => adapter.listNotes({ limit: Infinity })).toThrow()

    expect(adapter.listNotes({ limit: 1 }).notes).toHaveLength(1)
    expect(adapter.listNotes({ limit: 100 }).notes).toHaveLength(25)
  })

  it('filters by case-insensitive query on name and relativePath', async () => {
    const vault = await createTempVault()
    await addNote(vault, 'projects/WORK.md', '---\nTimework: 00:00:00\n---\n\nwork')
    await addNote(vault, 'projects/personal.md', '---\nTimework: 00:00:00\n---\n\npersonal')
    await addNote(vault, 'ARCHIVE.md', '---\nTimework: 00:00:00\n---\n\narchive')

    const adapter = new VaultAdapter({ vaultPath: vault, frontmatterKey: 'Timework' })
    await adapter.load()

    expect(adapter.listNotes({ query: 'work' }).notes).toHaveLength(1)
    expect(adapter.listNotes({ query: 'WORK' }).notes[0].name).toBe('WORK')
    expect(adapter.listNotes({ query: 'project' }).notes).toHaveLength(2)
    expect(adapter.listNotes({ query: 'ARCHIVE' }).notes).toHaveLength(1)
    expect(adapter.listNotes({ query: 'nonexistent' }).notes).toHaveLength(0)
  })

  it('filters by tags (all requested tags must match, case-insensitive)', async () => {
    const vault = await createTempVault()
    await addNote(vault, 'a.md', '---\ntags: [dev, meeting]\nTimework: 00:00:00\n---\n\na')
    await addNote(vault, 'b.md', '---\ntags: [DEV, review]\nTimework: 00:00:00\n---\n\nb')
    await addNote(vault, 'c.md', '---\ntags: dev\nTimework: 00:00:00\n---\n\nc')
    await addNote(vault, 'd.md', '---\nTimework: 00:00:00\n---\n\nd')

    const adapter = new VaultAdapter({ vaultPath: vault, frontmatterKey: 'Timework' })
    await adapter.load()

    expect(adapter.listNotes({ tags: ['dev'] }).notes).toHaveLength(3)
    expect(adapter.listNotes({ tags: ['DEV'] }).notes).toHaveLength(3)
    expect(adapter.listNotes({ tags: ['dev', 'meeting'] }).notes).toHaveLength(1)
    expect(adapter.listNotes({ tags: ['nonexistent'] }).notes).toHaveLength(0)
  })

  it('combines query and tag filtering', async () => {
    const vault = await createTempVault()
    await addNote(vault, 'dev/project.md', '---\ntags: [dev]\nTimework: 00:00:00\n---\n\nproj')
    await addNote(vault, 'bugs/task.md', '---\ntags: [dev]\nTimework: 00:00:00\n---\n\nbug')
    await addNote(vault, 'bugs/other.md', '---\ntags: [docs]\nTimework: 00:00:00\n---\n\ndocs')

    const adapter = new VaultAdapter({ vaultPath: vault, frontmatterKey: 'Timework' })
    await adapter.load()

    expect(adapter.listNotes({ query: 'bug', tags: ['dev'] }).notes).toHaveLength(1)
    expect(adapter.listNotes({ query: 'bug', tags: ['dev'] }).notes[0].relativePath).toBe('bugs/task.md')
  })

  it('throws on invalid cursor (negative, non-integer, non-finite) instead of silently falling back', async () => {
    const vault = await createTempVault()
    await addNote(vault, 'note.md', '---\nTimework: 00:00:00\n---\n\nbody')

    const adapter = new VaultAdapter({ vaultPath: vault, frontmatterKey: 'Timework' })
    await adapter.load()

    expect(() => adapter.listNotes({ cursor: '-1' })).toThrow()
    expect(() => adapter.listNotes({ cursor: 'invalid' })).toThrow()
    expect(() => adapter.listNotes({ cursor: '1.5' })).toThrow()
    expect(() => adapter.listNotes({ cursor: 'NaN' })).toThrow()
    expect(() => adapter.listNotes({ cursor: 'Infinity' })).toThrow()

    expect(adapter.listNotes({ cursor: '999' }).notes).toHaveLength(0)
  })

  it('deterministic revision changes on content change', async () => {
    const vault = await createTempVault()
    await addNote(vault, 'note.md', '---\nTimework: 00:00:00\n---\n\nbody')

    const adapter = new VaultAdapter({ vaultPath: vault, frontmatterKey: 'Timework' })
    await adapter.load()
    const rev1 = adapter.listNotes({}).revision

    await writeFile(join(vault, 'note.md'), '---\nTimework: 01:00:00\n---\n\nchanged')
    await adapter.load()
    const rev2 = adapter.listNotes({}).revision

    expect(rev1).not.toBe(rev2)
  })

  it('revision covers all NoteDto fields including name, tags, and hasFrontmatter', async () => {
    const vault = await createTempVault()
    await addNote(vault, 'note.md', '---\nTimework: 00:00:00\ntags: [dev]\n---\n\nbody')

    const adapter = new VaultAdapter({ vaultPath: vault, frontmatterKey: 'Timework' })
    await adapter.load()
    const rev1 = adapter.listNotes({}).revision

    await writeFile(join(vault, 'note.md'), '---\nTimework: 00:00:00\ntags: [ops]\n---\n\nbody')
    await adapter.load()
    const rev2 = adapter.listNotes({}).revision
    expect(rev1).not.toBe(rev2)

    await writeFile(join(vault, 'renamed.md'), '---\nTimework: 00:00:00\ntags: [ops]\n---\n\nbody')
    await rm(join(vault, 'note.md'))
    await adapter.load()
    const rev3 = adapter.listNotes({}).revision
    expect(rev2).not.toBe(rev3)

    await writeFile(join(vault, 'renamed.md'), '')
    await adapter.load()
    const rev4 = adapter.listNotes({}).revision
    expect(rev3).not.toBe(rev4)
  })

  it('throws when vault root does not exist', async () => {
    const adapter = new VaultAdapter({ vaultPath: '/nonexistent/path/for/testing', frontmatterKey: 'Timework' })
    await expect(adapter.load()).rejects.toThrow()
  })

  it('throws when vault root is a file, not a directory', async () => {
    const vault = await createTempVault()
    const filePath = join(vault, 'file.txt')
    await writeFile(filePath, 'not a directory')

    const adapter = new VaultAdapter({ vaultPath: filePath, frontmatterKey: 'Timework' })
    await expect(adapter.load()).rejects.toThrow()
  })

  it('throws when vault root is a symlink', async () => {
    const vault = await createTempVault()
    const realDir = join(vault, 'real')
    await mkdir(realDir)
    const linkPath = join(vault, 'link')
    await symlink(realDir, linkPath)

    const adapter = new VaultAdapter({ vaultPath: linkPath, frontmatterKey: 'Timework' })
    await expect(adapter.load()).rejects.toThrow()
  })

  it('throws for non-absolute vault path', async () => {
    const adapter = new VaultAdapter({ vaultPath: 'relative/path', frontmatterKey: 'Timework' })
    await expect(adapter.load()).rejects.toThrow()
  })

  it('skips unreadable child directories instead of misclassifying them as root failure', async () => {
    const vault = await createTempVault()
    await addNote(vault, 'valid/note.md', '---\nTimework: 01:00:00\n---\nok')
    const lockedDir = join(vault, 'valid', 'locked')
    await mkdir(lockedDir)
    await writeFile(join(lockedDir, 'hidden.md'), '---\nTimework: 99:00:00\n---\n\nsecret')
    await chmod(lockedDir, 0o000)

    try {
      const adapter = new VaultAdapter({ vaultPath: vault, frontmatterKey: 'Timework' })
      await adapter.load()

      const result = adapter.listNotes({})
      expect(result.notes).toHaveLength(1)
      expect(result.notes[0].relativePath).toBe('valid/note.md')
    } finally {
      await chmod(lockedDir, 0o755)
    }
  })
})

describe('parseLimit', () => {
  it('returns default 20 only when undefined, throws for out-of-range or non-integer', () => {
    expect(parseLimit(undefined)).toBe(20)

    expect(() => parseLimit(0)).toThrow()
    expect(() => parseLimit(-1)).toThrow()
    expect(() => parseLimit(101)).toThrow()
    expect(() => parseLimit(1.5)).toThrow()
    expect(() => parseLimit(NaN)).toThrow()
    expect(() => parseLimit(Infinity)).toThrow()
  })

  it('respects bounds 1..100', () => {
    expect(parseLimit(1)).toBe(1)
    expect(parseLimit(50)).toBe(50)
    expect(parseLimit(100)).toBe(100)
  })
})
