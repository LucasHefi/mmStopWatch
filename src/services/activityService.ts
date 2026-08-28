import type { ActivityEntry, ActivityHistory } from '../types/session'
import { loadActivity, saveActivity } from './appConfig'
import { useSessionStore } from '../stores/sessionStore'
import { resolveVaultMarkdownPath } from './pathSecurity'
import { writeTextFileAtomically } from './safeFileWriter'

class ActivityService {
  private history: ActivityHistory = { entries: [] }
  private historyCache: Map<string, ActivityHistory> = new Map()
  private writeQueues: Map<string, Promise<void>> = new Map()
  private currentFolder: string | null = null
  private currentNick: string | null = null
  private loadGeneration = 0
  private cacheLoadGenerations: Map<string, number> = new Map()

  private cacheKey(folderPath: string, nick: string | null): string {
    return `${folderPath}\u0000${nick ?? ''}`
  }

  async loadHistory(folderPath: string): Promise<ActivityHistory> {
    const { mdConfig } = useSessionStore.getState()
    const nick = mdConfig.nick || null
    const generation = ++this.loadGeneration
    const key = this.cacheKey(folderPath, nick)
    const cacheGeneration = (this.cacheLoadGenerations.get(key) ?? 0) + 1
    this.cacheLoadGenerations.set(key, cacheGeneration)
    let history: ActivityHistory
    try {
      history = await loadActivity(folderPath, nick)
    } catch (error) {
      if (this.cacheLoadGenerations.get(key) === cacheGeneration) this.historyCache.delete(key)
      throw error
    }
    if (!Array.isArray(history.entries)) {
      history.entries = []
    }
    if (this.cacheLoadGenerations.get(key) === cacheGeneration) this.historyCache.set(key, history)
    if (generation === this.loadGeneration) {
      this.currentFolder = folderPath
      this.currentNick = nick
      this.history = history
    }
    return history
  }

  async logActivity(
    duration_ms: number,
    notePath: string,
    noteName: string,
    folderPath = this.currentFolder,
    nick = this.currentNick,
    operationId?: string,
  ): Promise<void> {
    if (!folderPath || !nick) return
    const key = this.cacheKey(folderPath, nick)
    const previous = this.writeQueues.get(key) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(async () => {
      let history = this.historyCache.get(key)
      if (!history) {
        history = await loadActivity(folderPath, nick)
        if (!Array.isArray(history.entries)) history.entries = []
      }
      if (operationId && history.entries.some(entry => entry.operation_id === operationId)) return

      const now = Date.now()
      const startTs = now - duration_ms
      const startDate = new Date(startTs)
      const endDate = new Date(now)
      const entries: ActivityEntry[] = []

      const sameDay = startDate.getFullYear() === endDate.getFullYear()
        && startDate.getMonth() === endDate.getMonth()
        && startDate.getDate() === endDate.getDate()

      if (sameDay) {
        entries.push({ timestamp: startTs, duration_ms, notePath, noteName, saved_at: now, end_timestamp: now, operation_id: operationId })
      } else {
        const midnight = new Date(startDate)
        midnight.setDate(midnight.getDate() + 1)
        midnight.setHours(0, 0, 0, 0)
        const firstPartMs = midnight.getTime() - startTs
        entries.push({ timestamp: startTs, duration_ms: firstPartMs, notePath, noteName, saved_at: now, end_timestamp: midnight.getTime(), operation_id: operationId })
        entries.push({ timestamp: midnight.getTime(), duration_ms: duration_ms - firstPartMs, notePath, noteName, saved_at: now, end_timestamp: now, operation_id: operationId })
      }

      const updated = { entries: [...history.entries, ...entries] }
      await saveActivity(updated, folderPath, nick)
      this.historyCache.set(key, updated)
      if (this.currentFolder === folderPath && this.currentNick === nick) this.history = updated
    })

    this.writeQueues.set(key, operation)
    try {
      await operation
    } finally {
      if (this.writeQueues.get(key) === operation) this.writeQueues.delete(key)
    }
  }

  getHistory(): ActivityHistory {
    return this.history
  }

