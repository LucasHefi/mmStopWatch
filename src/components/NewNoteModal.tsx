import { useState } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { writeTextFile, exists } from '@tauri-apps/plugin-fs'
import { updateFrontmatter } from '../services/mdStorage'
import { motion, AnimatePresence } from 'framer-motion'
import { formatMsToTime } from '../utils/time'

export default function NewNoteModal({ onClose }: { onClose: () => void }) {
  const { mdConfig, notesFolder, refreshSessions } = useSessionStore()
  const [filename, setFilename] = useState(() => {
    const d = new Date().toISOString().slice(0,10)
    return `${d}.md`
  })
  const [initialTime, setInitialTime] = useState('')
  const [tags, setTags] = useState('')

  const create = async () => {
    if (!notesFolder) return
    const path = `${notesFolder}/${filename}`
    const key = mdConfig.frontmatterKey
    const fmt = mdConfig.timeFormat
    let timeStr = ''
    if (initialTime.trim()) {
      const val = initialTime.trim()
      let ms = 0
      if (val.includes(':')) {
        const p = val.split(':').map(Number)
        ms = ((p[0]||0)*3600 + (p[1]||0)*60 + (p[2]||0)) * 1000
      } else {
        ms = (Number(val) || 0) * 1000
      }
      timeStr = formatMsToTime(ms, fmt)
    }
    const initialContent = '---\n---\n'
    let updated = updateFrontmatter(initialContent, key, timeStr || '00:00:00')
    if (tags.trim()) {
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean)
      updated = updateFrontmatter(updated, 'tags', tagList)
    }
    let targetPath = path
    let currentFilename = filename
    while (await exists(targetPath)) {
      const newName = prompt(`File "${currentFilename}" already exists. Enter a new filename:`, currentFilename)
      if (!newName) return // cancel
      currentFilename = newName
      targetPath = `${notesFolder}/${currentFilename}`
    }
    await writeTextFile(targetPath, updated)
    await refreshSessions()
    // optionally set filter or active - minimal: just close
    onClose()
  }

  return (
    <AnimatePresence>
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-zinc-900 p-6 rounded-2xl w-96"
      >
        <h3 className="mb-4 text-lg">New Note</h3>
        <input value={filename} onChange={e => setFilename(e.target.value)} placeholder="filename.md" className="w-full mb-3 px-3 py-2 bg-zinc-950 rounded focus:ring-1 focus:ring-zinc-700 transition-all" />
        <input value={initialTime} onChange={e => setInitialTime(e.target.value)} placeholder={`initial time (${mdConfig.timeFormat})`} className="w-full mb-3 px-3 py-2 bg-zinc-950 rounded focus:ring-1 focus:ring-zinc-700 transition-all" />
        <input value={tags} onChange={e => setTags(e.target.value)} placeholder="tags (comma sep)" className="w-full mb-3 px-3 py-2 bg-zinc-950 rounded focus:ring-1 focus:ring-zinc-700 transition-all" />
        <div className="flex gap-2">
          <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} onClick={onClose} className="flex-1 py-2 bg-zinc-800 rounded">Cancel</motion.button>
          <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} onClick={create} className="flex-1 py-2 bg-white text-black rounded">Create</motion.button>
        </div>
      </motion.div>
    </div>
    </AnimatePresence>
  )
}
