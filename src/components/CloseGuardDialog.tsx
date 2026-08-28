import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { X, Save, Trash2 } from 'lucide-react'
import { useTranslation } from '../i18n/useTranslation'
import { useTimersStore, selectActiveTimers } from '../stores/timersStore'
import { useShallow } from 'zustand/react/shallow'

interface CloseGuardDialogProps {
  onClose: () => void
  onSaveAndClose: () => void
  onDiscardAndClose: () => void
}

export default function CloseGuardDialog({ onClose, onSaveAndClose, onDiscardAndClose }: CloseGuardDialogProps) {
  const { t } = useTranslation()
  const activeTimers = useTimersStore(useShallow(selectActiveTimers))

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" role="presentation" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-zinc-900 rounded-xl p-6 w-full max-w-md mx-4 border border-zinc-700/50 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-guard-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="close-guard-title" className="text-lg font-semibold text-white">{t('closeGuardTitle')}</h2>
          <button type="button" onClick={onClose} aria-label={t('close')} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X size={18} />
          </button>
        </div>
        <p className="text-sm text-zinc-300 mb-6">
          {t('closeGuardMessage').replace('{count}', String(activeTimers.length))}
        </p>
        <div className="space-y-2">
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={onSaveAndClose}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Save size={16} />
            {t('closeGuardSaveAndClose')}
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={onDiscardAndClose}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 hover:text-red-300 rounded-lg text-sm font-medium transition-colors border border-red-600/30"
          >
            <Trash2 size={16} />
            {t('closeGuardDiscardAndClose')}
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={onClose}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm font-medium transition-colors"
          >
            <X size={16} />
            {t('closeGuardCancel')}
          </motion.button>
        </div>
      </motion.div>
    </div>
  )
}
