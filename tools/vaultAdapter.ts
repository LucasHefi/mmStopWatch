import { readdir, readFile } from 'node:fs/promises'
import { lstat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { parseFrontmatter, parseTimeToMs } from '../src/services/frontmatterParser'
import type { NoteListInput, NoteDto, NoteListOutput } from '../src/application/contracts'
import { validateAbsoluteVaultPath } from '../src/services/pathSecurity'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const MIN_LIMIT = 1

export interface VaultAdapterOptions {
  vaultPath: string
  frontmatterKey: string
  timeEstimateKey?: string
  statsFieldKeys?: string[]
}

function isIgnored(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules'
}

function isSafeEntryName(name: string): boolean {
  return Boolean(name) && name !== '.' && name !== '..' && !/[\u0000-\u001f\u007f/\\]/.test(name)
}

function computeRevision(notes: NoteDto[]): string {
  const hash = createHash('sha256')
  for (const n of notes) {
    hash.update(n.relativePath)
    hash.update('\0')
    hash.update(n.name)
    hash.update('\0')
    hash.update(String(n.durationMs))
    hash.update('\0')
    hash.update(n.tags.join(','))
    hash.update('\0')
    hash.update(String(n.hasFrontmatter))
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 16)
}

function validateCursor(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error('Invalid cursor: must be a non-negative integer')
  }
  return parsed
}

export function parseLimit(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT
  if (!Number.isInteger(raw) || !Number.isFinite(raw) || raw < MIN_LIMIT || raw > MAX_LIMIT) {
    throw new Error('Invalid limit: must be an integer between 1 and 100')
  }
  return raw
}

function matchQuery(note: NoteDto, query: string): boolean {
  const lower = query.toLowerCase()
  return note.name.toLowerCase().includes(lower) || note.relativePath.toLowerCase().includes(lower)
}

function hasAllTags(noteTags: string[], requested: string[]): boolean {
  const lowerNoteTags = noteTags.map(t => t.toLowerCase())
  return requested.every(r => lowerNoteTags.includes(r.toLowerCase()))
}

export class VaultAdapter {
  private notes: NoteDto[] = []
  private revision = ''

  constructor(private readonly options: VaultAdapterOptions) {}

  async load(): Promise<void> {
    validateAbsoluteVaultPath(this.options.vaultPath)
    const resolvedRoot = resolve(this.options.vaultPath)

    let rootStat
    try {
      rootStat = await lstat(resolvedRoot)
    } catch {
      throw new Error('Vault root does not exist')
    }
    if (!rootStat.isDirectory()) throw new Error('Vault root is not a directory')
    if (rootStat.isSymbolicLink()) throw new Error('Vault root cannot be a symbolic link')

    const raw: NoteDto[] = []

    const walk = async (dir: string, isRoot: boolean): Promise<void> => {
      let entries: string[] = []
      try {
        entries = await readdir(dir)
      } catch {
        if (isRoot) throw new Error('Cannot read vault root directory')
        return
      }

      for (const name of entries) {
        if (!isSafeEntryName(name)) continue
        const fullPath = join(dir, name)

        let fileStat
        try {
          fileStat = await lstat(fullPath)
        } catch {
          continue
        }

        if (fileStat.isSymbolicLink()) continue

        if (fileStat.isDirectory()) {
          if (!isIgnored(name)) {
            await walk(fullPath, false)
          }
          continue
        }

        if (!fileStat.isFile()) continue
        if (!name.toLowerCase().endsWith('.md')) continue

        try {
          const content = await readFile(fullPath, 'utf8')
          const parsed = parseFrontmatter(content)
          const timeValue = parsed.data[this.options.frontmatterKey]
          let durationMs = 0
          if (timeValue != null) {
            const result = parseTimeToMs(String(timeValue))
            durationMs = result.ms
          }

          const relPath = relative(resolvedRoot, fullPath)
          const noteName = name.replace(/\.md$/i, '')

          const tags = Array.isArray(parsed.data.tags)
            ? parsed.data.tags as string[]
            : typeof parsed.data.tags === 'string'
              ? [parsed.data.tags]
              : []

          raw.push({
            relativePath: relPath,
            name: noteName,
            durationMs,
            tags,
            hasFrontmatter: Object.keys(parsed.data).length > 0,
          })
        } catch {
          continue
        }
      }
    }

    await walk(resolvedRoot, true)

    raw.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    this.notes = raw
    this.revision = computeRevision(raw)
  }

  listNotes(input: NoteListInput): NoteListOutput {
    const limit = parseLimit(input.limit)
    const cursor = validateCursor(input.cursor)
    let filtered = this.notes

    if (input.query) {
      const query = input.query
      filtered = filtered.filter(n => matchQuery(n, query))
    }

    if (input.tags && input.tags.length > 0) {
      const tags = input.tags
      filtered = filtered.filter(n => hasAllTags(n.tags, tags))
    }

    const total = filtered.length
    const start = cursor !== undefined ? cursor : 0

    if (start >= total) {
      return { notes: [], revision: this.revision }
    }

    const slice = filtered.slice(start, start + limit)

    return {
      notes: slice,
      ...(start + limit < total ? { nextCursor: String(start + slice.length) } : {}),
      revision: this.revision,
    }
  }
}
