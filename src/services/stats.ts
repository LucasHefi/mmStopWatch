import type {
  Session, StatsSummary, ActivityEntry, DayDetail, NoteBreakdown, WeeklyTrend, CalendarDay, EstimateAccuracy,
  DayOfWeekBreakdown, SessionLengthDistribution, WeekdayVsWeekend, ProductivityTrend,
  FieldNightWork, FieldAccuracy, CorrelationData
} from '../types/session'

export function resolveDailyGoalMs(value: number | undefined): number {
  return value ?? 28_800_000
}

export function isDailyGoalMet(durationMs: number, dailyGoalMs: number): boolean {
  return dailyGoalMs > 0 && durationMs >= dailyGoalMs
}

/** Convert timestamp to YYYY-MM-DD in local timezone */
function toLocalDateStr(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Get local midnight timestamp for a YYYY-MM-DD string */
function localMidnight(dateStr: string): number {
  return new Date(dateStr + 'T00:00:00').getTime()
}

export function computeStats(sessions: Session[], period: 'day' | 'week' | 'month', activityEntries: ActivityEntry[] = []): StatsSummary {
  const now = Date.now()
  let startMs: number
  if (period === 'day') {
    startMs = new Date().setHours(0, 0, 0, 0)
  } else if (period === 'week') {
    startMs = now - 604800000
  } else {
    startMs = now - 2592000000
  }

  if (activityEntries.length > 0) {
    const filtered = activityEntries.filter(e => e.timestamp >= startMs)
    if (filtered.length === 0) return { totalMs: 0, count: 0, avgMs: 0, longestMs: 0, shortestMs: 0 }
    const totalMs = filtered.reduce((sum, e) => sum + e.duration_ms, 0)
    const count = new Set(filtered.map(e => toLocalDateStr(e.timestamp))).size
    const avgMs = Math.floor(totalMs / count)
    const longestMs = Math.max(...filtered.map(e => e.duration_ms))
    const shortestMs = Math.min(...filtered.map(e => e.duration_ms))
    return { totalMs, count: filtered.length, avgMs, longestMs, shortestMs }
  }

  const filtered = sessions.filter(s => s.created_at >= startMs)
  if (filtered.length === 0) return { totalMs: 0, count: 0, avgMs: 0, longestMs: 0, shortestMs: 0 }
  const totalMs = filtered.reduce((sum, s) => sum + s.duration_ms, 0)
  const avgMs = Math.floor(totalMs / filtered.length)
  const longestMs = Math.max(...filtered.map(s => s.duration_ms))
  const shortestMs = Math.min(...filtered.map(s => s.duration_ms))
  return { totalMs, count: filtered.length, avgMs, longestMs, shortestMs }
}

export function computeDailyTotals(sessions: Session[], days: number = 7, activityEntries: ActivityEntry[] = []): { date: string; ms: number }[] {
  const today = new Date()
  const totals: { date: string; ms: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = toLocalDateStr(d.getTime())
    const dayStart = localMidnight(dateStr)
    const dayEnd = dayStart + 86400000
    
    let ms = 0
    if (activityEntries.length > 0) {
      ms = activityEntries
        .filter(e => e.timestamp >= dayStart && e.timestamp < dayEnd)
        .reduce((sum, e) => sum + e.duration_ms, 0)
    } else {
      ms = sessions
        .filter(s => s.created_at >= dayStart && s.created_at < dayEnd)
        .reduce((sum, s) => sum + s.duration_ms, 0)
    }
    totals.push({ date: dateStr, ms })
  }
  return totals
}

export function computeTopDays(sessions: Session[], n: number = 5, activityEntries: ActivityEntry[] = []): { date: string; ms: number }[] {
  const dayMap = new Map<string, number>()
  
  if (activityEntries.length > 0) {
    for (const e of activityEntries) {
      const dateStr = toLocalDateStr(e.timestamp)
      dayMap.set(dateStr, (dayMap.get(dateStr) || 0) + e.duration_ms)
    }
  } else {
    for (const s of sessions) {
      const dateStr = toLocalDateStr(s.created_at)
      dayMap.set(dateStr, (dayMap.get(dateStr) || 0) + s.duration_ms)
    }
  }
  return Array.from(dayMap.entries())
    .map(([date, ms]) => ({ date, ms }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, n)
}

export function computeAllDays(
  sessions: Session[],
  startDate: string,
  endDate: string,
  activityEntries: ActivityEntry[] = []
): DayDetail[] {
  const start = localMidnight(startDate)
  const end = localMidnight(endDate) + 86400000
  const dayMap = new Map<string, { ms: number; items: { name: string; ms: number; notePath?: string }[] }>()

  if (activityEntries.length > 0) {
    for (const e of activityEntries) {
      if (e.timestamp < start || e.timestamp >= end) continue
      const dateStr = toLocalDateStr(e.timestamp)
      const existing = dayMap.get(dateStr) || { ms: 0, items: [] }
      existing.ms += e.duration_ms
      existing.items.push({ name: e.noteName, ms: e.duration_ms, notePath: e.notePath })
      dayMap.set(dateStr, existing)
    }
  } else {
    for (const s of sessions) {
      if (s.created_at < start || s.created_at >= end) continue
      const dateStr = toLocalDateStr(s.created_at)
      const existing = dayMap.get(dateStr) || { ms: 0, items: [] }
      existing.ms += s.duration_ms
      existing.items.push({ name: s.name, ms: s.duration_ms, notePath: s.notePath })
      dayMap.set(dateStr, existing)
    }
  }

  const results: DayDetail[] = []
  const cursor = new Date(start)
  while (cursor.getTime() < end) {
    const dateStr = toLocalDateStr(cursor.getTime())
    const data = dayMap.get(dateStr)
    results.push({
      date: dateStr,
      ms: data?.ms ?? 0,
      count: data?.items.length ?? 0,
      sessions: data?.items ?? []
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return results
}

export function computeNoteBreakdown(activityEntries: ActivityEntry[]): NoteBreakdown[] {
  const noteMap = new Map<string, { totalMs: number; count: number; noteName: string }>()
  
  for (const e of activityEntries) {
    const existing = noteMap.get(e.notePath) || { totalMs: 0, count: 0, noteName: e.noteName }
    existing.totalMs += e.duration_ms
    existing.count++
    noteMap.set(e.notePath, existing)
  }
  
  return Array.from(noteMap.entries())
    .map(([notePath, data]) => ({
      notePath,
      noteName: data.noteName,
      totalMs: data.totalMs,
      count: data.count
    }))
    .sort((a, b) => b.totalMs - a.totalMs)
}

export function computeWeeklyTrend(activityEntries: ActivityEntry[], dailyGoalMs: number): WeeklyTrend {
  const now = Date.now()
  const weekMs = 604800000
  const thisWeekStart = now - weekMs
  const lastWeekStart = thisWeekStart - weekMs

  const thisWeekEntries = activityEntries.filter(e => e.timestamp >= thisWeekStart)
  const lastWeekEntries = activityEntries.filter(e => e.timestamp >= lastWeekStart && e.timestamp < thisWeekStart)

  const thisWeekTotal = thisWeekEntries.reduce((sum, e) => sum + e.duration_ms, 0)
  const lastWeekTotal = lastWeekEntries.reduce((sum, e) => sum + e.duration_ms, 0)

  const thisWeekDays = new Set(thisWeekEntries.map(e => toLocalDateStr(e.timestamp)))
  const lastWeekDays = new Set(lastWeekEntries.map(e => toLocalDateStr(e.timestamp)))

  const getDaysAboveGoal = (entries: ActivityEntry[]) => {
    if (dailyGoalMs <= 0) return 0
    const dayTotals = new Map<string, number>()
    for (const e of entries) {
      const d = toLocalDateStr(e.timestamp)
      dayTotals.set(d, (dayTotals.get(d) || 0) + e.duration_ms)
    }
    return Array.from(dayTotals.values()).filter(ms => ms >= dailyGoalMs).length
  }

  const thisWeekAvg = thisWeekDays.size > 0 ? Math.floor(thisWeekTotal / thisWeekDays.size) : 0
  const lastWeekAvg = lastWeekDays.size > 0 ? Math.floor(lastWeekTotal / lastWeekDays.size) : 0

  const delta = lastWeekTotal > 0
    ? Math.round(((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 100)
    : thisWeekTotal > 0 ? 100 : 0

  return {
    thisWeek: {
      totalMs: thisWeekTotal,
      avgMs: thisWeekAvg,
      daysAboveGoal: getDaysAboveGoal(thisWeekEntries)
    },
    lastWeek: {
      totalMs: lastWeekTotal,
      avgMs: lastWeekAvg,
      daysAboveGoal: getDaysAboveGoal(lastWeekEntries)
    },
    delta
  }
}

export function computeStreak(activityEntries: ActivityEntry[]): number {
  const daySet = new Set(activityEntries.map(e => toLocalDateStr(e.timestamp)))
  if (daySet.size === 0) return 0

  const sortedDays = Array.from(daySet).sort().reverse()
  let streak = 1
  const today = new Date()
  
  // If the most recent day is not today or yesterday, streak is 0
  const latestLocal = localMidnight(sortedDays[0])
  const todayLocal = localMidnight(toLocalDateStr(today.getTime()))
  const diffFromToday = Math.floor((todayLocal - latestLocal) / 86400000)
  if (diffFromToday > 1) return 0

  for (let i = 0; i < sortedDays.length - 1; i++) {
    const current = localMidnight(sortedDays[i])
    const next = localMidnight(sortedDays[i + 1])
    const diff = Math.floor((current - next) / 86400000)
    if (diff === 1) {
      streak++
    } else {
      break
    }
  }
  return streak
}

export function computeConsistency(activityEntries: ActivityEntry[], days: number = 7, dailyGoalMs: number): number {
  if (dailyGoalMs <= 0) return 0
  const dayTotals = new Map<string, number>()
  const today = new Date()
  
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = toLocalDateStr(d.getTime())
    dayTotals.set(dateStr, 0)
  }
  
  for (const e of activityEntries) {
    const dateStr = toLocalDateStr(e.timestamp)
    if (dayTotals.has(dateStr)) {
      dayTotals.set(dateStr, (dayTotals.get(dateStr) || 0) + e.duration_ms)
    }
  }
  
  const daysMet = Array.from(dayTotals.values()).filter(ms => isDailyGoalMet(ms, dailyGoalMs)).length
  return Math.round((daysMet / days) * 100)
}

export function computeCalendarMonth(year: number, month: number, activityEntries: ActivityEntry[], dailyGoalMs: number): CalendarDay[] {
  const days: CalendarDay[] = []
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  
// Pad with previous month's days to align to week start (Monday)
   const startPad = (firstDay.getDay() + 6) % 7 // Monday=0
   for (let i = startPad; i > 0; i--) {
     const d = new Date(year, month, 1 - i)
     const dateStr = toLocalDateStr(d.getTime())
     days.push({ date: dateStr, ms: 0, goalPercent: 0, isInMonth: false })
   }
  
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date = new Date(year, month, d)
    const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    const dayStart = date.getTime()
    const dayEnd = dayStart + 86400000
    const ms = activityEntries
      .filter(e => e.timestamp >= dayStart && e.timestamp < dayEnd)
      .reduce((sum, e) => sum + e.duration_ms, 0)
    const goalPercent = dailyGoalMs > 0 ? Math.min((ms / dailyGoalMs) * 100, 100) : 0
    days.push({ date: dateStr, ms, goalPercent, isInMonth: true })
  }
  
// Pad to fill last week
   const endPad = 6 - ((lastDay.getDay() + 6) % 7)
   for (let i = 1; i <= endPad; i++) {
     const d = new Date(year, month + 1, i)
     const dateStr = toLocalDateStr(d.getTime())
     days.push({ date: dateStr, ms: 0, goalPercent: 0, isInMonth: false })
   }
  
  return days
}

export function computeHourlyDistribution(activityEntries: ActivityEntry[]): { hour: number; ms: number; count: number }[] {
  const hourMap = new Map<number, { ms: number; count: number }>()
  for (let i = 0; i < 24; i++) hourMap.set(i, { ms: 0, count: 0 })
  
  for (const e of activityEntries) {
    const hour = new Date(e.timestamp).getHours()
    const existing = hourMap.get(hour)!
    existing.ms += e.duration_ms
    existing.count++
    hourMap.set(hour, existing)
  }
  
  return Array.from(hourMap.entries())
    .map(([hour, data]) => ({ hour, ms: data.ms, count: data.count }))
}

export function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function formatMsDetailed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function computeDayHourlyDistribution(dayEntries: ActivityEntry[]): { hour: number; ms: number }[] {
  const hourMap = new Map<number, number>()
  for (let i = 0; i < 24; i++) hourMap.set(i, 0)

  for (const e of dayEntries) {
    if (e.end_timestamp) {
      let cursor = e.timestamp
      const end = e.end_timestamp
      while (cursor < end) {
        const h = new Date(cursor).getHours()
        const nextHour = new Date(cursor)
        nextHour.setHours(h + 1, 0, 0, 0)
        const sliceEnd = nextHour.getTime() < end ? nextHour.getTime() : end
        const sliceMs = sliceEnd - cursor
        hourMap.set(h, (hourMap.get(h) || 0) + sliceMs)
        cursor = sliceEnd
      }
    } else {
      const h = new Date(e.timestamp).getHours()
      hourMap.set(h, (hourMap.get(h) || 0) + e.duration_ms)
    }
  }

  return Array.from(hourMap.entries()).map(([hour, ms]) => ({ hour, ms }))
}

export function computeDayHourHeatmap(entries: ActivityEntry[], days: number): { day: string; hours: { hour: number; ms: number }[] }[] {
  const today = new Date()
  const result: { day: string; hours: { hour: number; ms: number }[] }[] = []

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = toLocalDateStr(d.getTime())
    const dayStart = localMidnight(dateStr)
    const dayEnd = dayStart + 86400000

    const dayEntries = entries.filter(e =>
      (e.timestamp < dayEnd && (e.end_timestamp || e.timestamp) >= dayStart)
    )

    const hours = computeDayHourlyDistribution(dayEntries)
    result.push({ day: dateStr, hours })
  }

  return result
}

export function computeAvgSessionTrend(entries: ActivityEntry[], days: number): { date: string; avgMs: number; count: number }[] {
  const today = new Date()
  const result: { date: string; avgMs: number; count: number }[] = []

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = toLocalDateStr(d.getTime())
    const dayStart = localMidnight(dateStr)
    const dayEnd = dayStart + 86400000

    const dayEntries = entries.filter(e =>
      e.timestamp >= dayStart && e.timestamp < dayEnd
    )

    if (dayEntries.length > 0) {
      const totalMs = dayEntries.reduce((s, e) => s + e.duration_ms, 0)
      result.push({ date: dateStr, avgMs: Math.floor(totalMs / dayEntries.length), count: dayEntries.length })
    } else {
      result.push({ date: dateStr, avgMs: 0, count: 0 })
    }
  }

  return result
}

export function computeNightWorkPercentage(entries: ActivityEntry[], days: number): number {
  const today = new Date()
  const cutoff = localMidnight(toLocalDateStr(today.getTime())) - (days - 1) * 86400000

  const relevant = entries.filter(e => (e.end_timestamp || e.timestamp) >= cutoff)
  if (relevant.length === 0) return 0

  let totalMs = 0
  let nightMs = 0

  for (const e of relevant) {
    const start = e.timestamp
    const end = e.end_timestamp || (start + e.duration_ms)
    totalMs += end - start

    let cursor = start
    while (cursor < end) {
      const h = new Date(cursor).getHours()
      const nextHour = new Date(cursor)
      nextHour.setHours(h + 1, 0, 0, 0)
      const sliceEnd = nextHour.getTime() < end ? nextHour.getTime() : end
      const sliceMs = sliceEnd - cursor

      if (h >= 22 || h < 6) nightMs += sliceMs

      cursor = sliceEnd
    }
  }

  return totalMs > 0 ? Math.round((nightMs / totalMs) * 100) : 0
}

export function computeDayOfWeekBreakdown(entries: ActivityEntry[]): DayOfWeekBreakdown[] {
  const dayMap = new Map<number, { totalMs: number; count: number }>()
  for (let i = 0; i < 7; i++) dayMap.set(i, { totalMs: 0, count: 0 })
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  for (const e of entries) {
    const day = new Date(e.timestamp).getDay()
    const data = dayMap.get(day)!
    data.totalMs += e.duration_ms
    data.count++
  }

  return Array.from(dayMap.entries()).map(([day, data]) => ({
    day,
    name: dayNames[day],
    totalMs: data.totalMs,
    avgMs: data.count > 0 ? Math.floor(data.totalMs / data.count) : 0,
    count: data.count
  }))
}

export function computeSessionLengthDistribution(sessions: Session[]): SessionLengthDistribution[] {
  const buckets = [
    { label: '<15min', min: 0, max: 900_000 },
    { label: '15-30min', min: 900_000, max: 1_800_000 },
    { label: '30-60min', min: 1_800_000, max: 3_600_000 },
    { label: '1-2h', min: 3_600_000, max: 7_200_000 },
    { label: '2h+', min: 7_200_000, max: Infinity },
  ]
  const total = sessions.length || 1
  return buckets.map(b => {
    const count = sessions.filter(s => s.duration_ms >= b.min && s.duration_ms < b.max).length
    return { label: b.label, count, pct: Math.round((count / total) * 100) }
  })
}

export function computeWeekdayVsWeekend(entries: ActivityEntry[]): WeekdayVsWeekend {
  const dayTotals = new Map<number, { totalMs: number; count: number }>()

  for (const e of entries) {
    const day = new Date(e.timestamp).getDay()
    const existing = dayTotals.get(day) || { totalMs: 0, count: 0 }
    existing.totalMs += e.duration_ms
    existing.count++
    dayTotals.set(day, existing)
  }

  let weekdayMs = 0, weekdayCount = 0
  let weekendMs = 0, weekendCount = 0

  for (const [day, data] of dayTotals) {
    if (day === 0 || day === 6) {
      weekendMs += data.totalMs
      weekendCount += data.count
    } else {
      weekdayMs += data.totalMs
      weekdayCount += data.count
    }
  }

  const weekdayAvgMs = weekdayCount > 0 ? Math.floor(weekdayMs / weekdayCount) : 0
  const weekendAvgMs = weekendCount > 0 ? Math.floor(weekendMs / weekendCount) : 0

  return {
    weekdayAvgMs,
    weekendAvgMs,
    ratio: weekendAvgMs > 0 ? Number((weekdayAvgMs / weekendAvgMs).toFixed(1)) : 0,
    weekdayCount,
    weekendCount
  }
}

export function computeProductivityTrend(entries: ActivityEntry[], days: number = 30): ProductivityTrend {
  const dailyTotals = computeDailyTotals([], days, entries)
  const n = dailyTotals.length
  if (n < 2) return { slope: 0, direction: 'flat', description: '→ stabilní' }

  const xValues = dailyTotals.map((_, i) => i)
  const yValues = dailyTotals.map(d => d.ms)

  const sumX = xValues.reduce((a, b) => a + b, 0)
  const sumY = yValues.reduce((a, b) => a + b, 0)
  const sumXY = xValues.reduce((sum, x, i) => sum + x * yValues[i], 0)
  const sumX2 = xValues.reduce((sum, x) => sum + x * x, 0)

  const denom = n * sumX2 - sumX * sumX
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0

  const direction = slope > 100 ? 'up' : slope < -100 ? 'down' : 'flat'
  const absSlope = Math.abs(slope)

  let description: string
  if (direction === 'up') {
    description = `↑ ~${formatMs(Math.round(absSlope))}/den`
  } else if (direction === 'down') {
    description = `↓ ~${formatMs(Math.round(absSlope))}/den`
  } else {
    description = '→ stabilní'
  }

  return { slope: Math.round(slope), direction, description }
}

export function computeFieldNightWork(sessions: Session[], fieldKey: string): FieldNightWork[] {
  const fieldMap = new Map<string, { totalMs: number; nightMs: number }>()

  for (const s of sessions) {
    if (!s.duration_ms) continue
    const val = s.frontmatterFields?.[fieldKey]
    if (!val) continue
    const values = Array.isArray(val) ? val : [val]

    for (const v of values) {
      if (!v) continue
      const existing = fieldMap.get(v) || { totalMs: 0, nightMs: 0 }
      existing.totalMs += s.duration_ms
      if (s.created_at) {
        const h = new Date(s.created_at).getHours()
        if (h >= 22 || h < 6) existing.nightMs += s.duration_ms
      }
      fieldMap.set(v, existing)
    }
  }

  return Array.from(fieldMap.entries())
    .map(([value, data]) => ({
      value,
      nightPct: data.totalMs > 0 ? Math.round((data.nightMs / data.totalMs) * 100) : 0,
      totalMs: data.totalMs,
      nightMs: data.nightMs
    }))
    .sort((a, b) => b.nightPct - a.nightPct)
    .slice(0, 8)
}

export function computeFieldAccuracy(sessions: Session[], fieldKey: string, days: number = 90): FieldAccuracy[] {
  const cutoff = Date.now() - days * 86400000
  const relevant = sessions.filter(s => s.timeEstimate != null && s.created_at >= cutoff)

  const fieldMap = new Map<string, { met: number; missed: number; overrunSum: number; overrunCount: number }>()

  for (const s of relevant) {
    const val = s.frontmatterFields?.[fieldKey]
    if (!val) continue
    const values = Array.isArray(val) ? val : [val]

    for (const v of values) {
      if (!v) continue
      const existing = fieldMap.get(v) || { met: 0, missed: 0, overrunSum: 0, overrunCount: 0 }
      const estimateMs = (s.timeEstimate || 0) * 60000
      const actualMs = s.duration_ms || 0

      if (actualMs <= estimateMs) {
        existing.met++
      } else {
        existing.missed++
        if (estimateMs > 0) {
          existing.overrunSum += ((actualMs - estimateMs) / estimateMs) * 100
          existing.overrunCount++
        }
      }
      fieldMap.set(v, existing)
    }
  }

  return Array.from(fieldMap.entries())
    .map(([value, data]) => ({
      value,
      accuracyPct: (data.met + data.missed) > 0 ? Math.round((data.met / (data.met + data.missed)) * 100) : 0,
      count: data.met + data.missed,
      avgOverrunPct: data.overrunCount > 0 ? Math.round(data.overrunSum / data.overrunCount) : 0
    }))
    .filter(f => f.count >= 2)
    .sort((a, b) => a.accuracyPct - b.accuracyPct)
}

export function computeAllCorrelations(
  entries: ActivityEntry[],
  sessions: Session[],
  statsFieldKeys: string[]
): CorrelationData {
  return {
    dayOfWeek: computeDayOfWeekBreakdown(entries),
    sessionDist: computeSessionLengthDistribution(sessions),
    weekdayVsWeekend: computeWeekdayVsWeekend(entries),
    productivityTrend: computeProductivityTrend(entries),
    fieldNightWork: statsFieldKeys.length > 0
      ? computeFieldNightWork(sessions, statsFieldKeys[0])
      : [],
    fieldAccuracy: statsFieldKeys.length > 0
      ? computeFieldAccuracy(sessions, statsFieldKeys[0])
      : [],
  }
}

export function exportStatsJson(entries: ActivityEntry[]): string {
  const summary = {
    exportedAt: new Date().toISOString(),
    totalEntries: entries.length,
    totalMs: entries.reduce((s, e) => s + e.duration_ms, 0),
    byDay: computeDailyTotals([], 365, entries),
    byNote: computeNoteBreakdown(entries),
    hourlyDistribution: computeHourlyDistribution(entries),
  }
  return JSON.stringify(summary, null, 2)
}

export interface TagBreakdown {
  tag: string
  totalMs: number
  count: number
  sessions: string[]
}

export function computeTagBreakdown(sessions: Session[]): TagBreakdown[] {
  const tagMap = new Map<string, { totalMs: number; count: number; sessions: string[] }>()

  for (const s of sessions) {
    if (!s.tags || s.tags.length === 0 || !s.duration_ms) continue
    for (const tag of s.tags) {
      const existing = tagMap.get(tag) || { totalMs: 0, count: 0, sessions: [] }
      existing.totalMs += s.duration_ms
      existing.count++
      existing.sessions.push(s.name)
      tagMap.set(tag, existing)
    }
  }

  return Array.from(tagMap.entries())
    .map(([tag, data]) => ({ tag, ...data }))
    .sort((a, b) => b.totalMs - a.totalMs)
}

export interface FieldBreakdown {
  value: string
  totalMs: number
  count: number
  sessions: string[]
}

export function computeFieldBreakdown(sessions: Session[], fieldKey: string): FieldBreakdown[] {
  const fieldMap = new Map<string, { totalMs: number; count: number; sessions: string[] }>()

  for (const s of sessions) {
    const val = s.frontmatterFields?.[fieldKey]
    if (!val) continue
    const values = Array.isArray(val) ? val : [val]
    for (const v of values) {
      if (!v) continue
      const existing = fieldMap.get(v) || { totalMs: 0, count: 0, sessions: [] }
      existing.totalMs += s.duration_ms
      existing.count++
      existing.sessions.push(s.name)
      fieldMap.set(v, existing)
    }
  }

  return Array.from(fieldMap.entries())
    .map(([value, data]) => ({ value, ...data }))
    .sort((a, b) => b.totalMs - a.totalMs)
}

export function computeEstimateAccuracy(
  sessions: Session[],
  days: number = 30,
  fieldFilter?: { fieldKey: string; fieldValue: string }
): EstimateAccuracy {
  const now = Date.now()
  const cutoff = now - days * 86400000
  let relevantSessions = sessions.filter(s => s.timeEstimate != null && s.created_at >= cutoff)

  if (fieldFilter) {
    relevantSessions = relevantSessions.filter(s => {
      const val = s.frontmatterFields?.[fieldFilter.fieldKey]
      if (Array.isArray(val)) return val.includes(fieldFilter.fieldValue)
      return val === fieldFilter.fieldValue
    })
  }

  if (relevantSessions.length === 0) {
    return {
      totalWithEstimate: 0,
      metCount: 0,
      missedCount: 0,
      avgOverrunPercent: 0,
      avgUnderrunPercent: 0,
      totalOverrunMs: 0,
      totalUnderrunMs: 0,
      accuracyPercent: 0,
      byDay: []
    }
  }

  let metCount = 0
  let missedCount = 0
  let totalOverrunMs = 0
  let totalUnderrunMs = 0
  let overrunPercentSum = 0
  let underrunPercentSum = 0
  let overrunCount = 0
  let underrunCount = 0

  const dayMap = new Map<string, { sessions: Session[] }>()

  for (const s of relevantSessions) {
    const dateStr = s.created_at ? new Date(s.created_at).toISOString().split('T')[0] : ''
    if (!dayMap.has(dateStr)) dayMap.set(dateStr, { sessions: [] })
    dayMap.get(dateStr)!.sessions.push(s)

    const estimateMs = (s.timeEstimate || 0) * 60000
    const actualMs = s.duration_ms || 0
    const diffMs = actualMs - estimateMs
    const diffPercent = estimateMs > 0 ? (diffMs / estimateMs) * 100 : 0

    if (diffMs <= 0) {
      metCount++
      totalUnderrunMs += Math.abs(diffMs)
      underrunPercentSum += Math.abs(diffPercent)
      underrunCount++
    } else {
      missedCount++
      totalOverrunMs += diffMs
      overrunPercentSum += diffPercent
      overrunCount++
    }
  }

  const avgOverrunPercent = overrunCount > 0 ? Math.round(overrunPercentSum / overrunCount) : 0
  const avgUnderrunPercent = underrunCount > 0 ? Math.round(underrunPercentSum / underrunCount) : 0
  const accuracyPercent = relevantSessions.length > 0 ? Math.round((metCount / relevantSessions.length) * 100) : 0

  const byDay = Array.from(dayMap.entries())
    .map(([date, data]) => {
      const dayMet = data.sessions.filter(s => {
        const estMs = (s.timeEstimate || 0) * 60000
        return (s.duration_ms || 0) <= estMs
      }).length
      const dayMissed = data.sessions.length - dayMet
      const dayOverrunSum = data.sessions
        .filter(s => (s.duration_ms || 0) > (s.timeEstimate || 0) * 60000)
        .reduce((sum, s) => {
          const estMs = (s.timeEstimate || 0) * 60000
          return sum + ((s.duration_ms || 0) - estMs) / estMs * 100
        }, 0)
      const dayOverrunCount = data.sessions.filter(s => (s.duration_ms || 0) > (s.timeEstimate || 0) * 60000).length
      return {
        date,
        totalWithEstimate: data.sessions.length,
        metCount: dayMet,
        missedCount: dayMissed,
        avgOverrunPercent: dayOverrunCount > 0 ? Math.round(dayOverrunSum / dayOverrunCount) : 0
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    totalWithEstimate: relevantSessions.length,
    metCount,
    missedCount,
    avgOverrunPercent,
    avgUnderrunPercent,
    totalOverrunMs,
    totalUnderrunMs,
    accuracyPercent,
    byDay
  }
}