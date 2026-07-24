import { describe, it, expect } from 'vitest'
import {
  computeStats,
  computeDailyTotals,
  computeTopDays,
  computeAllDays,
  computeNoteBreakdown,
  computeHourlyDistribution,
  formatMs,
  formatMsDetailed,
  computeStreak,
  computeConsistency,
  computeWeeklyTrend,
  computeDayHourlyDistribution,
  computeDayHourHeatmap,
  computeAvgSessionTrend,
  computeNightWorkPercentage,
  computeCalendarMonth,
  computeTagBreakdown,
  computeFieldBreakdown,
  computeEstimateAccuracy,
  exportStatsJson,
  computeDayOfWeekBreakdown,
  computeSessionLengthDistribution,
  computeWeekdayVsWeekend,
  computeProductivityTrend,
  computeFieldNightWork,
  computeFieldAccuracy,
} from '../services/stats'
import type { Session, ActivityEntry } from '../types/session'

const mockSessions: Session[] = [
  { id: '1', name: 'Session 1', started_at: 1000, ended_at: 2000, duration_ms: 3600000, created_at: Date.now() - 86400000, tags: ['dev'], frontmatterFields: { project: 'Project A' } },
  { id: '2', name: 'Session 2', started_at: 3000, ended_at: 4000, duration_ms: 1800000, created_at: Date.now() - 172800000, tags: ['design'], frontmatterFields: { project: 'Project B' } },
  { id: '3', name: 'Session 3', started_at: 5000, ended_at: 6000, duration_ms: 7200000, created_at: Date.now() - 86400000 * 3, tags: ['dev', 'urgent'], frontmatterFields: { project: 'Project A' } },
]

const mockEntries: ActivityEntry[] = [
  { timestamp: Date.now() - 3600000, duration_ms: 3600000, notePath: '/notes/note1.md', noteName: 'Note 1' },
  { timestamp: Date.now() - 86400000, duration_ms: 1800000, notePath: '/notes/note2.md', noteName: 'Note 2' },
  { timestamp: Date.now() - 172800000, duration_ms: 7200000, notePath: '/notes/note1.md', noteName: 'Note 1' },
]

describe('formatMs', () => {
  it('formats hours', () => {
    expect(formatMs(3600000)).toBe('1h 0m')
  })
  it('formats minutes', () => {
    expect(formatMs(60000)).toBe('1m 0s')
  })
  it('formats seconds', () => {
    expect(formatMs(5000)).toBe('5s')
  })
  it('handles zero', () => {
    expect(formatMs(0)).toBe('0s')
  })
})

describe('computeStats', () => {
  it('returns zeros for empty data', () => {
    const result = computeStats([], 'day', [])
    expect(result.totalMs).toBe(0)
    expect(result.count).toBe(0)
  })

  it('computes stats from sessions', () => {
    const result = computeStats(mockSessions, 'month', [])
    expect(result.totalMs).toBe(12600000)
    expect(result.count).toBe(3)
    expect(result.longestMs).toBe(7200000)
  })

  it('computes stats from activity entries', () => {
    const result = computeStats([], 'month', mockEntries)
    expect(result.totalMs).toBeGreaterThan(0)
    expect(result.count).toBeGreaterThan(0)
  })
})

describe('computeDailyTotals', () => {
  it('returns correct number of days', () => {
    const result = computeDailyTotals(mockSessions, 7, [])
    expect(result).toHaveLength(7)
  })
})

describe('computeTopDays', () => {
  it('returns sorted top days', () => {
    const result = computeTopDays(mockSessions, 3, [])
    expect(result.length).toBeLessThanOrEqual(3)
    if (result.length > 1) {
      expect(result[0].ms).toBeGreaterThanOrEqual(result[1].ms)
    }
  })
})

describe('computeNoteBreakdown', () => {
  it('aggregates by note', () => {
    const result = computeNoteBreakdown(mockEntries)
    expect(result.length).toBe(2)
    const note1 = result.find(n => n.noteName === 'Note 1')
    expect(note1).toBeDefined()
    expect(note1!.count).toBe(2)
  })
})

describe('computeHourlyDistribution', () => {
  it('returns 24 hours', () => {
    const result = computeHourlyDistribution(mockEntries)
    expect(result).toHaveLength(24)
  })
})

describe('computeStreak', () => {
  it('returns 0 for empty entries', () => {
    expect(computeStreak([])).toBe(0)
  })
})

