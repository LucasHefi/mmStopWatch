import { readDir, readTextFile, stat } from '@tauri-apps/plugin-fs'
import type { Session } from '../types/session'
import { parseFrontmatter, parseTimeToMs } from './frontmatterParser'
import { isPathInside, validateAbsoluteVaultPath } from './pathSecurity'

export interface NoteIndexOptions {
  folder: string
  frontmatterKey: string
  timeEstimateKey?: string
  statsFieldKeys?: string[]
}

interface CacheEntry {
  signature: string
  session: Session
}

interface FileMetadata {
  signature: string
  mtimeMs: number | null
}

function isInternalDirectory(name: string): boolean {
  const normalized = name
  // Hidden folders contain app metadata, plugins or tooling rather than vault
  // notes. This includes .obsidian, .mmST-* and .kilocode.
  return normalized.startsWith('.') || normalized === 'node_modules'
}

function isSafeEntryName(name: string): boolean {
  return Boolean(name)
    && name !== '.'
    && name !== '..'
    && !/[\u0000-\u001f\u007f/\\]/.test(name)
}

async function metadata(path: string): Promise<FileMetadata | null> {
  try {
    const info = await stat(path)
    const value = info.mtime
    const mtimeMs = value instanceof Date ? value.getTime() : typeof value === 'number' && Number.isFinite(value) ? value : null
    return { signature: String(info.size) + '|' + String(mtimeMs ?? ''), mtimeMs }
  } catch {
    return null
  }
}

export class NoteIndex {
  private cache = new Map<string, CacheEntry>()
  private folder: string | null = null
  private optionsSignature: string | null = null
  private revision = 0

  clear(): void {
    this.cache.clear()
    this.folder = null
    this.optionsSignature = null
    this.revision += 1
  }

  getRevision(): number { return this.revision }

  async load(options: NoteIndexOptions): Promise<Session[]> {
    const folder = validateAbsoluteVaultPath(options.folder)
    const optionsSignature = JSON.stringify({ folder, frontmatterKey: options.frontmatterKey, timeEstimateKey: options.timeEstimateKey || '', statsFieldKeys: options.statsFieldKeys || [] })
    if (this.folder !== folder || this.optionsSignature !== optionsSignature) {
      this.cache.clear()
      this.folder = folder
      this.optionsSignature = optionsSignature
    }
    const files: string[] = []
    await this.collect(folder, files, folder, true)
    const active = new Set(files)
    for (const key of this.cache.keys()) if (!active.has(key)) this.cache.delete(key)
    const sessions: Session[] = []
    for (const path of files) {
      const fileMetadata = await metadata(path)
      const cached = this.cache.get(path)
      if (cached && fileMetadata && cached.signature === fileMetadata.signature) {
        sessions.push(cached.session)
        continue
      }
      const session = await this.readSession(path, folder, options, fileMetadata?.mtimeMs ?? Date.now())
      if (!session) continue
      this.cache.set(path, { signature: fileMetadata?.signature || String(session.duration_ms) + '|' + session.preview, session })
      sessions.push(session)
    }
    this.revision += 1
    return sessions
  }

  private async collect(directory: string, files: string[], root: string, isRoot = false): Promise<void> {
    let entries
    try {
      entries = await readDir(directory)
    } catch (error) {
      // A child directory may be unreadable because of permissions or a stale
      // runtime scope. Keep the rest of the vault usable; only the selected
      // root remains a fatal boundary.
      if (isRoot) throw error
      console.warn('Skipping inaccessible notes directory', directory, error)
      return
    }

    for (const entry of entries) {
      const name = entry.name || ''
      if (!isSafeEntryName(name)) continue
      const path = directory + '/' + name
      if (!isPathInside(root, path)) continue
      if (entry.isDirectory && !entry.isSymlink) {
        if (!isInternalDirectory(name)) await this.collect(path, files, root)
      } else if (entry.isFile && !entry.isSymlink && name.toLowerCase().endsWith('.md') && !name.includes('.mmst-tmp-')) {
        files.push(path)
      }
    }
  }

  private async readSession(path: string, folder: string, options: NoteIndexOptions, fileTimeMs: number): Promise<Session | null> {
    try {
      const content = await readTextFile(path)
      const parsed = parseFrontmatter(content)
      const value = parsed.data[options.frontmatterKey]
      const parsedTime = value == null ? { ms: 0 } : parseTimeToMs(String(value))
      if (!isPathInside(folder, path)) return null
      const relativePath = path.startsWith(folder + '/') ? path.slice(folder.length + 1) : path
      const body = parsed.content.trim().split('\n').slice(0, 3).join(' ').trim()
      const fields: Record<string, string | string[]> = {}
      for (const key of options.statsFieldKeys || []) if (parsed.data[key] != null) fields[key] = parsed.data[key] as string | string[]
      return {
        id: path, name: path.split(/[\\/]/).pop()?.replace(/\.md$/i, '') || path,
        started_at: fileTimeMs, ended_at: fileTimeMs, created_at: fileTimeMs, duration_ms: parsedTime.ms,
        tags: Array.isArray(parsed.data.tags) ? parsed.data.tags as string[] : typeof parsed.data.tags === 'string' ? [parsed.data.tags] : [],
        notePath: path, frontmatterKey: options.frontmatterKey, parseError: parsedTime.error, relativePath,
        preview: body.length > 120 ? body.slice(0, 117) + '...' : body || undefined,
        timeEstimate: parsed.data[options.timeEstimateKey || 'timeEstimate'] == null ? undefined : Number(parsed.data[options.timeEstimateKey || 'timeEstimate']),
        frontmatterFields: Object.keys(fields).length ? fields : undefined,
      }
    } catch (error) {
      console.error('Failed to index note', path, error)
      return null
    }
  }
}

export const noteIndex = new NoteIndex()
