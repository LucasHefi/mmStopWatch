import { useState, useEffect, useCallback, useMemo } from 'react'
import { checkAndNotify, resetNotificationCycle } from './core/notificationManager'
import { getCurrentWindow } from '@tauri-apps/api/window'
import pkg from '../package.json'
import { useSessionStore, selectFilteredSessions, selectMdConfig } from './stores/sessionStore'
import { useTimersStore, selectTimers } from './stores/timersStore'
import { useShallow } from 'zustand/react/shallow'
import { ArrowLeftRight, BarChart3, RefreshCw, Settings, X, Search, Menu } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import SettingsModal from './components/SettingsModal'
import EditModal from './components/EditModal'
import NewNoteModal from './components/NewNoteModal'
import StatsModal from './components/StatsModal'
import UndoToast from './components/UndoToast'
import OnboardingWizard from './components/OnboardingWizard'
import TimerGrid from './components/TimerGrid'
import CloseGuardDialog from './components/CloseGuardDialog'
import { BackgroundBeams } from './components/ui/BackgroundBeams'
import PreviewModal from './components/PreviewModal'
import RecoveryOverlay from './components/RecoveryOverlay'
import VirtualSessionList from './components/VirtualSessionList'
import { useRecoveryLifecycle } from './hooks/useRecoveryLifecycle'
import { useTranslation } from './i18n/useTranslation'
import type { Session, LayoutMode } from './types/session'

const SIDEBAR_BREAKPOINT = 800

