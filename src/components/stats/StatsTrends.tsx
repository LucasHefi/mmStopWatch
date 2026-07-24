import { useMemo } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import { formatMs, computeDayHourHeatmap, computeAvgSessionTrend, computeNightWorkPercentage, exportStatsJson } from '../../services/stats'
import type { ActivityEntry, Session } from '../../types/session'
import { Grid3X3, LineChart, Moon, Download } from 'lucide-react'
import StatsCorrelations from './StatsCorrelations'

interface StatsTrendsProps {
  entries: ActivityEntry[]
  sessions: Session[]
  statsFieldKeys: string[]
  onExportReport?: (type: 'weekly' | 'monthly') => void
}

export default function StatsTrends({ entries, sessions, statsFieldKeys, onExportReport }: StatsTrendsProps) {
  const { t } = useTranslation()
  const heatmapData = useMemo(() => computeDayHourHeatmap(entries, 7), [entries])
  const avgTrend = useMemo(() => computeAvgSessionTrend(entries, 30), [entries])
  const nightWorkPct = useMemo(() => computeNightWorkPercentage(entries, 30), [entries])

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-medium mb-3 text-zinc-300 flex items-center gap-2">
          <Grid3X3 size={14} />
          {t('heatmapDayHour')}
        </h4>
        <div className="overflow-x-auto">
          <div className="flex gap-px" style={{ minWidth: '400px' }}>
            {/* Hour labels column */}
            <div className="flex flex-col gap-px mr-1">
              <div className="h-[12px] mb-px" />
              {Array.from({ length: 24 }, (_, hi) => (
                <div key={hi} className="h-2.5 flex items-end justify-end pr-1">
                  <span className="text-[7px] text-zinc-600 leading-none">{hi}</span>
                </div>
              ))}
            </div>
            {/* Day columns */}
            {heatmapData.map((day, di) => {
              const maxMs = Math.max(...day.hours.map(h => h.ms), 1)
              return (
                <div key={di} className="flex-1 flex flex-col gap-px">
                  <div className="text-[8px] text-zinc-500 text-center mb-px leading-none h-3 flex items-end justify-center">
                    {day.day.slice(5)}
                  </div>
                  {day.hours.map((h, hi) => {
                    const intensity = maxMs > 0 ? (h.ms / maxMs) : 0
                    const alpha = h.ms === 0 ? 0 : Math.max(intensity, 0.08)
                    return (
                      <div
                        key={hi}
                        className="w-full rounded-sm"
                        style={{ height: '10px', backgroundColor: `rgba(16,185,129,${alpha})` }}
                        title={`${day.day} ${h.hour}:00 - ${formatMs(h.ms)}`}
                      />
                    )
                  })}
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-2 mt-2 text-[9px] text-zinc-500">
            <span>0</span>
            <div className="flex gap-px">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(16,185,129,0)' }} />
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(16,185,129,0.15)' }} />
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(16,185,129,0.3)' }} />
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(16,185,129,0.5)' }} />
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(16,185,129,0.75)' }} />
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(16,185,129,1)' }} />
            </div>
            <span>max</span>
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-medium mb-3 text-zinc-300 flex items-center gap-2">
          <LineChart size={14} />
          {t('avgSessionLength30d')}
        </h4>
        <div className="flex items-end gap-0.5 h-20 overflow-x-auto">
          {avgTrend.map((d, i) => {
            const maxAvg = Math.max(...avgTrend.map(x => x.avgMs), 1)
            const height = maxAvg > 0 ? (d.avgMs / maxAvg) * 100 : 0
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-0.5 min-w-[8px]">
                <div className="w-full relative flex-1" style={{ minHeight: '10px' }}>
                  <div
                    className={`absolute bottom-0 w-full rounded-sm ${d.avgMs > 0 ? 'bg-indigo-500/60' : 'bg-zinc-800'}`}
                    style={{ height: `${Math.max(height, 1)}%` }}
                    title={`${d.date}: ${formatMs(d.avgMs)} (${d.count} entries)`}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-zinc-800 rounded-xl">
          <div className="flex items-center gap-2 text-zinc-400 mb-1">
            <Moon size={14} />
            <span className="text-xs">{t('nightWork')}</span>
          </div>
          <div className="text-lg font-bold">{nightWorkPct}%</div>
          <div className="text-[10px] text-zinc-500">{t('last30Days')}</div>
        </div>
        <div className="p-3 bg-zinc-800 rounded-xl flex flex-col items-center justify-center gap-2">
          <button
            onClick={() => {
              const json = exportStatsJson(entries)
              const blob = new Blob([json], { type: 'application/json' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `mmST-stats-${new Date().toISOString().slice(0, 10)}.json`
              a.click()
              URL.revokeObjectURL(url)
            }}
            className="flex items-center gap-2 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 px-3 py-2 rounded-lg transition-colors"
          >
            <Download size={14} />
            {t('exportJson')}
          </button>
          {onExportReport && (
            <>
              <button
                onClick={() => onExportReport('weekly')}
                className="flex items-center gap-2 text-xs bg-indigo-700 hover:bg-indigo-600 text-zinc-200 px-3 py-2 rounded-lg transition-colors"
              >
                <Download size={14} />
                {t('exportWeeklyReport')}
              </button>
              <button
                onClick={() => onExportReport('monthly')}
                className="flex items-center gap-2 text-xs bg-indigo-700 hover:bg-indigo-600 text-zinc-200 px-3 py-2 rounded-lg transition-colors"
              >
                <Download size={14} />
                {t('exportMonthlyReport')}
              </button>
            </>
          )}
        </div>
      </div>

      <hr className="border-zinc-800" />
      <StatsCorrelations entries={entries} sessions={sessions} statsFieldKeys={statsFieldKeys} />
    </div>
  )
}
