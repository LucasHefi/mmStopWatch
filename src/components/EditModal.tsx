import { useState } from 'react'
import type { Session } from '../types/session'
import { useSessionStore } from '../stores/sessionStore'
import { motion, AnimatePresence } from 'framer-motion'

function parseToMs(val: string): number {
  const t = val.trim()
  if (!t) return 0
  if (t.includes(':')) {
    const p = t.split(':').map(Number)
    return ((p[0]||0)*3600 + (p[1]||0)*60 + (p[2]||0)) * 1000
  }
  return (Number(t)||0) * 1000
}

export default function EditModal({ session, onClose }: { session: Session; onClose: () => void }) {
  const { mdConfig, updateSession } = useSessionStore()
  const fmt = mdConfig.timeFormat
  const initialStr = fmt === 'HH:mm:ss' 
    ? new Date(session.duration_ms).toISOString().substr(11,8) // rough
    : (session.duration_ms / 1000).toFixed(0)
  const [name, setName] = useState(session.name)
  const [durationStr, setDurationStr] = useState(initialStr)
  const previewMs = parseToMs(durationStr)

  const save = async () => {
    const updated: Session = {
      ...session,
      name,
      duration_ms: previewMs,
    }
    await updateSession(updated)
    onClose()
  }

  return (
    <AnimatePresence>
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-zinc-900 p-6 rounded-2xl w-80"
      >
        <h3 className="mb-4">Edit Session</h3>
        <input value={name} onChange={e => setName(e.target.value)} className="w-full mb-3 px-3 py-2 bg-zinc-950 rounded focus:ring-1 focus:ring-zinc-700 transition-all" />
        <input value={durationStr} onChange={e => setDurationStr(e.target.value)} placeholder={fmt} className="w-full mb-3 px-3 py-2 bg-zinc-950 rounded focus:ring-1 focus:ring-zinc-700 transition-all" />
        <div className="text-xs text-zinc-500 mb-3">Preview: {previewMs} ms</div>
        <div className="flex gap-2">
          <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} onClick={onClose} className="flex-1 py-2 bg-zinc-800 rounded">Cancel</motion.button>
          <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} onClick={save} className="flex-1 py-2 bg-white text-black rounded">Save</motion.button>
        </div>
      </motion.div>
    </div>
    </AnimatePresence>
  )
}
