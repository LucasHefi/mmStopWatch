import { useState } from 'react'
import { computeCalendarMonth } from '../services/stats'
import type { ActivityEntry } from '../types/session'
import { formatMs, isDailyGoalMet } from '../services/stats'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from '../i18n/useTranslation'

interface CalendarViewProps {
  entries: ActivityEntry[]
  dailyGoalMs: number
}

export default function CalendarView({ entries, dailyGoalMs }: CalendarViewProps) {
  const { t } = useTranslation()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())

  const days = computeCalendarMonth(year, month, entries, dailyGoalMs)
  const locale = Intl.DateTimeFormat().resolvedOptions().locale
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    new Date(2000, i, 1).toLocaleString(locale, { month: 'long' })
  )
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2000, 0, 3 + i).toLocaleString(locale, { weekday: 'short' }).slice(0, 2)
  )

  const maxMs = Math.max(...days.filter(d => d.isInMonth).map(d => d.ms), 1)

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  return (
    <div className="select-none">
      {/* Month nav */}
      <div className="flex items-center justify-between mb-3">
        <button type="button" onClick={prevMonth} aria-label="Previous month" className="text-zinc-400 hover:text-white p-1"><ChevronLeft size={16} /></button>
        <span className="text-sm font-medium">{monthNames[month]} {year}</span>
        <button type="button" onClick={nextMonth} aria-label="Next month" className="text-zinc-400 hover:text-white p-1"><ChevronRight size={16} /></button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {weekdays.map(d => (
          <div key={d} className="text-[10px] text-zinc-500 text-center">{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, i) => {
          const intensity = maxMs > 0 ? (day.ms / maxMs) * 100 : 0
          const bgColor = day.ms > 0
            ? `rgba(16, 185, 129, ${0.15 + (intensity / 100) * 0.6})`
            : 'transparent'
          const borderColor = isDailyGoalMet(day.ms, dailyGoalMs) ? 'border-emerald-500/50' : 'border-transparent'
          
            return (
              <div
                key={i}
                className={`group relative text-xs text-center py-2 rounded-lg transition-colors cursor-default
                  ${day.isInMonth ? 'text-zinc-300' : 'text-zinc-700'}
                  ${day.ms > 0 ? 'hover:ring-1 hover:ring-emerald-400' : ''}
                  border ${borderColor}`}
                style={{ backgroundColor: bgColor }}
              >
                {new Date(day.date).getDate()}
                {day.ms > 0 && (
                  <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-emerald-400" />
                )}
                {day.ms > 0 && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10 pointer-events-none">
                    <div className="px-2 py-1 bg-zinc-800 rounded-md text-[10px] text-zinc-300 shadow-lg whitespace-nowrap border border-zinc-700">
                      {day.date}:
                      <span className="font-mono text-emerald-400 ml-1">{formatMs(day.ms)}</span>
                    </div>
                    <div className="w-2 h-2 bg-zinc-800 rotate-45 border-r border-b border-zinc-700 absolute left-1/2 -translate-x-1/2 -bottom-1" />
                  </div>
                )}
              </div>
            )
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-4 text-[10px] text-zinc-500 justify-center">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded bg-emerald-400/30" /> {t('activity')}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-400" /> {t('goalReached')}
        </span>
      </div>
    </div>
  )
}