function App() {
  const [showSettings, setShowSettings] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [editSession, setEditSession] = useState<Session | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [previewSession, setPreviewSession] = useState<Session | null>(null)
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < SIDEBAR_BREAKPOINT)
  const filteredSessions = useSessionStore(selectFilteredSessions)
  const mdConfig = useSessionStore(selectMdConfig)
  const timers = useTimersStore(useShallow(selectTimers))
  const runningTimers = useMemo(() => timers.filter(t => t.status === 'RUNNING'), [timers])
  const runningTimersByNote = useMemo(() => new Map(runningTimers.map(timer => [timer.notePath, timer])), [runningTimers])
  const pinnedNotes = useMemo(() => new Set(mdConfig.pinnedNotes || []), [mdConfig.pinnedNotes])
  const { refreshSessions, deletedSessions, undoDelete, notesLoading, notesError } = useSessionStore(useShallow(state => ({
    refreshSessions: state.refreshSessions,
    deletedSessions: state.deletedSessions,
    undoDelete: state.undoDelete,
    notesLoading: state.notesLoading,
    notesError: state.notesError,
  })))
  const { t } = useTranslation()
  useRecoveryLifecycle()
  const searchValue = useSessionStore(s => s.filters.search)

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth < SIDEBAR_BREAKPOINT
      setIsMobile(mobile)
      if (!mobile) setSidebarOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const win = getCurrentWindow()
    const unlisten = win.onCloseRequested(async (event) => {
      const timers = useTimersStore.getState().timers
      const active = timers.filter(t => t.status === 'RUNNING' || t.status === 'PAUSED' || t.status === 'STOPPED')
      if (active.length > 0) {
        event.preventDefault()
        setShowCloseDialog(true)
      }
    })
    return () => { unlisten.then(fn => fn()) }
  }, [])

  useEffect(() => {
    const minutes = mdConfig.autoRefreshInterval
    if (!minutes || minutes <= 0) return
    const iv = setInterval(() => { refreshSessions() }, minutes * 60 * 1000)
    return () => clearInterval(iv)
  }, [mdConfig.autoRefreshInterval, refreshSessions])

  useEffect(() => {
    const iv = setInterval(() => { checkAndNotify() }, 5000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    const isAnyRunning = runningTimers.length > 0
    if (!isAnyRunning) resetNotificationCycle()
  }, [runningTimers])

  useEffect(() => {
    useSessionStore.getState().initializeFromConfig?.()
  }, [])

  const [viewMode, setViewMode] = useState<'cards' | 'table'>(mdConfig.timerViewMode || 'cards')
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(mdConfig.timerLayout?.mode || 'list')

  const handleViewModeChange = useCallback((mode: 'cards' | 'table') => {
    setViewMode(mode)
    useSessionStore.getState().setMDConfig({ timerViewMode: mode })
  }, [])

  const handleLayoutModeChange = useCallback((mode: LayoutMode) => {
    setLayoutMode(mode)
    useSessionStore.getState().setMDConfig({ timerLayout: { ...(mdConfig.timerLayout || { order: [] }), mode } })
  }, [mdConfig.timerLayout])

  // A stale legacy config can claim onboarding is complete while no vault
  // path was persisted. Do not present an empty workspace in that state; let
  // the user select the vault again so the runtime filesystem scope can load it.
  const needsOnboarding = (mdConfig.onboardingComplete !== true || !mdConfig.notesFolder) && !showSettings

  useEffect(() => {
    const timeEstimates = mdConfig.timeEstimates || {}
    const timersWithEstimates = runningTimers.filter(t => timeEstimates[t.notePath])
    for (const timer of timersWithEstimates) {
      const te = timeEstimates[timer.notePath]
      if (te !== undefined && timer.timeEstimate !== te) {
        useTimersStore.getState().setTimeEstimate(timer.notePath, te)
      }
    }
  }, [mdConfig.timeEstimates, runningTimers])

  useEffect(() => {
    const updateTitle = async () => {
      try {
        const win = getCurrentWindow()
        await win.setTitle(`mmStopWatch v${pkg.version}`)
      } catch (err) {
        console.error('Failed to set window title:', err)
      }
    }
    updateTitle()
  }, [])

  const handleSaveAndClose = async () => {
    const timers = useTimersStore.getState().timers.filter(t => t.status === 'RUNNING' || t.status === 'PAUSED' || t.status === 'STOPPED')
    for (const timer of timers) {
      await useTimersStore.getState().stopTimer(timer.id, async (elapsed, notePath, operationId) => {
        await useSessionStore.getState().saveSessionToNote(elapsed, notePath, true, operationId)
      })
    }
    setShowCloseDialog(false)
    getCurrentWindow().destroy()
  }

  const handleDiscardAndClose = async () => {
    setShowCloseDialog(false)
    getCurrentWindow().destroy()
  }

  if (needsOnboarding) {
    return <OnboardingWizard onComplete={() => undefined} />
  }

  const sidebarContent = (
    <>
      <div className="mb-4 p-3 bg-zinc-900 rounded-xl text-xs text-zinc-400 shadow-inner">
        {t('total')}: {filteredSessions.reduce((sum, s) => sum + s.duration_ms, 0) / 1000 / 60 | 0} {t('min')} • {filteredSessions.length} {t('sessions')}
      </div>
      {notesLoading && (
        <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs text-zinc-400" role="status">
          {t('notesLoading')}
        </div>
      )}
      {notesError && (
        <div className="mb-3 rounded-xl border border-red-900/70 bg-red-950/30 px-3 py-3 text-xs text-red-200" role="alert">
          <div className="font-medium">{t('notesLoadFailed')}</div>
          <div className="mt-1 break-words text-red-300/80">{notesError}</div>
          <button type="button" onClick={() => { void refreshSessions() }} className="mt-2 rounded-lg bg-red-900/60 px-2.5 py-1 text-red-100 hover:bg-red-900">{t('retry')}</button>
        </div>
      )}
      {deletedSessions.length > 0 && (
        <div className="mb-2 flex items-center justify-between bg-zinc-900 rounded-xl px-3 py-2 text-xs">
          <span className="text-zinc-500">{deletedSessions.length} {t('deleted')}</span>
          <button type="button" onClick={() => undoDelete()} className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1">
            <ArrowLeftRight size={12} /> {t('undo')}
          </button>
        </div>
      )}
      <div className="flex justify-between items-center mb-4">
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => setShowNew(true)} className="text-xs px-3 py-1 bg-zinc-800 rounded">{t('new')}</button>
          <button type="button" onClick={refreshSessions} aria-label="Refresh" className="text-xs px-3 py-1 bg-zinc-800 rounded text-zinc-400 hover:text-white" title="Refresh"><RefreshCw size={12} /></button>
          <button type="button" onClick={() => setShowStats(true)} aria-label={t('statistics')} className="text-xs px-3 py-1 bg-zinc-800 rounded text-zinc-400 hover:text-white" title={t('statistics')}><BarChart3 size={12} /></button>
          <button type="button" onClick={() => setShowSettings(true)} aria-label={t('settings')} className="text-xs px-3 py-1 bg-zinc-800 rounded text-zinc-400 hover:text-white" title={t('settings')}><Settings size={12} /></button>
        </div>
      </div>
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
        <input
          type="text"
          value={searchValue}
          placeholder={t('filter')}
          className="w-full pl-9 pr-8 py-1.5 bg-zinc-800/50 border border-zinc-700/50 rounded-xl text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all"
          onChange={e => useSessionStore.getState().setFilters({ search: e.target.value })}
        />
        {searchValue && (
          <button
            type="button"
            aria-label={t('clear')}
            onClick={() => useSessionStore.getState().setFilters({ search: '' })}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <VirtualSessionList
        sessions={filteredSessions}
        runningTimersByNote={runningTimersByNote}
        pinnedNotes={pinnedNotes}
        onEdit={setEditSession}
        onPreview={setPreviewSession}
      />
    </>
  )

  return (
    <div className="h-screen overflow-hidden bg-zinc-950 text-white flex relative">
      {isMobile && (
        <button
          type="button"
          aria-label={t('sidebarToggle')}
          onClick={() => setSidebarOpen(true)}
          className="fixed top-4 right-4 z-40 p-2 bg-zinc-800 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-700 transition-all shadow-lg"
          title={t('sidebarToggle')}
        >
          <Menu size={20} />
        </button>
      )}

      <div className={`flex-1 h-full overflow-hidden flex items-center justify-center p-8 border-r border-zinc-800 ambient-bg relative ${isMobile ? 'border-r-0' : ''}`}>
        <BackgroundBeams />
        <div className="w-full max-h-full overflow-y-auto relative z-10">
          {timers.length > 0 ? (
            <TimerGrid
              timers={timers}
              viewMode={viewMode}
              layoutMode={layoutMode}
              onViewModeChange={handleViewModeChange}
              onLayoutModeChange={handleLayoutModeChange}
            />
          ) : (
            <div className="text-sm text-zinc-600 text-center py-12">{t('noSessions')}</div>
          )}
        </div>
      </div>

      {isMobile ? (
        <AnimatePresence>
          {sidebarOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/60 z-30"
                onClick={() => setSidebarOpen(false)}
              />
              <motion.aside
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed right-0 top-0 h-full w-80 max-w-[85vw] z-40 bg-zinc-950 border-l border-zinc-800 p-6 overflow-y-auto overflow-x-hidden shadow-2xl"
              >
                {sidebarContent}
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      ) : (
        <aside className="flex-shrink-0 basis-80 min-w-[240px] max-w-[400px] h-full p-6 overflow-y-auto overflow-x-hidden">
          {sidebarContent}
        </aside>
      )}

      <UndoToast />
      <RecoveryOverlay />
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showStats && <StatsModal onClose={() => setShowStats(false)} />}
      {editSession && <EditModal session={editSession} onClose={() => setEditSession(null)} />}
      {showNew && <NewNoteModal onClose={() => setShowNew(false)} />}

      {showCloseDialog && (
        <CloseGuardDialog
          onClose={() => setShowCloseDialog(false)}
          onSaveAndClose={handleSaveAndClose}
          onDiscardAndClose={handleDiscardAndClose}
        />
      )}

      {previewSession && (
        <PreviewModal session={previewSession} onClose={() => setPreviewSession(null)} />
      )}
    </div>
  )
}

export default App
