import { motion, AnimatePresence } from 'framer-motion'
import { Play, Pause, Save, X, Timer, Pencil, Check, AlertCircle, GripVertical } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TimerInstance } from '../stores/timersStore'
import { useTimerActions } from '../hooks/useTimerActions'
import { useTranslation } from '../i18n/useTranslation'
import ExpirationOverlay from './ExpirationOverlay'

interface SecondaryTimerCardProps {
  timer: TimerInstance
  dragHandle?: boolean
}

export default function SecondaryTimerCard({ timer, dragHandle }: SecondaryTimerCardProps) {
  const { t } = useTranslation()
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging
  } = useSortable({ id: timer.notePath || timer.id, disabled: !dragHandle })

  const {
    currentTimer, timeRef, addedTimeRef, editInputRef,
    editing, editValue, setEditValue, progress, setShowOverlay,
    openEditor, saveEdit, applyPreset, removeEstimate,
    noteColor, isRunning, isSaving, shouldShowOverlay, timeEstimate,
    remainingMinInt, remainingSec, isExpired, barColor, PRESETS, mdConfig,
    handleDiscard, handlePlayPause, handleSave,
    setEditing,
  } = useTimerActions(timer)

  const style = {
    borderColor: noteColor + '44',
    borderLeft: `4px solid ${noteColor}`,
    boxShadow: isExpired
      ? `inset 0 1px 0 rgba(255,255,255,0.05), 0 10px 15px -3px rgb(0 0 0 / 0.3), 0 0 0 1px rgba(239,68,68,0.6)`
      : `inset 0 1px 0 rgba(255,255,255,0.05), 0 10px 15px -3px rgb(0 0 0 / 0.3), 0 0 0 1px ${noteColor}33`,
    background: `radial-gradient(ellipse at top, ${noteColor}20 0%, transparent 70%), rgba(24, 24, 27, 0.15)`,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -4, boxShadow: '0 25px 30px -5px rgb(0 0 0 / 0.25), 0 10px 15px -6px rgb(0 0 0 / 0.2)' }}
      className="border rounded-2xl px-7 py-6 backdrop-blur-2xl relative overflow-visible"
    >
      <div className="absolute inset-0 bg-white/5 opacity-0 hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <div className="flex justify-between items-center mb-1 relative z-10">
        <div className="flex items-center gap-2">
          {dragHandle && (
            <span className="cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-400" {...attributes} {...listeners}>
              <GripVertical size={16} />
            </span>
          )}
          <div className="text-sm text-zinc-300 truncate font-medium">{timer.name}</div>
          {isExpired && (
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-red-400">
              <AlertCircle size={14} />
            </motion.div>
          )}
        </div>
        <motion.button
          whileHover={{ scale: 1.05, color: '#fff' }}
          whileTap={{ scale: 0.96 }}
          onClick={handleDiscard}
          disabled={isSaving}
          className="p-2.5 hover:bg-white/10 rounded-xl text-zinc-400 transition-all"
        >
          <X size={18} />
        </motion.button>
      </div>

      <AnimatePresence>
      {timeEstimate && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="mb-3 relative z-10"
        >
          {timeEstimate && (
            <div className="flex items-center gap-2 mb-1">
              <Timer size={12} className="text-zinc-500" />
              <span className="text-xs text-zinc-400">{timeEstimate}min</span>
              <span className="text-zinc-600">·</span>
              {isExpired ? (
                <span className="text-xs text-red-400 flex items-center gap-1">
                  <AlertCircle size={12} /> {t('expired')}
                </span>
              ) : (
                <span className="text-xs text-zinc-400">
                  {t('remaining')} {remainingMinInt > 0 ? `${remainingMinInt}m ` : ''}{remainingSec % 60}s
                </span>
              )}
              <span className="text-zinc-600">·</span>
              <span className="text-xs text-zinc-500">{Math.round(progress)}%</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-zinc-700 rounded-full h-1.5 overflow-hidden">
              <motion.div
                className={`h-1.5 rounded-full ${barColor}`}
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>
        </motion.div>
      )}
      </AnimatePresence>

      <AnimatePresence>
      {!editing && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="mb-3 relative z-10 flex items-center gap-1 flex-wrap"
        >
          {timeEstimate ? (
            <>
              <button onClick={openEditor} className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400 flex items-center gap-1">
                <Pencil size={10} /> {timeEstimate}m
              </button>
              <button onClick={removeEstimate} className="text-xs px-2 py-1 bg-zinc-800 hover:bg-red-900/30 rounded text-zinc-500 hover:text-red-400">
                <X size={10} />
              </button>
            </>
          ) : (
            <div className="flex items-center gap-1">
              {PRESETS.map(p => (
                <button key={p} onClick={() => applyPreset(p)} className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400">
                  {p}m
                </button>
              ))}
            </div>
          )}
        </motion.div>
      )}
      </AnimatePresence>

      <AnimatePresence>
      {editing && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          className="mb-3 relative z-10 flex items-center gap-2"
        >
          <input
            ref={editInputRef}
            type="number"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(false) }}
            onBlur={saveEdit}
            placeholder={t('minutes')}
            className="flex-1 bg-zinc-950 px-3 py-2 rounded text-sm focus:ring-1 focus:ring-zinc-700"
          />
          <button onClick={saveEdit} className="text-xs px-3 py-2 bg-zinc-800 rounded text-zinc-400 hover:text-white"><Check size={12} /></button>
          <button onClick={() => setEditing(false)} className="text-xs px-3 py-2 bg-zinc-800 rounded text-zinc-400 hover:text-white"><X size={12} /></button>
        </motion.div>
      )}
      </AnimatePresence>

      <div className="flex items-center justify-between gap-4 relative z-10">
        <div className="flex flex-col">
          <motion.div
            animate={isRunning ? {
              scale: isExpired ? [1, 1.01, 1] : [1, 1.002, 1],
              opacity: isExpired ? [1, 0.8, 1] : 1
            } : {}}
            transition={{ duration: isExpired ? 0.8 : 1.2, repeat: isRunning ? Infinity : 0 }}
            className={`font-mono text-5xl tabular-nums tracking-[-2.5px] min-w-[188px] ${
              isExpired ? 'text-red-400' : 'text-white/95'
            }`}
            style={{ textShadow: isExpired ? '0 0 20px rgba(239,68,68,0.6)' : `0 2px 4px rgba(0,0,0,0.4), 0 0 16px ${noteColor}88` }}
            ref={timeRef}
          >
            00:00:00.00
          </motion.div>
          <div
            className="font-mono text-xs font-medium tabular-nums mt-0.5 tracking-wider"
            style={{ color: noteColor, textShadow: `0 0 8px ${noteColor}88` }}
            ref={addedTimeRef}
          >
            +00:00.00
          </div>
        </div>

        <div className="flex flex-col gap-1 items-end">
          <motion.button
            whileHover={{ scale: 1.05, color: '#fff', boxShadow: 'inset 0 0 12px rgba(255,255,255,0.1)' }}
            whileTap={{ scale: 0.96 }}
            onClick={handlePlayPause}
            disabled={isSaving}
            className="p-2.5 hover:bg-white/10 rounded-xl text-zinc-400 transition-all"
          >
            {currentTimer?.status === 'RUNNING' ? <Pause size={18} /> : <Play size={18} />}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.05, color: '#f87171', boxShadow: 'inset 0 0 12px rgba(248,113,113,0.1)' }}
            whileTap={{ scale: 0.96 }}
            onClick={handleSave}
            disabled={isSaving}
            className="p-2.5 hover:bg-red-500/10 rounded-xl text-zinc-400 transition-all disabled:opacity-50 disabled:cursor-wait"
          >
            <Save size={18} />
          </motion.button>
        </div>
      </div>

      <ExpirationOverlay
        visible={shouldShowOverlay}
        onDismiss={() => setShowOverlay(false)}
        customMessage={mdConfig.timerLimitAlert?.customMessage || ''}
      />
    </motion.div>
  )
}
