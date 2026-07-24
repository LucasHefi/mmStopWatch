import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from '../../i18n/useTranslation'
import { computeAllDays, formatMs, computeDayHourlyDistribution } from '../../services/stats'
import type { ActivityEntry, Session } from '../../types/session'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface StatsAllDaysProps {
  sessions: Session[]
  entries: ActivityEntry[]
  dailyGoal: number
}

export default function StatsAllDays({ sessions, entries, dailyGoal }: StatsAllDaysProps) {
  const { t } = useTranslation()
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [expandedDay, setExpandedDay] = useState<string | null>(null)

  const allDays = useMemo(() => computeAllDays(sessions, dateFrom, dateTo, entries), [sessions, dateFrom, dateTo, entries])
  const expandedDayHourly = useMemo(() =>
    expandedDay ? computeDayHourlyDistribution(entries.filter(e => {
      const ds = new Date(e.timestamp)
      const es = e.end_timestamp ? new Date(e.end_timestamp) : ds
      const dayStart = new Date(expandedDay + 'T00:00:00').getTime()
      const dayEnd = dayStart + 86400000
      return ds.getTime() < dayEnd && es.getTime() >= dayStart
    })) : [],
    [entries, expandedDay]
  )

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-xs text-zinc-400">{t('filterByDate')}:</span>
        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          className="bg-zinc-800 text-xs text-zinc-300 px-2 py-1 rounded border border-zinc-700 focus:outline-none focus:border-indigo-500"
        />
        <span className="text-xs text-zinc-500">{t('to')}</span>
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          className="bg-zinc-800 text-xs text-zinc-300 px-2 py-1 rounded border border-zinc-700 focus:outline-none focus:border-indigo-500"
        />
        <span className="text-xs text-zinc-500 ml-auto">{allDays.filter(d => d.ms > 0).length} {t('daysTracked')}</span>
      </div>

      <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
        {allDays.length === 0 && <div className="text-sm text-zinc-500 text-center py-8">{t('noData')}</div>}
        {allDays.filter(d => d.ms > 0).map((d, i) => {
          const pct = dailyGoal > 0 ? Math.round((d.ms / dailyGoal) * 100) : 0
          const isExpanded = expandedDay === d.date
          return (
            <div key={i}>
              <button
                onClick={() => setExpandedDay(isExpanded ? null : d.date)}
                className="w-full flex items-center gap-2 p-2 bg-zinc-800/60 rounded-lg hover:bg-zinc-800 transition-colors text-left"
              >
                {isExpanded ? <ChevronDown size={12} className="text-zinc-500 shrink-0" /> : <ChevronRight size={12} className="text-zinc-500 shrink-0" />}
                <span className="text-xs text-zinc-400 w-16 shrink-0">{d.date}</span>
                <div className="flex-1 bg-zinc-700 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <span className="text-xs font-mono w-16 text-right text-zinc-300">{formatMs(d.ms)}</span>
                <span className="text-[10px] text-zinc-500 w-8 text-right">{pct}%</span>
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="ml-6 mt-1 mb-2 p-3 bg-zinc-800/40 rounded-lg space-y-2">
                      <div className="space-y-1">
                        {d.sessions.length === 0 && <div className="text-xs text-zinc-500">{t('noData')}</div>}
                        {d.sessions.map((s, si) => (
                          <div key={si} className="flex items-center gap-2 text-xs">
                            <span className="text-zinc-400 truncate flex-1">{s.name}</span>
                            <span className="font-mono text-emerald-400">{formatMs(s.ms)}</span>
                          </div>
                        ))}
                      </div>
                      {expandedDayHourly.length > 0 && (
                        <div className="pt-2 border-t border-zinc-700">
                          <div className="text-[10px] text-zinc-500 mb-2">{t('breakdown24h')}</div>
                          <div className="flex items-end gap-0.5 h-16">
                            {expandedDayHourly.map((h, hi) => {
                              const maxMs = Math.max(...expandedDayHourly.map(x => x.ms), 1)
                              const height = maxMs > 0 ? (h.ms / maxMs) * 100 : 0
                              return (
                                <div key={hi} className="flex-1 flex flex-col items-center gap-0.5">
                                  <div className="w-full relative flex-1" style={{ minHeight: '12px' }}>
                                    <div
                                      className="absolute bottom-0 w-full rounded-sm bg-indigo-500/40"
                                      style={{ height: `${Math.max(height, 1)}%` }}
                                      title={`${h.hour}:00 - ${formatMs(h.ms)}`}
                                    />
                                  </div>
                                  <span className="text-[6px] text-zinc-600">{h.hour}</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </div>
  )
}
