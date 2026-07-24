import { useMemo } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import {
  computeDayOfWeekBreakdown, computeSessionLengthDistribution,
  computeWeekdayVsWeekend, computeProductivityTrend,
  computeFieldNightWork, computeFieldAccuracy, formatMs
} from '../../services/stats'
import type { ActivityEntry, Session } from '../../types/session'
import { BarChart3, TrendingUp, Sun, Moon, Target, Layers } from 'lucide-react'

interface StatsCorrelationsProps {
  entries: ActivityEntry[]
  sessions: Session[]
  statsFieldKeys: string[]
}

export default function StatsCorrelations({ entries, sessions, statsFieldKeys }: StatsCorrelationsProps) {
  const { t } = useTranslation()

  const dayOfWeek = useMemo(() => computeDayOfWeekBreakdown(entries), [entries])
  const sessionDist = useMemo(() => computeSessionLengthDistribution(sessions), [sessions])
  const wvW = useMemo(() => computeWeekdayVsWeekend(entries), [entries])
  const trend = useMemo(() => computeProductivityTrend(entries), [entries])
  const fieldNightWork = useMemo(
    () => statsFieldKeys.length > 0 ? computeFieldNightWork(sessions, statsFieldKeys[0]).slice(0, 4) : [],
    [sessions, statsFieldKeys]
  )
  const fieldAccuracy = useMemo(
    () => statsFieldKeys.length > 0 ? computeFieldAccuracy(sessions, statsFieldKeys[0]).slice(0, 4) : [],
    [sessions, statsFieldKeys]
  )

  const bestDay = dayOfWeek.reduce((best, d) => d.avgMs > best.avgMs ? d : best, dayOfWeek[0])

  return (
    <div className="space-y-6">
      <h4 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
        <BarChart3 size={14} />
        {t('correlationsAndInsights')}
      </h4>

      {/* Row 1: day of week + trend */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-zinc-800/60 rounded-xl">
          <div className="flex items-center gap-2 text-zinc-400 mb-2">
            <BarChart3 size={12} />
            <span className="text-[10px]">{t('dayOfWeekBreakdown')}</span>
          </div>
          <div className="flex items-end gap-1 h-12">
            {dayOfWeek.map(d => {
              const maxAvg = Math.max(...dayOfWeek.map(x => x.avgMs), 1)
              const h = maxAvg > 0 ? (d.avgMs / maxAvg) * 100 : 0
              return (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full relative flex-1" style={{ minHeight: '4px' }}>
                    <div
                      className={`absolute bottom-0 w-full rounded-sm ${d.day === bestDay.day ? 'bg-emerald-500/70' : 'bg-indigo-500/40'}`}
                      style={{ height: `${Math.max(h, 4)}%` }}
                      title={`${d.name}: ${formatMs(d.avgMs)}`}
                    />
                  </div>
                  <span className="text-[7px] text-zinc-500">{d.name.slice(0, 2)}</span>
                </div>
              )
            })}
          </div>
          <div className="text-[10px] text-zinc-500 mt-1">
            {t('bestDay')}: <span className="text-emerald-400">{bestDay.name}</span> ({formatMs(bestDay.avgMs)}/{t('avgPerDay').toLowerCase()})
          </div>
        </div>

        <div className="p-3 bg-zinc-800/60 rounded-xl">
          <div className="flex items-center gap-2 text-zinc-400 mb-2">
            <TrendingUp size={12} />
            <span className="text-[10px]">{t('productivityTrend')}</span>
          </div>
          <div className={`text-lg font-bold ${trend.direction === 'up' ? 'text-emerald-400' : trend.direction === 'down' ? 'text-red-400' : 'text-zinc-400'}`}>
            {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'}
          </div>
          <div className="text-[10px] text-zinc-500">{trend.description}</div>
        </div>
      </div>

      {/* Row 2: session dist + weekday vs weekend */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-zinc-800/60 rounded-xl">
          <div className="flex items-center gap-2 text-zinc-400 mb-2">
            <Layers size={12} />
            <span className="text-[10px]">{t('sessionLengthDist')}</span>
          </div>
          <div className="space-y-1">
            {sessionDist.map(b => (
              <div key={b.label} className="flex items-center gap-2">
                <span className="text-[9px] text-zinc-400 w-12 shrink-0">{b.label}</span>
                <div className="flex-1 bg-zinc-700 rounded-full h-1.5">
                  <div className="h-1.5 rounded-full bg-indigo-500/60" style={{ width: `${b.pct}%` }} />
                </div>
                <span className="text-[9px] text-zinc-500 w-8 text-right">{b.pct}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="p-3 bg-zinc-800/60 rounded-xl">
          <div className="flex items-center gap-2 text-zinc-400 mb-2">
            <Sun size={12} />
            <span className="text-[10px]">{t('weekdayVsWeekend')}</span>
          </div>
          {wvW.weekdayCount > 0 || wvW.weekendCount > 0 ? (
            <>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-zinc-400">{t('weekdays')}</span>
                <span className="text-xs font-mono text-emerald-400">{formatMs(wvW.weekdayAvgMs)}</span>
              </div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-zinc-400">{t('weekend')}</span>
                <span className="text-xs font-mono text-emerald-400">{formatMs(wvW.weekendAvgMs)}</span>
              </div>
              {wvW.weekendAvgMs > 0 && (
                <div className="text-[10px] text-zinc-500">
                  {wvW.ratio > 1
                    ? `${t('weekdaysMore')} ${wvW.ratio}x`
                    : `${t('weekendMore')} ${(1 / wvW.ratio).toFixed(1)}x`}
                </div>
              )}
            </>
          ) : (
            <div className="text-[10px] text-zinc-600 py-2">{t('noData')}</div>
          )}
        </div>
      </div>

      {/* Row 3: Field correlations */}
      {statsFieldKeys.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {fieldNightWork.length > 0 && (
            <div className="p-3 bg-zinc-800/60 rounded-xl">
              <div className="flex items-center gap-2 text-zinc-400 mb-2">
                <Moon size={12} />
                <span className="text-[10px]">{t('fieldNightWork')} ({statsFieldKeys[0]})</span>
              </div>
              <div className="space-y-1">
                {fieldNightWork.map(f => (
                  <div key={f.value} className="flex items-center gap-2">
                    <span className="text-[9px] text-zinc-400 truncate flex-1">{f.value}</span>
                    <div className="w-12 bg-zinc-700 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-indigo-500/60" style={{ width: `${f.nightPct}%` }} />
                    </div>
                    <span className="text-[9px] text-zinc-500 w-8 text-right">{f.nightPct}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {fieldAccuracy.length > 0 && (
            <div className="p-3 bg-zinc-800/60 rounded-xl">
              <div className="flex items-center gap-2 text-zinc-400 mb-2">
                <Target size={12} />
                <span className="text-[10px]">{t('fieldAccuracy')} ({statsFieldKeys[0]})</span>
              </div>
              <div className="space-y-1">
                {fieldAccuracy.map(f => (
                  <div key={f.value} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] text-zinc-400 truncate">{f.value}</span>
                        <span className={`text-[9px] font-mono ${f.accuracyPct >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {f.accuracyPct}%
                        </span>
                      </div>
                      <div className="bg-zinc-700 rounded-full h-1 mt-0.5">
                        <div
                          className={`h-1 rounded-full ${f.accuracyPct >= 50 ? 'bg-emerald-500/60' : 'bg-red-500/60'}`}
                          style={{ width: `${f.accuracyPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
