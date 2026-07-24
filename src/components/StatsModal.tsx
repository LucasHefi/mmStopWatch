import { useState, useEffect } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { useTranslation } from '../i18n/useTranslation'
import { motion, AnimatePresence } from 'framer-motion'
import { computeStats, resolveDailyGoalMs } from '../services/stats'
import { generateWeeklyReport, generateMonthlyReport, saveReportToVault } from '../services/reportService'
import { BarChart3, List, CalendarDays, PieChart, LineChart, FileDown, CheckCircle2, X, Users } from 'lucide-react'
import { activityService } from '../services/activityService'
import { listAvailableNicks } from '../services/appConfig'
import StatsOverview from './stats/StatsOverview'
import StatsAllDays from './stats/StatsAllDays'
import StatsBreakdown from './stats/StatsBreakdown'
import StatsTrends from './stats/StatsTrends'
import CalendarView from './CalendarView'

type Period = 'day' | 'week' | 'month'
type ViewMode = 'overview' | 'allDays' | 'calendar' | 'breakdown' | 'trends'

export default function StatsModal({ onClose }: { onClose: () => void }) {
  const { sessions, mdConfig } = useSessionStore()
  const { t } = useTranslation()
  const [period, setPeriod] = useState<Period>('week')
  const [exported, setExported] = useState(false)
  const [reportSaved, setReportSaved] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('overview')

  const currentNick = mdConfig.nick || ''
  const [selectedNick, setSelectedNick] = useState(currentNick)
  const [availableNicks, setAvailableNicks] = useState<string[]>([])
  const [nickEntries, setNickEntries] = useState(activityService.getHistory().entries)

  useEffect(() => {
    if (!mdConfig.notesFolder) return
    listAvailableNicks(mdConfig.notesFolder).then(nicks => {
      const set = new Set(nicks)
      if (currentNick) set.add(currentNick)
      setAvailableNicks(Array.from(set).sort((a, b) => a === currentNick ? -1 : b === currentNick ? 1 : a.localeCompare(b)))
    })
  }, [mdConfig.notesFolder, currentNick])

  useEffect(() => {
    if (!mdConfig.notesFolder || !selectedNick) return
    if (selectedNick === currentNick) {
      setNickEntries(activityService.getHistory().entries)
    } else {
      activityService.loadHistoryForNick(mdConfig.notesFolder, selectedNick).then(h => {
        setNickEntries(h.entries)
      })
    }
  }, [selectedNick, mdConfig.notesFolder, currentNick])

  const entries = nickEntries
  const stats = computeStats(sessions, period, entries)
  const dailyGoal = resolveDailyGoalMs(mdConfig.dailyGoalMs)

  const handleExport = async () => {
    const path = await activityService.exportToMd()
    if (path) {
      setExported(true)
      setTimeout(() => setExported(false), 3000)
    }
  }

  const handleExportReport = async (type: 'weekly' | 'monthly') => {
    if (!mdConfig.notesFolder) return
    const reportFn = type === 'weekly' ? generateWeeklyReport : generateMonthlyReport
    const md = reportFn(entries, sessions, dailyGoal, selectedNick || currentNick || 'user')
    const path = await saveReportToVault(md, mdConfig.notesFolder, type)
    if (path) {
      setReportSaved(true)
      setTimeout(() => setReportSaved(false), 3000)
    }
  }

  return (
    <AnimatePresence>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        onClick={e => e.stopPropagation()}
        className="bg-zinc-900 p-4 sm:p-6 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg sm:text-xl font-semibold">{t('statistics')}</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleExportReport('weekly')}
              className="hidden sm:flex items-center gap-1.5 text-xs bg-indigo-700 hover:bg-indigo-600 text-zinc-200 px-3 py-1.5 rounded-lg transition-colors"
              title={t('exportWeeklyReport')}
            >
              <FileDown size={14} />
              {t('exportWeeklyReport')}
            </button>
            <button
              onClick={() => handleExportReport('monthly')}
              className="hidden sm:flex items-center gap-1.5 text-xs bg-indigo-800 hover:bg-indigo-700 text-zinc-200 px-3 py-1.5 rounded-lg transition-colors"
              title={t('exportMonthlyReport')}
            >
              <FileDown size={14} />
              {t('exportMonthlyReport')}
            </button>
            {reportSaved && <span className="text-[10px] text-emerald-400">{t('reportSaved')}</span>}
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors"
              title={t('exportStats')}
            >
              {exported ? <CheckCircle2 size={14} className="text-emerald-400" /> : <FileDown size={14} />}
              {exported ? t('exported') : t('exportStats')}
            </button>
            <button onClick={onClose} className="text-zinc-400 hover:text-white"><X size={18} /></button>
          </div>
        </div>

        {/* Nick tabs */}
        {availableNicks.length > 1 && (
          <div className="flex items-center gap-1 mb-3 overflow-x-auto">
            <Users size={14} className="text-zinc-500 mr-1 shrink-0" />
            {availableNicks.map(nick => (
              <button
                key={nick}
                onClick={() => setSelectedNick(nick)}
                className={`text-xs px-2.5 py-1 rounded-lg whitespace-nowrap transition-colors ${
                  selectedNick === nick
                    ? 'bg-indigo-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
                }`}
              >
                {nick}
              </button>
            ))}
          </div>
        )}

        {/* View mode tabs */}
        <div className="flex gap-1 mb-4 bg-zinc-800 rounded-lg p-1 overflow-x-auto">
          {(['overview', 'allDays', 'calendar', 'breakdown', 'trends'] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded whitespace-nowrap transition-colors ${
                viewMode === mode ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {mode === 'overview' && <BarChart3 size={12} />}
              {mode === 'allDays' && <List size={12} />}
              {mode === 'calendar' && <CalendarDays size={12} />}
              {mode === 'breakdown' && <PieChart size={12} />}
              {mode === 'trends' && <LineChart size={12} />}
              {mode === 'overview' && t('details')}
              {mode === 'allDays' && t('allDays')}
              {mode === 'calendar' && t('calendar')}
              {mode === 'breakdown' && t('breakdown')}
              {mode === 'trends' && t('trends')}
            </button>
          ))}
        </div>

        {viewMode === 'overview' && (
          <StatsOverview
            sessions={sessions}
            entries={entries}
            dailyGoal={dailyGoal}
            period={period}
            onPeriodChange={setPeriod}
            stats={stats}
          />
        )}

        {viewMode === 'allDays' && (
          <StatsAllDays sessions={sessions} entries={entries} dailyGoal={dailyGoal} />
        )}

        {viewMode === 'calendar' && (
          <CalendarView entries={entries} dailyGoalMs={dailyGoal} />
        )}

        {viewMode === 'breakdown' && (
          <StatsBreakdown sessions={sessions} entries={entries} statsFieldKeys={mdConfig.statsFieldKeys || ['project', 'client', 'type']} />
        )}

        {viewMode === 'trends' && (
          <StatsTrends entries={entries} sessions={sessions} statsFieldKeys={mdConfig.statsFieldKeys || []} onExportReport={handleExportReport} />
        )}
      </motion.div>
    </motion.div>
    </AnimatePresence>
  )
}
