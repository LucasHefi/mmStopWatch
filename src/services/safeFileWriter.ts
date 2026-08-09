import { readTextFile, stat, writeTextFile, rename, remove } from '@tauri-apps/plugin-fs'

export interface FileSnapshot {
  path: string
  size: number
  mtimeMs: number | null
  contentHash: string
}

export class FileConflictError extends Error {
  readonly code = 'FILE_CONFLICT' as const
  constructor(public readonly path: string, public readonly expected?: FileSnapshot, public readonly actual?: FileSnapshot) {
    super('File changed outside mmStopWatch: ' + path)
    this.name = 'FileConflictError'
  }
}

function hashContent(content: string): string {
  let hash = 2166136261
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function byteLength(content: string): number {
  return new TextEncoder().encode(content).byteLength
}

function getMtimeMs(value: Date | number | null | undefined): number | null {
  if (value instanceof Date) return value.getTime()
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

async function readMetadata(path: string): Promise<{ size: number; mtimeMs: number | null } | null> {
  try {
    const info = await stat(path)
    return { size: info.size, mtimeMs: getMtimeMs(info.mtime) }
  } catch {
    return null
  }
}

export async function readFileSnapshot(path: string): Promise<FileSnapshot | null> {
  try {
    const content = await readTextFile(path)
    const metadata = await readMetadata(path)
    return { path, size: metadata?.size ?? byteLength(content), mtimeMs: metadata?.mtimeMs ?? null, contentHash: hashContent(content) }
  } catch {
    return null
  }
}

export function snapshotFromContent(path: string, content: string): FileSnapshot {
  return { path, size: byteLength(content), mtimeMs: null, contentHash: hashContent(content) }
}

export function sameFileSnapshot(left: FileSnapshot | null | undefined, right: FileSnapshot | null | undefined): boolean {
  if (!left || !right) return left === right
  return left.path === right.path && left.size === right.size && (left.mtimeMs === null || right.mtimeMs === null || left.mtimeMs === right.mtimeMs) && left.contentHash === right.contentHash
}

function temporaryPath(path: string): string {
  return path + '.mmst-tmp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
}

async function renameAtomically(from: string, to: string): Promise<void> {
  await rename(from, to)
}

export async function writeTextFileAtomically(path: string, content: string, expected?: FileSnapshot | null): Promise<FileSnapshot> {
  const current = await readFileSnapshot(path)
  if (expected !== undefined && !sameFileSnapshot(current, expected)) throw new FileConflictError(path, expected ?? undefined, current ?? undefined)

  const temp = temporaryPath(path)
  try {
    await writeTextFile(temp, content)
    const beforeCommit = await readFileSnapshot(path)
    if (expected !== undefined && !sameFileSnapshot(beforeCommit, expected)) throw new FileConflictError(path, expected ?? undefined, beforeCommit ?? undefined)
    await renameAtomically(temp, path)
  } catch (error) {
    try {
      await remove(temp)
    } catch {
      // Best effort cleanup; preserve the operation error.
    }
    throw error
  }

  return (await readFileSnapshot(path)) ?? snapshotFromContent(path, content)
}
