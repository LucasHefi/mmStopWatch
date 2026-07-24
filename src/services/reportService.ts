import type { ActivityEntry, Session } from '../types/session'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { formatMs } from './stats'

function toLocalDateStr(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function generateWeeklyReport(
  entries: ActivityEntry[],
  sessions: Session[],
  dailyGoalMs: number,
  nick: string
): string {
  const now = Date.now()
  const weekStart = now - 604800000

  const weekEntries = entries.filter(e => e.timestamp >= weekStart)
  const weekSessions = sessions.filter(s => s.created_at >= weekStart)

  return buildReport(weekEntries, weekSessions, dailyGoalMs, nick, 'Weekly', 7)
}

export function generateMonthlyReport(
  entries: ActivityEntry[],
  sessions: Session[],
  dailyGoalMs: number,
  nick: string
): string {
  const now = Date.now()
  const monthStart = now - 2592000000

  const monthEntries = entries.filter(e => e.timestamp >= monthStart)
  const monthSessions = sessions.filter(s => s.created_at >= monthStart)

  return buildReport(monthEntries, monthSessions, dailyGoalMs, nick, 'Monthly', 30)
}

function buildReport(
  entries: ActivityEntry[],
  sessions: Session[],
  dailyGoalMs: number,
  nick: string,
  label: string,
  rangeDays: number
): string {
  const totalMs = entries.reduce((sum, e) => sum + e.duration_ms, 0)
  const entryCount = entries.length
  const avgMs = entryCount > 0 ? Math.floor(totalMs / entryCount) : 0
  const daysTracked = new Set(entries.map(e => toLocalDateStr(e.timestamp))).size

  // Per-note breakdown
  const noteMap = new Map<string, { totalMs: number; count: number }>()
  for (const e of entries) {
    const key = e.noteName || e.notePath
    const existing = noteMap.get(key) || { totalMs: 0, count: 0 }
    noteMap.set(key, { totalMs: existing.totalMs + e.duration_ms, count: existing.count + 1 })
  }
  const sortedNotes = Array.from(noteMap.entries()).sort((a, b) => b[1].totalMs - a[1].totalMs)

  // Per-day breakdown
  const dayMap = new Map<string, number>()
  for (const e of entries) {
    const dateStr = toLocalDateStr(e.timestamp)
    dayMap.set(dateStr, (dayMap.get(dateStr) || 0) + e.duration_ms)
  }

  // Tag breakdown from sessions
  const tagMap = new Map<string, { totalMs: number; count: number }>()
  for (const s of sessions) {
    if (!s.tags || !s.duration_ms) continue
    for (const tag of s.tags) {
      const existing = tagMap.get(tag) || { totalMs: 0, count: 0 }
      tagMap.set(tag, { totalMs: existing.totalMs + s.duration_ms, count: existing.count + 1 })
    }
  }
  const sortedTags = Array.from(tagMap.entries()).sort((a, b) => b[1].totalMs - a[1].totalMs).slice(0, 10)

  // Estimate accuracy
  const sessionsWithEstimates = sessions.filter(s => s.timeEstimate != null && s.duration_ms != null)
  let metEstimates = 0
  let missedEstimates = 0
  for (const s of sessionsWithEstimates) {
    const estMs = (s.timeEstimate || 0) * 60000
    if ((s.duration_ms || 0) <= estMs) metEstimates++
    else missedEstimates++
  }

  const now = new Date()
  let md = `# ${label} Report — ${nick}\n\n`
  md += `_Generated: ${now.toLocaleString()}_\n\n`

  md += `## Overview\n\n`
  md += `- **Period:** last ${rangeDays} days\n`
  md += `- **Total time:** ${formatMs(totalMs)}\n`
  md += `- **Total entries:** ${entryCount}\n`
  md += `- **Average per entry:** ${formatMs(avgMs)}\n`
  md += `- **Days tracked:** ${daysTracked}\n`
  md += `- **Daily goal:** ${formatMs(dailyGoalMs)}\n\n`

  const daysMetGoal = Array.from(dayMap.values()).filter(ms => ms >= dailyGoalMs).length
  md += `- **Days meeting goal:** ${daysMetGoal} / ${daysTracked}\n`
  if (daysTracked > 0) {
    md += `- **Goal hit rate:** ${Math.round((daysMetGoal / daysTracked) * 100)}%\n`
  }
  md += '\n'

  // Daily breakdown
  md += `## Daily Breakdown\n\n`
  md += '| Date | Time | Goal |\n'
  md += '| :--- | :--- | :--- |\n'

  const today = new Date()
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const ds = toLocalDateStr(d.getTime())
    const ms = dayMap.get(ds) || 0
    const pct = dailyGoalMs > 0 ? Math.round((ms / dailyGoalMs) * 100) : 0
    const icon = ms >= dailyGoalMs ? '✅' : ms > 0 ? '⚠️' : '—'
    md += `| ${ds} | ${formatMs(ms)} | ${icon} ${pct}%\n`
  }
  md += '\n'

  // Top notes
  if (sortedNotes.length > 0) {
    md += `## Top Notes\n\n`
    md += '| Note | Total | Sessions |\n'
    md += '| :--- | :--- | :--- |\n'
    for (const [name, data] of sortedNotes.slice(0, 15)) {
      md += `| ${name} | ${formatMs(data.totalMs)} | ${data.count} |\n`
    }
    md += '\n'
  }

  // Top tags
  if (sortedTags.length > 0) {
    md += `## Top Tags\n\n`
    md += '| Tag | Total | Sessions |\n'
    md += '| :--- | :--- | :--- |\n'
    for (const [tag, data] of sortedTags) {
      md += `| ${tag} | ${formatMs(data.totalMs)} | ${data.count} |\n`
    }
    md += '\n'
  }

  // Estimate accuracy
  if (sessionsWithEstimates.length > 0) {
    md += `## Estimate Accuracy\n\n`
    md += `- **Sessions with estimates:** ${sessionsWithEstimates.length}\n`
    md += `- **Met estimates:** ${metEstimates}\n`
    md += `- **Missed estimates:** ${missedEstimates}\n`
    md += `- **Accuracy:** ${sessionsWithEstimates.length > 0 ? Math.round((metEstimates / sessionsWithEstimates.length) * 100) : 0}%\n\n`
  }

  md += `---\n\n_Report generated by mmStopWatch_\n`

  return md
}

export async function saveReportToVault(
  content: string,
  notesFolder: string,
  type: 'weekly' | 'monthly'
): Promise<string | null> {
  const now = new Date()
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const filename = `mmST-${type}-report-${dateStr}.md`
  const filePath = `${notesFolder}/${filename}`

  try {
    await writeTextFile(filePath, content)
    return filePath
  } catch (e) {
    console.error(`Failed to save ${type} report:`, e)
    return null
  }
}