  /** Load activity data for a specific nick into cache (read-only). */
  async loadHistoryForNick(folderPath: string, nick: string): Promise<ActivityHistory> {
    const key = this.cacheKey(folderPath, nick)
    const cached = this.historyCache.get(key)
    if (cached) return cached
    const data = await loadActivity(folderPath, nick)
    if (!Array.isArray(data.entries)) data.entries = []
    this.historyCache.set(key, data)
    return data
  }

  /** Get activity from cache for a specific nick. */
  getHistoryForNick(nick: string): ActivityHistory {
    return this.currentFolder
      ? this.historyCache.get(this.cacheKey(this.currentFolder, nick)) || { entries: [] }
      : { entries: [] }
  }

  private formatMs(ms: number): string {
    const totalSec = Math.floor(ms / 1000)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    return `${h}h ${m}m ${s}s`
  }

  async exportToMd(filteredEntries?: ActivityEntry[]): Promise<string | null> {
    if (!this.currentFolder) return null

    const entries = filteredEntries ?? this.history.entries
    if (entries.length === 0) return null

    const exportPath = resolveVaultMarkdownPath(this.currentFolder, 'statistics.md')

    // Group by date
    const dailyTotals = new Map<string, number>()
    const dailyCounts = new Map<string, number>()
    const noteTotals = new Map<string, { ms: number; count: number }>()

    for (const entry of entries) {
      const d = new Date(entry.timestamp)
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      dailyTotals.set(date, (dailyTotals.get(date) || 0) + entry.duration_ms)
      dailyCounts.set(date, (dailyCounts.get(date) || 0) + 1)

      const noteKey = entry.noteName || entry.notePath
      const existing = noteTotals.get(noteKey) || { ms: 0, count: 0 }
      noteTotals.set(noteKey, {
        ms: existing.ms + entry.duration_ms,
        count: existing.count + 1,
      })
    }

    const sortedDates = Array.from(dailyTotals.keys()).sort((a, b) => b.localeCompare(a))
    const totalMs = entries.reduce((sum, e) => sum + e.duration_ms, 0)
    const avgMs = entries.length > 0 ? Math.floor(totalMs / entries.length) : 0
    const longestMs = Math.max(...entries.map(e => e.duration_ms), 0)

    let content = `# mmStopWatch Statistics\n\n`
    content += `_Generated: ${new Date().toLocaleString()}_\n\n`
    content += `## Overview\n\n`
    content += `- **Total time:** ${this.formatMs(totalMs)}\n`
    content += `- **Total entries:** ${entries.length}\n`
    content += `- **Average per entry:** ${this.formatMs(avgMs)}\n`
    content += `- **Longest entry:** ${this.formatMs(longestMs)}\n`
    content += `- **Days tracked:** ${sortedDates.length}\n\n`

    content += '## Daily Totals\n\n'
    content += '| Date | Duration | Sessions |\n'
    content += '| :--- | :--- | :--- |\n'

    for (const date of sortedDates) {
      const ms = dailyTotals.get(date) || 0
      const count = dailyCounts.get(date) || 0
      content += `| ${date} | ${this.formatMs(ms)} | ${count} |\n`
    }

    content += '\n\n## Per-Note Breakdown\n\n'
    content += '| Note | Total | Sessions |\n'
    content += '| :--- | :--- | :--- |\n'

    const sortedNotes = Array.from(noteTotals.entries()).sort((a, b) => b[1].ms - a[1].ms)
    for (const [note, data] of sortedNotes) {
      content += `| ${note} | ${this.formatMs(data.ms)} | ${data.count} |\n`
    }

    content += '\n\n## Detailed Log\n\n'
    content += '| Date | Note | Duration | Saved At |\n'
    content += '| :--- | :--- | :--- | :--- |\n'

    const sortedEntries = [...entries].sort((a, b) => b.timestamp - a.timestamp)
    for (const entry of sortedEntries) {
      const date = new Date(entry.timestamp).toLocaleString()
      const saved = entry.saved_at ? new Date(entry.saved_at).toLocaleString() : '-'
      content += `| ${date} | ${entry.noteName} | ${this.formatMs(entry.duration_ms)} | ${saved} |\n`
    }

    try {
      await writeTextFileAtomically(exportPath, content)
      return exportPath
    } catch (e) {
      console.error('Failed to export statistics:', e)
      return null
    }
  }
}

export const activityService = new ActivityService()
