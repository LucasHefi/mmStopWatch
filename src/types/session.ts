export interface Session {
  id: string
  name: string
  started_at: number
  ended_at: number
  duration_ms: number
  created_at: number
  tags?: string[]
  notePath?: string
  frontmatterKey?: string
  parseError?: string
  relativePath?: string
  preview?: string
  timeEstimate?: number
  frontmatterFields?: Record<string, string | string[]>
}

export interface VaultProfile {
  id: string
  name: string
  notesFolder: string | null
  nick: string | null
  frontmatterKey: string
  timeEstimateKey?: string
  timeFormat: string
  dailyGoalMs?: number
  obsidianVault?: string
}

export type LayoutMode = 'list' | 'grid-1' | 'grid-2' | 'grid-3' | 'grid-4'

export interface MDConfig {
  notesFolder: string | null
  frontmatterKey: string
  timeEstimateKey?: string
  timeFormat: string
  tags: string[]
  language?: string
  nick?: string
  onboardingComplete?: boolean
  pinnedNotes?: string[]
  notifications?: { enabled: boolean; intervalMinutes: 0 | 5 | 10 | 15 | 30 | 60 | 120 }
  obsidianVault?: string
  dailyGoalMs?: number
  roundTimes?: { enabled: boolean; durations: number[]; customMinutes?: number }
  timeEstimates?: Record<string, number>
  statsFieldKeys?: string[]
  updateServerUrl?: string
  autoRefreshInterval?: number
  timerLimitAlert?: {
    enabled: boolean
    soundEnabled: boolean
    soundPath: string | null
    notificationsEnabled: boolean
    customMessage: string
    showOverlay: boolean
  }
  timerViewMode?: 'cards' | 'table'
  timerLayout?: {
    mode: LayoutMode
    order: string[]
  }
  profiles?: VaultProfile[]
  activeProfileId?: string
}

export interface ActivityEntry {
  timestamp: number
  duration_ms: number
  notePath: string
  noteName: string
  saved_at?: number
  end_timestamp?: number
  operation_id?: string
}

export interface ActivityHistory {
  entries: ActivityEntry[]
}

export interface StatsSummary {
  totalMs: number
  count: number
  avgMs: number
  longestMs: number
  shortestMs: number
}

export interface FilterOptions {
  tags: string[]
  dateRange?: [number, number]
  search?: string
}

export interface DeletedSession {
  session: Session
  deletedAt: number
}

export interface RecentlyDeleted {
  session: Session
  deletedAt: number
  expiresAt: number
  timerState?: {
    elapsed: number
    pausedOffset: number
  }
}

export interface DayDetail {
  date: string
  ms: number
  count: number
  sessions: { name: string; ms: number; notePath?: string }[]
}

export interface NoteBreakdown {
  notePath: string
  noteName: string
  totalMs: number
  count: number
}

export interface WeeklyTrend {
  thisWeek: { totalMs: number; avgMs: number; daysAboveGoal: number }
  lastWeek: { totalMs: number; avgMs: number; daysAboveGoal: number }
  delta: number // percentage change
}

export interface CalendarDay {
  date: string
  ms: number
  goalPercent: number
  isInMonth: boolean
}

export interface DayOfWeekBreakdown {
  day: number
  name: string
  totalMs: number
  avgMs: number
  count: number
}

export interface SessionLengthDistribution {
  label: string
  count: number
  pct: number
}

export interface WeekdayVsWeekend {
  weekdayAvgMs: number
  weekendAvgMs: number
  ratio: number
  weekdayCount: number
  weekendCount: number
}

export interface ProductivityTrend {
  slope: number
  direction: 'up' | 'down' | 'flat'
  description: string
}

export interface FieldNightWork {
  value: string
  nightPct: number
  totalMs: number
  nightMs: number
}

export interface FieldAccuracy {
  value: string
  accuracyPct: number
  count: number
  avgOverrunPct: number
}

export interface CorrelationData {
  dayOfWeek: DayOfWeekBreakdown[]
  sessionDist: SessionLengthDistribution[]
  weekdayVsWeekend: WeekdayVsWeekend
  productivityTrend: ProductivityTrend
  fieldNightWork: FieldNightWork[]
  fieldAccuracy: FieldAccuracy[]
}

export interface EstimateAccuracy {
  totalWithEstimate: number
  metCount: number
  missedCount: number
  avgOverrunPercent: number
  avgUnderrunPercent: number
  totalOverrunMs: number
  totalUnderrunMs: number
  accuracyPercent: number
  byDay: { date: string; totalWithEstimate: number; metCount: number; missedCount: number; avgOverrunPercent: number }[]
}