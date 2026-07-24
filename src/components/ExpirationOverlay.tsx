import { motion, AnimatePresence } from 'framer-motion'
import { Check } from 'lucide-react'
import { useTranslation } from '../i18n/useTranslation'

interface ExpirationOverlayProps {
  visible: boolean
  onDismiss: () => void
  customMessage: string
}

export default function ExpirationOverlay({ visible, onDismiss, customMessage }: ExpirationOverlayProps) {
  const { t } = useTranslation()
  const message = (customMessage && customMessage.trim() !== '') ? customMessage : t('timeLimitReached')

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm rounded-2xl z-20"
          onClick={onDismiss}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', duration: 0.3 }}
            className="bg-zinc-900 border border-zinc-700 rounded-xl px-8 py-6 flex flex-col items-center gap-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-red-400">
              <Check size={32} />
            </div>
            <p className="text-white/90 text-sm font-medium text-center max-w-[240px]">
              {message}
            </p>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onDismiss}
              className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm text-white flex items-center gap-2 transition-colors"
            >
              <Check size={14} /> OK
            </motion.button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}