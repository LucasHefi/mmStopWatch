import { readFile, lstat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { validateAbsoluteVaultPath, validateProfileKey } from '../src/services/pathSecurity'
import { formatMs } from '../src/services/stats'
import type { ActivityEntry, ActivityHistory } from '../src/types/session'
import type { StatsDto, ReportPreviewDto } from '../src/application/contracts'

const MAX_REPORT_CHARS = 20_000

function isSafeNotePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  const trimmed = value.trim()
  if (trimmed.startsWith('/') || trimmed.startsWith('\\') || trimmed.startsWith('~/')) return false
  if (/^[a-z]:[/\\]/i.test(trimmed)) return false
  if (trimmed.includes('..')) return false
  if (/[\0\u0000-\u001f\u007f]/.test(trimmed)) return false
  return true
}

function isSafeNoteName(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  const trimmed = value.trim()
  if (trimmed.length > 500) return false
  if (/[\0\u0000-\u001f\u007f]/.test(trimmed)) return false
  return true
}

function isValidTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0
}

function isValidDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
}

function validateEntry(entry: unknown, index: number): ActivityEntry {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`Activity entry ${index} is not an object`)
  }
  const e = entry as Record<string, unknown>
  if (!isValidTimestamp(e.timestamp)) {
    throw new Error(`Activity entry ${index} has invalid timestamp`)
  }
  if (!isValidDuration(e.duration_ms)) {
    throw new Error(`Activity entry ${index} has invalid duration_ms`)
  }
  if (!isSafeNotePath(e.notePath)) {
    throw new Error(`Activity entry ${index} has unsafe notePath`)
  }
  if (!isSafeNoteName(e.noteName)) {
    throw new Error(`Activity entry ${index} has unsafe noteName`)
  }
  return {
    timestamp: e.timestamp as number,
    duration_ms: e.duration_ms as number,
    notePath: e.notePath as string,
    noteName: e.noteName as string,
    ...(isValidTimestamp(e.saved_at) ? { saved_at: e.saved_at as number } : {}),
    ...(isValidTimestamp(e.end_timestamp) ? { end_timestamp: e.end_timestamp as number } : {}),
    ...(typeof e.operation_id === 'string' && e.operation_id.trim()
      ? { operation_id: e.operation_id as string }
      : {}),
  }
}

export class ActivityAdapter {
  private entries: ActivityEntry[] = []

  constructor(
    private readonly vaultPath: string,
    private readonly nick: string,
  ) {
    validateAbsoluteVaultPath(vaultPath)
    validateProfileKey(nick)
  }

  async load(): Promise<void> {
    const vaultRoot = resolve(this.vaultPath)
    let rootStat
    try {
      rootStat = await lstat(vaultRoot)
    } catch {
      throw new Error('Vault root does not exist')
    }
    if (!rootStat.isDirectory()) throw new Error('Vault root is not a directory')
    if (rootStat.isSymbolicLink()) throw new Error('Vault root cannot be a symbolic link')

    const storageDir = `${vaultRoot}/.mmST-${this.nick}`
    let dirStat
    try {
      dirStat = await lstat(storageDir)
    } catch {
      this.entries = []
      return
    }
    if (dirStat.isSymbolicLink()) throw new Error('Storage directory cannot be a symbolic link')
    if (!dirStat.isDirectory()) throw new Error('Storage path is not a directory')

    const activityPath = `${storageDir}/activity.json`
    let fileStat
    try {
      fileStat = await lstat(activityPath)
    } catch {
      this.entries = []
      return
    }
    if (fileStat.isSymbolicLink()) throw new Error('activity.json cannot be a symbolic link')
    if (!fileStat.isFile()) throw new Error('activity.json is not a file')

    let content: string
    try {
      content = await readFile(activityPath, 'utf8')
    } catch {
      throw new Error('Cannot read activity.json')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new Error('activity.json is not valid JSON')
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('activity.json must contain a JSON object')
    }

    const history = parsed as ActivityHistory
    if (!Array.isArray(history.entries)) {
      throw new Error('activity.json entries must be an array')
    }

    const validated: ActivityEntry[] = []
    for (let i = 0; i < history.entries.length; i++) {
      validated.push(validateEntry(history.entries[i], i))
    }

    this.entries = validated
  }

  getEntries(): ActivityEntry[] {
    return this.entries
  }
}