describe('computeConsistency', () => {
  it('returns 0 for empty entries', () => {
    expect(computeConsistency([], 7, 28800000)).toBe(0)
  })

  it('treats a zero daily goal as not configured', () => {
    expect(computeConsistency([], 7, 0)).toBe(0)
    expect(computeConsistency(mockEntries, 7, 0)).toBe(0)
  })
})

describe('computeWeeklyTrend', () => {
  it('handles empty entries', () => {
    const result = computeWeeklyTrend([], 28800000)
    expect(result.delta).toBe(0)
    expect(result.thisWeek.totalMs).toBe(0)
  })
})

describe('computeDayHourlyDistribution', () => {
  it('returns 24 hours', () => {
    const result = computeDayHourlyDistribution(mockEntries)
    expect(result).toHaveLength(24)
  })
})

describe('computeNightWorkPercentage', () => {
  it('returns 0 for empty entries', () => {
    expect(computeNightWorkPercentage([], 30)).toBe(0)
  })
})

describe('computeTagBreakdown', () => {
  it('aggregates by tag', () => {
    const result = computeTagBreakdown(mockSessions)
    expect(result.length).toBeGreaterThan(0)
    const devTag = result.find(t => t.tag === 'dev')
    expect(devTag).toBeDefined()
  })
})

describe('computeFieldBreakdown', () => {
  it('aggregates by field key', () => {
    const result = computeFieldBreakdown(mockSessions, 'project')
    expect(result.length).toBe(2)
    expect(result[0].value).toBe('Project A')
  })
})

describe('computeEstimateAccuracy', () => {
  it('returns zeros for no estimates', () => {
    const result = computeEstimateAccuracy([], 30)
    expect(result.totalWithEstimate).toBe(0)
  })

  it('calculates accuracy for sessions with estimates', () => {
    const sessionsWithEstimates: Session[] = [
      { ...mockSessions[0], timeEstimate: 60, duration_ms: 3600000 },
      { ...mockSessions[1], timeEstimate: 60, duration_ms: 7200000 },
    ]
    const result = computeEstimateAccuracy(sessionsWithEstimates, 30)
    expect(result.totalWithEstimate).toBe(2)
    expect(result.metCount + result.missedCount).toBe(2)
  })
})

describe('exportStatsJson', () => {
  it('produces valid JSON', () => {
    const json = exportStatsJson(mockEntries)
    const parsed = JSON.parse(json)
    expect(parsed.totalEntries).toBe(3)
    expect(parsed.byDay).toBeDefined()
    expect(parsed.byNote).toBeDefined()
  })
})

describe('formatMsDetailed', () => {
  it('formats hours with padding', () => {
    expect(formatMsDetailed(3661000)).toBe('1:01:01')
  })
  it('formats minutes and seconds with padding', () => {
    expect(formatMsDetailed(65000)).toBe('01:05')
  })
  it('handles zero', () => {
    expect(formatMsDetailed(0)).toBe('00:00')
  })
})

describe('computeAllDays', () => {
  it('returns days in range from sessions', () => {
    const start = new Date(Date.now() - 86400000 * 5).toISOString().slice(0, 10)
    const end = new Date().toISOString().slice(0, 10)
    const result = computeAllDays(mockSessions, start, end, [])
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0]).toHaveProperty('date')
    expect(result[0]).toHaveProperty('ms')
    expect(result[0]).toHaveProperty('sessions')
  })

  it('returns days in range from activity entries', () => {
    const start = new Date(Date.now() - 86400000 * 5).toISOString().slice(0, 10)
    const end = new Date().toISOString().slice(0, 10)
    const result = computeAllDays([], start, end, mockEntries)
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0]).toHaveProperty('sessions')
  })
})

describe('computeDayHourHeatmap', () => {
  it('returns correct number of days', () => {
    const result = computeDayHourHeatmap(mockEntries, 7)
    expect(result).toHaveLength(7)
    expect(result[0]).toHaveProperty('day')
    expect(result[0]).toHaveProperty('hours')
    expect(result[0].hours).toHaveLength(24)
  })
})

describe('computeAvgSessionTrend', () => {
  it('returns correct number of days', () => {
    const result = computeAvgSessionTrend(mockEntries, 7)
    expect(result).toHaveLength(7)
    expect(result[0]).toHaveProperty('avgMs')
    expect(result[0]).toHaveProperty('count')
  })
})

