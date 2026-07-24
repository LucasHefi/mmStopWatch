import { motion } from 'framer-motion'
import { useSessionStore } from '../stores/sessionStore'
import { useTranslation } from '../i18n/useTranslation'
import { Trash2, Undo2 } from 'lucide-react'
import { useEffect, useRef } from 'react'

export default function UndoToast() {
  const { recentlyDeleted, undoDelete, clearRecentlyDeleted } = useSessionStore()
  const { t } = useTranslation()
  const timerRef = useRef<number>(0)

  useEffect(() => {
    if (!recentlyDeleted) return
    const remaining = recentlyDeleted.expiresAt - Date.now()
    if (remaining <= 0) {
      clearRecentlyDeleted()
      return
    }
    timerRef.current = window.setTimeout(() => {
      clearRecentlyDeleted()
    }, remaining)
    return () => clearTimeout(timerRef.current)
  }, [recentlyDeleted, clearRecentlyDeleted])

  if (!recentlyDeleted) return null

  const remaining = Math.max(0, recentlyDeleted.expiresAt - Date.now())
  const total = 30000
  const progress = (remaining / total) * 100

  return (
    <motion.div
      initial={{ opacity: 0, y: 40, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl border border-zinc-700/50 bg-zinc-800/95 backdrop-blur-md"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Trash2 size={14} className="text-zinc-500 shrink-0" />
        <span className="text-sm text-zinc-200 font-medium truncate">
          {t('sessionDeleted')}
        </span>
      </div>
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={undoDelete}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors shrink-0"
      >
        <Undo2 size={13} />
        {t('undo')}
      </motion.button>
      <div className="w-24 h-1 bg-zinc-700 rounded-full overflow-hidden shrink-0">
        <motion.div
          className="h-full bg-emerald-500 rounded-full"
          initial={{ width: '100%' }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: remaining / 1000, ease: 'linear' }}
        />
      </div>
    </motion.div>
  )
}