import { useEffect, useState } from 'react'
import { AlertTriangle, RotateCcw, Trash2, X } from 'lucide-react'
import { useSessionStore } from '../stores/sessionStore'
import { clearRecoveryCheckpoint, loadRecoveryCheckpoints, recoveryElapsed, type RecoveryCheckpoint } from '../services/recovery'
import { formatDuration } from '../utils/time'
import { useTranslation } from '../i18n/useTranslation'

export default function RecoveryOverlay() {
  const sessions = useSessionStore(state => state.sessions)
  const openNote = useSessionStore(state => state.openNote)
  const { t } = useTranslation()
  const [items, setItems] = useState<RecoveryCheckpoint[]>([])
  useEffect(() => { setItems(loadRecoveryCheckpoints()) }, [])
  if (items.length === 0) return null
  const remove = (timerId: string) => { clearRecoveryCheckpoint(timerId); setItems(current => current.filter(item => item.timerId !== timerId)) }
  const recover = (item: RecoveryCheckpoint) => {
    const session = sessions.find(candidate => candidate.notePath === item.notePath)
    if (!session) return
    const elapsed = recoveryElapsed(item)
    openNote(session, { elapsed, pausedOffset: elapsed })
    remove(item.timerId)
  }
  return <div className="fixed bottom-4 left-4 right-4 z-[60] mx-auto max-w-2xl rounded-2xl border border-amber-500/40 bg-zinc-900/95 p-4 shadow-2xl backdrop-blur-xl" role="alertdialog" aria-labelledby="recovery-title" aria-describedby="recovery-description">
    <div className="flex items-start gap-3">
      <AlertTriangle className="mt-0.5 shrink-0 text-amber-400" size={20} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div id="recovery-title" className="font-semibold text-zinc-100">{t('recoveryTitle')}</div>
        <p id="recovery-description" className="mt-1 text-sm text-zinc-400">{t('recoveryMessage')}</p>
        <div className="mt-3 space-y-2">
          {items.map(item => <div key={item.timerId} className="flex flex-wrap items-center gap-2 rounded-xl bg-zinc-950/70 p-3">
            <div className="min-w-0 flex-1"><div className="truncate text-sm text-zinc-200">{item.name}</div><div className="text-xs text-zinc-500">{formatDuration(recoveryElapsed(item))} · {t('recoveryCheckpoint')} {new Date(item.capturedAt).toLocaleTimeString()}</div></div>
            <button onClick={() => recover(item)} disabled={!sessions.some(candidate => candidate.notePath === item.notePath)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40" aria-label={t('recoveryRestore') + ': ' + item.name}><RotateCcw size={13} aria-hidden="true" /> {t('recoveryRestore')}</button>
            <button onClick={() => remove(item.timerId)} className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700" aria-label={t('recoveryDiscard') + ': ' + item.name}><Trash2 size={13} aria-hidden="true" /> {t('recoveryDiscard')}</button>
          </div>)}
        </div>
      </div>
      <button onClick={() => items.forEach(item => remove(item.timerId))} className="rounded-lg p-1 text-zinc-500 hover:text-white" aria-label={t('close')}><X size={16} aria-hidden="true" /></button>
    </div>
  </div>
}