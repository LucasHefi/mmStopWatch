import { motion, AnimatePresence } from 'framer-motion'
import { Play, Pause, Save, X, Timer, Pencil, Check, AlertCircle, GripVertical } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TimerInstance } from '../stores/timersStore'
import { useTimerActions } from '../hooks/useTimerActions'
import { useTranslation } from '../i18n/useTranslation'
import ExpirationOverlay from './ExpirationOverlay'
import { formatTime } from '../utils/time'

interface TimerTableViewProps {
  timer: TimerInstance
  dragHandle?: boolean
}

export default function TimerTableView({ timer, dragHandle }: TimerTableViewProps) {
  const { t } = useTranslation()
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging
  } = useSortable({ id: timer.notePath || timer.id })

  const {
    currentTimer, elapsedMs, timeRef, editInputRef,
    editing, editValue, setEditValue, progress, setShowOverlay,
    openEditor, saveEdit, applyPreset, removeEstimate,
    noteColor, isRunning, isSaving, shouldShowOverlay, timeEstimate,
    remainingMinInt, remainingSec, isExpired, barColor, PRESETS, mdConfig,
    handleDiscard, handlePlayPause, handleSave,
    setEditing,
  } = useTimerActions(timer)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <motion.tr
      ref={setNodeRef}
      style={style}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="group border-b border-zinc-800/60 hover:bg-zinc-800/30 transition-colors"
    >
      {dragHandle && (
        <td className="py-2 pr-1 pl-2 w-8" {...attributes} {...listeners}>
          <GripVertical size={14} className="text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing" />
        </td>
      )}
      <td className="py-2 pr-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: noteColor }} />
          <span className="text-sm text-zinc-200 truncate">{timer.name}</span>
          {isExpired && <AlertCircle size={12} className="text-red-400 shrink-0" />}
        </div>
      </td>
      <td className="py-2 pr-3 whitespace-nowrap">
        <div
          ref={timeRef}
          className={`font-mono text-sm tabular-nums ${isExpired ? 'text-red-400' : 'text-zinc-200'}`}
        >
          {formatTime(elapsedMs)}
        </div>
      </td>
      <td className="py-2 pr-3 min-w-[100px]">
        {timeEstimate ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-zinc-700 rounded-full h-1.5 overflow-hidden min-w-[60px]">
              <motion.div
                className={`h-1.5 rounded-full ${barColor}`}
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
            {timeEstimate && (
              <span className="text-xs text-zinc-500 tabular-nums w-10 text-right">{Math.round(progress)}%</span>
            )}
          </div>
        ) : (
          <span className="text-xs text-zinc-600">—</span>
        )}
      </td>
      <td className="py-2 pr-3 whitespace-nowrap">
        {timeEstimate ? (
          <div className="flex items-center gap-1">
            <Timer size={10} className="text-zinc-500" />
            <span className="text-xs text-zinc-400">{timeEstimate}min</span>
            {isExpired && isRunning ? (
              <span className="text-xs text-red-400">{t('expired')}</span>
            ) : (
              <span className="text-xs text-zinc-500">
                {remainingMinInt}m {remainingSec}s
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1">
            {PRESETS.slice(0, 4).map(p => (
              <button key={p} type="button" aria-label={`Set estimate ${p} minutes`} onClick={() => applyPreset(p)} className="text-xs px-1.5 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-500 hover:text-zinc-300">
                {p}m
              </button>
            ))}
            <button type="button" aria-label="Edit estimate" onClick={openEditor} className="text-xs px-1.5 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-500 hover:text-zinc-300">
              <Pencil size={10} />
            </button>
          </div>
        )}
        <AnimatePresence>
          {editing && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1 mt-1">
              <input
                ref={editInputRef}
                type="number"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(false) }}
                onBlur={saveEdit}
                placeholder="min"
                className="w-16 bg-zinc-950 px-2 py-0.5 rounded text-xs focus:ring-1 focus:ring-zinc-700"
              />
              <button type="button" onClick={saveEdit} aria-label={t('save')} className="text-zinc-400 hover:text-white"><Check size={12} /></button>
              <button type="button" onClick={() => setEditing(false)} aria-label={t('close')} className="text-zinc-400 hover:text-white"><X size={12} /></button>
            </motion.div>
          )}
        </AnimatePresence>
      </td>
      <td className="py-2 pr-3">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            aria-label={currentTimer?.status === 'RUNNING' ? t('pause') : t('start')}
            onClick={handlePlayPause}
            disabled={isSaving}
            className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 hover:text-white transition-colors"
            title={currentTimer?.status === 'RUNNING' ? 'Pause' : 'Play'}
          >
            {currentTimer?.status === 'RUNNING' ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button
            type="button"
            aria-label={t('save')}
            onClick={handleSave}
            disabled={isSaving}
            className="p-1.5 hover:bg-red-500/20 rounded text-zinc-400 hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-wait"
            title="Save"
          >
            <Save size={14} />
          </button>
          <button
            type="button"
            aria-label={t('delete')}
            onClick={handleDiscard}
            disabled={isSaving}
            className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 hover:text-white transition-colors"
            title="Discard"
          >
            <X size={14} />
          </button>
          {timeEstimate && (
            <button type="button" aria-label={t('removeEstimate')} onClick={removeEstimate} className="p-1.5 hover:bg-zinc-700 rounded text-zinc-500 hover:text-zinc-300 transition-colors" title={t('removeEstimate')}>
              <Timer size={14} />
            </button>
          )}
        </div>
      </td>
      <ExpirationOverlay
        visible={shouldShowOverlay}
        onDismiss={() => setShowOverlay(false)}
        customMessage={mdConfig.timerLimitAlert?.customMessage || ''}
      />
    </motion.tr>
  )
}
