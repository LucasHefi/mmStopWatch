import { useMemo, useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import { formatMs, computeNoteBreakdown, computeHourlyDistribution, computeTagBreakdown, computeFieldBreakdown, computeEstimateAccuracy } from '../../services/stats'
import type { ActivityEntry, Session } from '../../types/session'
import { Layers, GanttChartSquare, Award } from 'lucide-react'

interface StatsBreakdownProps {
  sessions: Session[]
  entries: ActivityEntry[]
  statsFieldKeys: string[]
}

export default function StatsBreakdown({ sessions, entries, statsFieldKeys }: StatsBreakdownProps) {
  const { t } = useTranslation()
  const [accuracyFilterField, setAccuracyFilterField] = useState('')
  const [accuracyFilterValue, setAccuracyFilterValue] = useState('')

  const accuracyFieldValues = useMemo(() => {
    if (!accuracyFilterField) return []
    const vals = new Set<string>()
    sessions.forEach(s => {
      const v = s.frontmatterFields?.[accuracyFilterField]
      if (Array.isArray(v)) v.forEach(x => vals.add(x))
      else if (v) vals.add(v)
    })
    return Array.from(vals).sort()
  }, [sessions, accuracyFilterField])

  const noteBreakdown = useMemo(() => computeNoteBreakdown(entries), [entries])
  const tagBreakdown = useMemo(() => computeTagBreakdown(sessions), [sessions])
  const fieldBreakdowns = useMemo(() => {
    return statsFieldKeys.map(key => ({
      key,
      breakdown: computeFieldBreakdown(sessions, key)
    })).filter(fb => fb.breakdown.length > 0)
  }, [sessions, statsFieldKeys])
  const hourlyDist = useMemo(() => computeHourlyDistribution(entries), [entries])
  const estimateAccuracy = useMemo(() => {
    const filter = accuracyFilterField && accuracyFilterValue
      ? { fieldKey: accuracyFilterField, fieldValue: accuracyFilterValue }
      : undefined
    return computeEstimateAccuracy(sessions, 30, filter)
  }, [sessions, accuracyFilterField, accuracyFilterValue])

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-medium mb-3 text-zinc-300 flex items-center gap-2">
          <Layers size={14} />
          {t('noteBreakdown')}
        </h4>
        <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
          {noteBreakdown.length === 0 && <div className="text-sm text-zinc-500 py-4 text-center">{t('noData')}</div>}
          {noteBreakdown.slice(0, 15).map((note, i) => (
            <div key={i} className="flex items-center gap-3 p-2 bg-zinc-800/60 rounded-lg">
              <span className="text-xs text-zinc-400 truncate flex-1">{note.noteName}</span>
              <span className="text-xs font-mono text-emerald-400">{formatMs(note.totalMs)}</span>
              <span className="text-[10px] text-zinc-500">{note.count}x</span>
            </div>
          ))}
        </div>
      </div>

      {tagBreakdown.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-3 text-zinc-300 flex items-center gap-2">
            <Layers size={14} />
            {t('tags') || 'Tags'}
          </h4>
          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
            {tagBreakdown.map((item, i) => {
              const maxMs = tagBreakdown[0]?.totalMs || 1
              return (
                <div key={i} className="flex items-center gap-3 p-2 bg-zinc-800/60 rounded-lg">
                  <span className="text-xs text-zinc-300 font-medium w-20 truncate shrink-0">{item.tag}</span>
                  <div className="flex-1 bg-zinc-700 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${(item.totalMs / maxMs) * 100}%` }} />
                  </div>
                  <span className="text-xs font-mono text-emerald-400 w-16 text-right">{formatMs(item.totalMs)}</span>
                  <span className="text-[10px] text-zinc-500 w-8 text-right">{item.count}x</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {fieldBreakdowns.map(({ key, breakdown }) => (
        <div key={key}>
          <h4 className="text-sm font-medium mb-3 text-zinc-300 flex items-center gap-2">
            <Layers size={14} />
            {key.charAt(0).toUpperCase() + key.slice(1)}
          </h4>
          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
            {breakdown.slice(0, 10).map((item, i) => {
              const maxMs = breakdown[0]?.totalMs || 1
              const pct = Math.round((item.totalMs / (breakdown.reduce((s, x) => s + x.totalMs, 0) || 1)) * 100)
              return (
                <div key={i} className="flex items-center gap-3 p-2 bg-zinc-800/60 rounded-lg">
                  <span className="text-xs text-zinc-300 truncate flex-1">{item.value}</span>
                  <div className="flex-1 bg-zinc-700 rounded-full h-1.5 max-w-[120px]">
                    <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${(item.totalMs / maxMs) * 100}%` }} />
                  </div>
                  <span className="text-xs font-mono text-emerald-400 w-16 text-right">{formatMs(item.totalMs)}</span>
                  <span className="text-[10px] text-zinc-500 w-10 text-right">{pct}%</span>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <div>
        <h4 className="text-sm font-medium mb-3 text-zinc-300 flex items-center gap-2">
          <GanttChartSquare size={14} />
          {t('hourlyDistribution')}
        </h4>
        <div className="flex items-end gap-0.5 h-24">
          {hourlyDist.map((h, i) => {
            const maxMs = Math.max(...hourlyDist.map(x => x.ms), 1)
            const height = maxMs > 0 ? (h.ms / maxMs) * 100 : 0
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                <div className="w-full relative flex-1" style={{ minHeight: '20px' }}>
                  <div
                    className="absolute bottom-0 w-full rounded-sm bg-indigo-500/60"
                    style={{ height: `${Math.max(height, 1)}%` }}
                    title={`${h.hour}:00 - ${formatMs(h.ms)}`}
                  />
                </div>
                <span className="text-[7px] text-zinc-600">{h.hour}</span>
              </div>
            )
          })}
        </div>
      </div>

      {(estimateAccuracy.totalWithEstimate > 0 || accuracyFilterField) && (
        <div>
          <h4 className="text-sm font-medium mb-3 text-zinc-300 flex items-center gap-2">
            <Award size={14} />
          {t('estimateAccuracy')}
            </h4>
            {statsFieldKeys.length > 0 && (
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <select
                  value={accuracyFilterField}
                  onChange={e => {
                    setAccuracyFilterField(e.target.value)
                    setAccuracyFilterValue('')
                  }}
                  className="bg-zinc-800 text-xs px-2 py-1.5 rounded border border-zinc-700 text-zinc-300"
                >
                  <option value="">{t('all')}</option>
                  {statsFieldKeys.map(key => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
                {accuracyFilterField && accuracyFieldValues.length > 0 && (
                  <select
                    value={accuracyFilterValue}
                    onChange={e => setAccuracyFilterValue(e.target.value)}
                    className="bg-zinc-800 text-xs px-2 py-1.5 rounded border border-zinc-700 text-zinc-300"
                  >
                    <option value="">{t('all')}</option>
                    {accuracyFieldValues.map(v => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
            {estimateAccuracy.totalWithEstimate > 0 ? (
              <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="p-3 bg-zinc-800/60 rounded-xl">
              <div className="text-[10px] text-zinc-500 mb-1">{t('accuracy')}</div>
              <div className="text-lg font-bold text-emerald-400">{estimateAccuracy.accuracyPercent}%</div>
            </div>
            <div className="p-3 bg-zinc-800/60 rounded-xl">
              <div className="text-[10px] text-zinc-500 mb-1">{t('metEstimates')}</div>
              <div className="text-lg font-bold text-emerald-400">{estimateAccuracy.metCount}</div>
            </div>
            <div className="p-3 bg-zinc-800/60 rounded-xl">
              <div className="text-[10px] text-zinc-500 mb-1">{t('missedEstimates')}</div>
              <div className="text-lg font-bold text-red-400">{estimateAccuracy.missedCount}</div>
            </div>
            <div className="p-3 bg-zinc-800/60 rounded-xl">
              <div className="text-[10px] text-zinc-500 mb-1">{t('avgOverrun')}</div>
              <div className="text-lg font-bold text-amber-400">+{estimateAccuracy.avgOverrunPercent}%</div>
            </div>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
            {estimateAccuracy.byDay.slice(-14).map((d, i) => (
              <div key={i} className="flex items-center gap-2 p-2 bg-zinc-800/60 rounded-lg">
                <span className="text-xs text-zinc-400 w-12 shrink-0">{d.date.slice(5)}</span>
                <div className="flex-1 bg-zinc-700 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full ${d.missedCount > 0 ? 'bg-red-500' : 'bg-emerald-500'}`}
                    style={{ width: `${d.totalWithEstimate > 0 ? (d.metCount / d.totalWithEstimate) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-[10px] text-emerald-400 w-8 text-right">{d.metCount}</span>
                <span className="text-[10px] text-red-400 w-8 text-right">{d.missedCount}</span>
                {d.avgOverrunPercent > 0 && (
                  <span className="text-[10px] text-amber-400 w-12 text-right">+{d.avgOverrunPercent}%</span>
                )}
              </div>
            ))}
          </div>
            </>
            ) : (
              <div className="text-sm text-zinc-500 py-4 text-center">{t('noData')}</div>
            )}
        </div>
      )}
    </div>
  )
}
