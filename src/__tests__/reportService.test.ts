import { describe, it, expect } from 'vitest'
import { generateWeeklyReport, generateMonthlyReport } from '../services/reportService'
import type { ActivityEntry, Session } from '../types/session'

const mockEntries: ActivityEntry[] = [
  { timestamp: Date.now() - 3600000, duration_ms: 3600000, notePath: '/notes/a.md', noteName: 'Note A' },
  { timestamp: Date.now() - 86400000, duration_ms: 1800000, notePath: '/notes/b.md', noteName: 'Note B' },
]

const mockSessions: Session[] = [
  { id: '1', name: 'Session 1', started_at: 1000, ended_at: 2000, duration_ms: 3600000, created_at: Date.now() - 86400000, tags: ['dev'], timeEstimate: 60 },
]

describe('generateWeeklyReport', () => {
  it('generates valid markdown', () => {
    const md = generateWeeklyReport(mockEntries, mockSessions, 28800000, 'testuser')
    expect(md).toContain('# Weekly Report')
    expect(md).toContain('testuser')
    expect(md).toContain('## Overview')
    expect(md).toContain('## Daily Breakdown')
    expect(md).toContain('## Top Notes')
    expect(md).toContain('## Estimate Accuracy')
  })
})

describe('generateMonthlyReport', () => {
  it('generates valid markdown', () => {
    const md = generateMonthlyReport(mockEntries, mockSessions, 28800000, 'testuser')
    expect(md).toContain('# Monthly Report')
    expect(md).toContain('testuser')
    expect(md).toContain('## Overview')
    expect(md).toContain('## Daily Breakdown')
  })
})
