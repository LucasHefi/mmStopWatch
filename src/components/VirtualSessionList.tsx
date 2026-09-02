import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BookOpen, Bookmark, Eye, Pencil, Play } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useSessionStore, selectMdConfig } from '../stores/sessionStore'
import type { TimerInstance } from '../stores/timersStore'
import type { Session } from '../types/session'
import { useTranslation } from '../i18n/useTranslation'
import { formatDuration } from '../utils/time'

const ROW_HEIGHT = 112
const OVERSCAN = 3
const VISIBLE_ROWS = 8
const FALLBACK_COLOR = '#64748b'

interface VirtualSessionListProps {
  sessions: Session[]
  runningTimersByNote: Map<string, TimerInstance>
  pinnedNotes: Set<string>
  onEdit: (session: Session) => void
  onPreview: (session: Session) => void
}

export default function VirtualSessionList({ sessions, runningTimersByNote, pinnedNotes, onEdit, onPreview }: VirtualSessionListProps) {
  const [windowStart, setWindowStart] = useState(0)
  const openNote = useSessionStore(state => state.openNote)
  const togglePinNote = useSessionStore(state => state.togglePinNote)
  const mdConfig = useSessionStore(selectMdConfig)
  const { t } = useTranslation()

  const resetKey = `${sessions.length}:${sessions[0]?.id || ''}:${sessions[sessions.length - 1]?.id || ''}`
  useEffect(() => setWindowStart(0), [resetKey])

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const nextStart = Math.max(0, Math.floor(event.currentTarget.scrollTop / ROW_HEIGHT) - OVERSCAN)
    setWindowStart(previous => previous === nextStart ? previous : nextStart)
  }, [])

  const visibleSessions = useMemo(
    () => sessions.slice(windowStart, windowStart + VISIBLE_ROWS + OVERSCAN * 2),
    [sessions, windowStart],
  )

  if (sessions.length === 0) {
    return <div className="py-8 text-center text-sm text-zinc-500">{t('noSessions')}</div>
  }

  return (
    <div className="session-list-viewport h-[calc(100vh-290px)] min-h-48 overflow-y-auto pr-1" onScroll={onScroll}>
      <div className="relative" style={{ height: sessions.length * ROW_HEIGHT }}>
        {visibleSessions.map((session, visibleIndex) => {
          const index = windowStart + visibleIndex
          const runningTimer = runningTimersByNote.get(session.notePath || '')
          const noteColor = runningTimer?.color || FALLBACK_COLOR
          const isRunning = runningTimer?.status === 'RUNNING'
          const isPinned = pinnedNotes.has(session.notePath || '')
          return (
            <div
              key={session.id}
              onClick={() => openNote(session)}
              style={{
                top: index * ROW_HEIGHT,
                height: ROW_HEIGHT - 8,
                borderLeftColor: `${noteColor}b3`,
                ...(isRunning ? { background: `radial-gradient(circle at 0% 50%, ${noteColor}33 0%, transparent 60%), #18181b` } : {}),
              }}
              className={`absolute inset-x-0 overflow-hidden rounded-xl border-l-2 px-3 py-2.5 transition-colors hover:bg-zinc-800/80 ${isPinned ? 'bg-zinc-800/60' : 'bg-zinc-900/60'} ${isRunning ? 'running-row' : ''}`}
            >
              {session.relativePath && <div className="truncate pr-6 text-[10px] text-zinc-500">{session.relativePath}</div>}
              <button
                type="button"
                aria-label={isPinned ? t('unpinNote') : t('pinNote')}
                onClick={event => { event.stopPropagation(); togglePinNote(session.notePath || '') }}
                className="absolute right-2 top-2 text-indigo-400 transition-transform hover:scale-110 hover:text-indigo-300"
              >
                <Bookmark size={14} className={isPinned ? 'fill-indigo-400' : ''} />
              </button>
              <div className="flex min-w-0 items-start justify-between gap-2 pr-5">
                <div className="flex min-w-0 items-center gap-1.5">
                  {isRunning && <Play size={12} className="running-play-pulse shrink-0" style={{ color: `${noteColor}cc` }} />}
                  <div className="truncate text-sm font-medium">{session.name}</div>
                </div>
                <div className="shrink-0 font-mono text-sm tabular-nums text-zinc-400">
                  {session.parseError ? <AlertTriangle size={12} className="text-amber-400" /> : formatDuration(session.duration_ms)}
                </div>
              </div>
              <div className="mt-1 flex h-5 gap-1 overflow-hidden">
                {session.tags?.slice(0, 3).map(tag => <span key={tag} className="truncate rounded bg-zinc-800 px-1.5 py-0.5 text-[10px]">{tag}</span>)}
                {(session.tags?.length || 0) > 3 && <span className="text-[10px] text-zinc-500">+{session.tags!.length - 3}</span>}
              </div>
              <div className="mt-1 flex gap-2 text-xs" onClick={event => event.stopPropagation()}>
                <button type="button" onClick={() => onEdit(session)} aria-label={`${t('edit')}: ${session.name}`} className="text-zinc-400 hover:text-white"><Pencil size={12} /></button>
                {session.preview && <button type="button" onClick={() => onPreview(session)} aria-label={`${t('preview')}: ${session.name}`} className="text-zinc-400 hover:text-white"><Eye size={12} /></button>}
                {session.notePath && (
                  <button
                    type="button"
                    aria-label={`${t('openInObsidian')}: ${session.name}`}
                    onClick={() => void openUrl(`obsidian://open?vault=${encodeURIComponent(mdConfig.obsidianVault || 'YourVaultName')}&file=${encodeURIComponent(session.relativePath || '')}`)}
                    className="text-zinc-400 hover:text-white"
                  >
                    <BookOpen size={12} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