describe('computeCalendarMonth', () => {
  it('returns days for current month', () => {
    const now = new Date()
    const result = computeCalendarMonth(now.getFullYear(), now.getMonth(), mockEntries, 28800000)
    expect(result.length).toBeGreaterThanOrEqual(28)
    expect(result.some(d => d.isInMonth)).toBe(true)
    expect(result[0]).toHaveProperty('goalPercent')
  })

  it('returns days with goal percent', () => {
    const result = computeCalendarMonth(2024, 0, mockEntries, 28800000)
    expect(result.length).toBeGreaterThanOrEqual(28)
    expect(result[0]).toHaveProperty('ms')
  })
})

describe('computeDayOfWeekBreakdown', () => {
  it('returns 7 days', () => {
    const result = computeDayOfWeekBreakdown(mockEntries)
    expect(result).toHaveLength(7)
  })

  it('each entry has day and name', () => {
    const result = computeDayOfWeekBreakdown(mockEntries)
    result.forEach(d => {
      expect(typeof d.day).toBe('number')
      expect(typeof d.name).toBe('string')
      expect(d.day).toBeGreaterThanOrEqual(0)
      expect(d.day).toBeLessThanOrEqual(6)
    })
  })
})

describe('computeSessionLengthDistribution', () => {
  it('returns 5 buckets', () => {
    const result = computeSessionLengthDistribution(mockSessions)
    expect(result).toHaveLength(5)
  })

  it('percentages sum to ~100', () => {
    const result = computeSessionLengthDistribution(mockSessions)
    const total = result.reduce((s, b) => s + b.pct, 0)
    expect(total).toBeGreaterThanOrEqual(95)
    expect(total).toBeLessThanOrEqual(105)
  })

  it('each bucket has label, count, pct', () => {
    const result = computeSessionLengthDistribution(mockSessions)
    result.forEach(b => {
      expect(b).toHaveProperty('label')
      expect(b).toHaveProperty('count')
      expect(b).toHaveProperty('pct')
    })
  })
})

describe('computeWeekdayVsWeekend', () => {
  it('returns valid structure', () => {
    const result = computeWeekdayVsWeekend(mockEntries)
    expect(result).toHaveProperty('weekdayAvgMs')
    expect(result).toHaveProperty('weekendAvgMs')
    expect(result).toHaveProperty('ratio')
    expect(result).toHaveProperty('weekdayCount')
    expect(result).toHaveProperty('weekendCount')
  })

  it('handles empty entries', () => {
    const result = computeWeekdayVsWeekend([])
    expect(result.weekdayAvgMs).toBe(0)
    expect(result.weekendAvgMs).toBe(0)
  })
})

describe('computeProductivityTrend', () => {
  it('returns valid structure', () => {
    const result = computeProductivityTrend(mockEntries, 30)
    expect(result).toHaveProperty('slope')
    expect(result).toHaveProperty('direction')
    expect(result).toHaveProperty('description')
    expect(['up', 'down', 'flat']).toContain(result.direction)
  })

  it('handles empty entries', () => {
    const result = computeProductivityTrend([], 30)
    expect(result.direction).toBe('flat')
  })
})

describe('computeFieldNightWork', () => {
  it('returns data for field key', () => {
    const result = computeFieldNightWork(mockSessions, 'project')
    expect(Array.isArray(result)).toBe(true)
    result.forEach(f => {
      expect(f).toHaveProperty('value')
      expect(f).toHaveProperty('nightPct')
      expect(f).toHaveProperty('totalMs')
    })
  })

  it('returns empty for unknown field', () => {
    const result = computeFieldNightWork(mockSessions, 'nonexistent')
    expect(result).toHaveLength(0)
  })
})

describe('computeFieldAccuracy', () => {
  it('returns empty for sessions without estimates', () => {
    const result = computeFieldAccuracy(mockSessions, 'project')
    expect(result).toHaveLength(0)
  })

  it('returns data for sessions with estimates', () => {
    const sessionsWithEstimates: Session[] = [
      { ...mockSessions[0], timeEstimate: 60, duration_ms: 3600000 },
      { ...mockSessions[1], timeEstimate: 30, duration_ms: 3600000 },
    ]
    const result = computeFieldAccuracy(sessionsWithEstimates, 'project')
    result.forEach(f => {
      expect(f).toHaveProperty('value')
      expect(f).toHaveProperty('accuracyPct')
      expect(f).toHaveProperty('count')
      expect(f.count).toBeGreaterThanOrEqual(1)
    })
  })
})