function parseIsoTimestamp(value: string): number {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Date value must be a non-empty string')
  }
  const trimmed = value.trim()
  const ts = Date.parse(trimmed)
  if (!Number.isFinite(ts)) {
    throw new Error('Invalid ISO date string')
  }
  return ts
}

export function getStats(
  entries: ActivityEntry[],
  options: { from?: string; to?: string },
): StatsDto {
  let fromMs = -Infinity
  let toMs = Infinity

  if (options.from) {
    fromMs = parseIsoTimestamp(options.from)
  }
  if (options.to) {
    toMs = parseIsoTimestamp(options.to)
  }

  if (fromMs >= toMs) {
    throw new Error('from must be before to')
  }

  const filtered = entries.filter(e => e.timestamp >= fromMs && e.timestamp < toMs)
  const totalDurationMs = filtered.reduce((sum, e) => sum + e.duration_ms, 0)
  const noteSet = new Set(filtered.map(e => e.notePath))

  return {
    ...(options.from ? { from: options.from } : {}),
    ...(options.to ? { to: options.to } : {}),
    totalDurationMs,
    sessionCount: filtered.length,
    noteCount: noteSet.size,
  }
}

function toLocalDateStr(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function previewReport(
  entries: ActivityEntry[],
  options: { from?: string; to?: string; format?: 'markdown' },
): ReportPreviewDto {
  let fromMs = -Infinity
  let toMs = Infinity

  if (options.from) {
    fromMs = parseIsoTimestamp(options.from)
  }
  if (options.to) {
    toMs = parseIsoTimestamp(options.to)
  }

  if (fromMs >= toMs) {
    throw new Error('from must be before to')
  }

  const filtered = entries.filter(e => e.timestamp >= fromMs && e.timestamp < toMs)
  const totalMs = filtered.reduce((sum, e) => sum + e.duration_ms, 0)
  const entryCount = filtered.length
  const avgMs = entryCount > 0 ? Math.floor(totalMs / entryCount) : 0

  const noteMap = new Map<string, { totalMs: number; count: number }>()
  for (const e of filtered) {
    const key = e.noteName || e.notePath
    const existing = noteMap.get(key) || { totalMs: 0, count: 0 }
    noteMap.set(key, { totalMs: existing.totalMs + e.duration_ms, count: existing.count + 1 })
  }
  const sortedNotes = Array.from(noteMap.entries()).sort((a, b) => b[1].totalMs - a[1].totalMs)

  const dayMap = new Map<string, number>()
  for (const e of filtered) {
    const ds = toLocalDateStr(e.timestamp)
    dayMap.set(ds, (dayMap.get(ds) || 0) + e.duration_ms)
  }

  const now = new Date()
  let md = '# Activity Report\n\n'
  md += `_Generated: ${now.toLocaleString()}_\n\n`
  md += `## Overview\n\n`
  md += `- **Total time:** ${formatMs(totalMs)}\n`
  md += `- **Total entries:** ${entryCount}\n`
  md += `- **Average per entry:** ${formatMs(avgMs)}\n`
  md += `- **Unique notes:** ${sortedNotes.length}\n`
  if (options.from || options.to) {
    if (options.from) md += `- **From:** ${options.from}\n`
    if (options.to) md += `- **To:** ${options.to}\n`
  }
  md += '\n'

  if (dayMap.size > 0) {
    md += `## Daily Breakdown\n\n`
    md += '| Date | Time | Entries |\n'
    md += '| :--- | :--- | :--- |\n'
    const sortedDays = Array.from(dayMap.entries()).sort((a, b) => b[0].localeCompare(a[0]))
    for (const [day, ms] of sortedDays.slice(0, 30)) {
      const dayCount = filtered.filter(e => toLocalDateStr(e.timestamp) === day).length
      md += `| ${day} | ${formatMs(ms)} | ${dayCount} |\n`
    }
    md += '\n'
  }

  if (sortedNotes.length > 0) {
    md += `## Top Notes\n\n`
    md += '| Note | Total | Entries |\n'
    md += '| :--- | :--- | :--- |\n'
    for (const [name, data] of sortedNotes.slice(0, 15)) {
      md += `| ${name} | ${formatMs(data.totalMs)} | ${data.count} |\n`
    }
    md += '\n'
  }

  md += `---\n\n_Report generated by mmStopWatch_\n`

  let truncated = false
  if (md.length > MAX_REPORT_CHARS) {
    truncated = true
    md = md.slice(0, MAX_REPORT_CHARS - 14) + '\n...truncated'
  }

  return {
    format: 'markdown',
    content: md,
    truncated,
  }
}
