import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from '../../i18n/useTranslation'
import { formatMs, computeDailyTotals, computeTopDays, computeStreak, computeConsistency, computeWeeklyTrend } from '../../services/stats'
import { BarChart3, Clock, TrendingUp, Award, ArrowUp, ArrowDown } from 'lucide-react'
import type { ActivityEntry, Session } from '../../types/session'

type Period = 'day' | 'week' | 'month'

interface StatsOverviewProps {
  sessions: Session[]
  entries: ActivityEntry[]
  dailyGoal: number
  period: Period
  onPeriodChange: (p: Period) => void
  stats: { totalMs: number; count: number; avgMs: number; longestMs: number }
}

export default function StatsOverview({ sessions, entries, dailyGoal, period, onPeriodChange, stats }: StatsOverviewProps) {
  const { t } = useTranslation()
  const [hoveredBar, setHoveredBar] = useState<{ date: string; ms: number } | null>(null)

  const dailyTotals = computeDailyTotals(sessions, 7, entries)
  const topDays = computeTopDays(sessions, 5, entries)

  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const todayTotal = dailyTotals.find(d => d.date === todayStr)?.ms || 0
  const goalProgress = dailyGoal > 0 ? Math.min((todayTotal / dailyGoal) * 100, 100) : 0

  const streak = computeStreak(entries)
  const consistency = computeConsistency(entries, 7, dailyGoal)
  const weeklyTrend = computeWeeklyTrend(entries, dailyGoal)

  const trendIcon = weeklyTrend.delta > 0 ? <ArrowUp size={14} className="text-emerald-400" /> : weeklyTrend.delta < 0 ? <ArrowDown size={14} className="text-red-400" /> : null
  const periodLabels: Record<Period, string> = { day: t('today'), week: t('thisWeek'), month: t('thisMonth') }

  return (
    <>
      {/* Daily Goal Progress */}
      <div className="mb-4 p-4 bg-zinc-800 rounded-xl">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp size={16} className="text-emerald-400" />
          <span className="text-sm font-medium">{t('dailyGoal')}</span>
        </div>
        <div className="text-2xl font-bold mb-1">{formatMs(todayTotal)} <span className="text-sm text-zinc-400">/ {formatMs(dailyGoal)}</span></div>
        <div className="w-full bg-zinc-700 rounded-full h-2.5">
          <div className="bg-gradient-to-r from-emerald-500 to-teal-400 h-2.5 rounded-full transition-all" style={{ width: `${goalProgress}%` }} />
        </div>
        <div className="text-xs text-zinc-500 mt-1">{goalProgress.toFixed(0)}% {t('completed')}</div>
      </div>

      {/* Period selector */}
      <div className="flex gap-1 mb-4 bg-zinc-800 rounded-lg p-1">
        {(['day', 'week', 'month'] as Period[]).map(p => (
          <button key={p} onClick={() => onPeriodChange(p)} className={`flex-1 py-1.5 text-xs rounded ${period === p ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
            {periodLabels[p]}
          </button>
        ))}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="p-3 bg-zinc-800 rounded-xl">
          <div className="flex items-center gap-2 text-zinc-400 mb-1">
            <BarChart3 size={14} />
            <span className="text-xs">{t('total')}</span>
          </div>
          <div className="text-lg font-bold">{formatMs(stats.totalMs)}</div>
        </div>
        <div className="p-3 bg-zinc-800 rounded-xl">
          <div className="flex items-center gap-2 text-zinc-400 mb-1">
            <Clock size={14} />
            <span className="text-xs">{t('entries')}</span>
          </div>
          <div className="text-lg font-bold">{stats.count}</div>
        </div>
        <div className="p-3 bg-zinc-800 rounded-xl">
          <div className="flex items-center gap-2 text-zinc-400 mb-1">
            <TrendingUp size={14} />
            <span className="text-xs">{t('average')}</span>
          </div>
          <div className="text-lg font-bold">{formatMs(stats.avgMs)}</div>
        </div>
        <div className="p-3 bg-zinc-800 rounded-xl">
          <div className="flex items-center gap-2 text-zinc-400 mb-1">
            <Award size={14} />
            <span className="text-xs">{t('longest')}</span>
          </div>
          <div className="text-lg font-bold">{formatMs(stats.longestMs)}</div>
        </div>
      </div>

      {/* Extended stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="p-3 bg-zinc-800/60 rounded-xl">
          <div className="text-[10px] text-zinc-500 mb-1">{t('streak')}</div>
          <div className="text-sm font-bold">{streak} {t('streakDays')}</div>
        </div>
        <div className="p-3 bg-zinc-800/60 rounded-xl">
          <div className="text-[10px] text-zinc-500 mb-1">{t('consistency')}</div>
          <div className="text-sm font-bold">{consistency}%</div>
        </div>
        <div className="p-3 bg-zinc-800/60 rounded-xl col-span-2">
          <div className="flex items-center gap-1 text-[10px] text-zinc-500 mb-1">
            {trendIcon}
            {t('weeklyComparison')}
          </div>
          <div className="text-xs text-zinc-400">
            {t('thisWeek')}: <span className="text-emerald-400 font-mono">{formatMs(weeklyTrend.thisWeek.totalMs)}</span>
            {' | '}
            {t('lastWeek')}: <span className="font-mono">{formatMs(weeklyTrend.lastWeek.totalMs)}</span>
            <span className={`ml-1 text-xs ${weeklyTrend.delta > 0 ? 'text-emerald-400' : weeklyTrend.delta < 0 ? 'text-red-400' : 'text-zinc-500'}`}>
              ({weeklyTrend.delta > 0 ? '+' : ''}{weeklyTrend.delta}%)
            </span>
          </div>
        </div>
      </div>

      {/* 7-day chart */}
      <div className="mb-4">
        <h4 className="text-sm font-medium mb-3 text-zinc-300">{t('last7Days')}</h4>
        <div className="flex items-end gap-1 h-28">
          {dailyTotals.map((d, i) => {
            const maxMs = Math.max(...dailyTotals.map(dt => dt.ms), 1)
            const height = maxMs > 0 ? (d.ms / maxMs) * 100 : 0
            const isToday = d.date === todayStr
            const isHovered = hoveredBar?.date === d.date
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 relative">
                <AnimatePresence>
                  {isHovered && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="absolute -top-14 z-10 bg-zinc-700 text-xs px-2 py-1.5 rounded-lg shadow-lg whitespace-nowrap"
                    >
                      <div className="font-medium text-zinc-200">{d.date}</div>
                      <div className="text-emerald-400 font-mono">{formatMs(d.ms)}</div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="w-full relative" style={{ height: '80px' }}>
                  <div
                    className={`absolute bottom-0 w-full rounded-sm transition-all cursor-pointer ${
                      isToday ? 'bg-emerald-500' : 'bg-zinc-600 hover:bg-zinc-500'
                    }`}
                    style={{ height: `${Math.max(height, 2)}%` }}
                    onMouseEnter={() => setHoveredBar({ date: d.date, ms: d.ms })}
                    onMouseLeave={() => setHoveredBar(null)}
                  />
                </div>
                <span className="text-[9px] text-zinc-500">{d.date.slice(8)}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Top days */}
      {topDays.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-3 text-zinc-300">{t('topDays')}</h4>
          <div className="space-y-2">
            {topDays.map((d, i) => (
              <div key={i} className="flex items-center gap-3 p-2 bg-zinc-800 rounded-lg">
                <span className="text-xs text-zinc-500 w-4">#{i + 1}</span>
                <span className="text-xs text-zinc-400 w-10">{d.date}</span>
                <div className="flex-1 bg-zinc-700 rounded-full h-2">
                  <div className="bg-amber-500 h-2 rounded-full" style={{ width: `${Math.min((d.ms / (topDays[0].ms || 1)) * 100, 100)}%` }} />
                </div>
                <span className="text-xs font-mono w-16 text-right">{formatMs(d.ms)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
