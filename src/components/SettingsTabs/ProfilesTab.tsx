import { useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useTranslation } from '../../i18n/useTranslation'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Trash2, Plus, SwitchCamera } from 'lucide-react'

export default function ProfilesTab() {
  const { t } = useTranslation()
  const { mdConfig, switchProfile, saveCurrentProfileAs, deleteProfile } = useSessionStore()
  const profiles = mdConfig.profiles || []
  const activeId = mdConfig.activeProfileId
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const handleAdd = async () => {
    if (!name.trim()) return
    await saveCurrentProfileAs(name.trim())
    setName('')
    setAdding(false)
  }

  const handleDelete = async (profileId: string) => {
    await deleteProfile(profileId)
    setConfirmDelete(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm">{t('vaultProfiles')}</label>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setAdding(true)}
          className="text-xs px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded flex items-center gap-1 text-zinc-300"
        >
          <Plus size={12} /> {t('saveCurrentAsProfile')}
        </motion.button>
      </div>

      <AnimatePresence>
        {adding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex gap-2 items-center"
          >
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false) }}
              placeholder={t('profileNamePlaceholder')}
              className="flex-1 bg-zinc-950 px-3 py-2 rounded text-sm focus:ring-1 focus:ring-zinc-700"
              autoFocus
            />
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleAdd}
              className="p-2 bg-emerald-600 hover:bg-emerald-500 rounded text-white"
            >
              <Check size={14} />
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => { setAdding(false); setName('') }}
              className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400"
            >
              <Trash2 size={14} />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {profiles.length === 0 ? (
        <div className="text-sm text-zinc-600 py-4 text-center">{t('noProfiles')}</div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {profiles.map(profile => {
            const isActive = profile.id === activeId
            return (
              <motion.div
                key={profile.id}
                layout
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className={`p-3 rounded-xl border text-sm ${isActive ? 'border-indigo-500/40 bg-indigo-500/10' : 'border-zinc-800 bg-zinc-900/60'}`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate">{profile.name}</span>
                    {isActive && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-indigo-500/20 text-indigo-400 rounded">{t('activeProfile')}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!isActive && (
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => switchProfile(profile.id)}
                        className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400 hover:text-white"
                        title={t('switchToProfile')}
                      >
                        <SwitchCamera size={14} />
                      </motion.button>
                    )}
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setConfirmDelete(profile.id)}
                      className="p-1.5 bg-zinc-800 hover:bg-red-900/30 rounded text-zinc-500 hover:text-red-400"
                      title={t('deleteProfile')}
                    >
                      <Trash2 size={14} />
                    </motion.button>
                  </div>
                </div>
                <div className="text-[11px] text-zinc-500 space-y-0.5">
                  <div className="truncate">{profile.notesFolder || '—'}</div>
                  <div className="flex gap-2">
                    <span>nick: {profile.nick || '—'}</span>
                    <span>key: {profile.frontmatterKey}</span>
                    <span>fmt: {profile.timeFormat}</span>
                  </div>
                </div>

                <AnimatePresence>
                  {confirmDelete === profile.id && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-2 pt-2 border-t border-zinc-800 flex items-center gap-2"
                    >
                      <span className="text-xs text-red-400">{t('confirmDeleteProfile').replace('{name}', profile.name)}</span>
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => handleDelete(profile.id)}
                        className="text-xs px-2 py-1 bg-red-600 hover:bg-red-500 rounded text-white"
                      >
                        {t('delete')}
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setConfirmDelete(null)}
                        className="text-xs px-2 py-1 bg-zinc-800 rounded text-zinc-400"
                      >
                        {t('cancel')}
                      </motion.button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
