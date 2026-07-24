import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from '../i18n/useTranslation'
import type { Session } from '../types/session'

interface PreviewModalProps {
  session: Session
  onClose: () => void
}

export default function PreviewModal({ session, onClose }: PreviewModalProps) {
  const { t } = useTranslation()

  return (
    <AnimatePresence>
      {session && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="bg-zinc-900 rounded-xl p-6 w-full max-w-lg mx-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-xs text-zinc-500 mb-1 truncate">{session.relativePath}</div>
            <div className="font-medium mb-3">{session.name}</div>
            <div className="text-sm text-zinc-300 whitespace-pre-wrap mb-4 min-h-[60px]">
              {session.preview || 'No preview'}
            </div>
            <button onClick={onClose} className="text-xs px-3 py-1 bg-zinc-800 rounded">{t('close')}</button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}