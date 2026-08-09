import { useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useTranslation } from '../../i18n/useTranslation'
import { languages } from '../../i18n/translations'
import { motion } from 'framer-motion'

export default function GeneralTab() {
  const { mdConfig, selectAndLoadFolder, setMDConfig, setLanguage } = useSessionStore()
  const { t } = useTranslation()
  const [nickInput, setNickInput] = useState(mdConfig.nick || '')

  const saveNick = () => setMDConfig({ ...mdConfig, nick: nickInput.trim() })
  const updateLanguage = (v: string) => { void setLanguage(v).catch(error => console.error('Failed to save language:', error)) }
  const updateAutoRefresh = (v: string) => setMDConfig({ autoRefreshInterval: parseInt(v) as 0 | 1 | 2 | 5 | 10 | 15 | 30 })

  return (
    <>
      <div>
        <label className="block text-sm mb-1">{t('nick')}</label>
        <div className="flex gap-2">
          <input
            value={nickInput}
            onChange={e => setNickInput(e.target.value)}
            placeholder="lhefn"
            className="flex-1 bg-zinc-950 px-3 py-2 rounded focus:ring-1 focus:ring-zinc-700 transition-all"
          />
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={saveNick}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-medium"
          >
            {t('save')}
          </motion.button>
        </div>
        <div className="text-xs mt-1 text-zinc-500">
          {t('folderInfo')} .mmST-{mdConfig.nick || 'nick'}
        </div>
      </div>
      <div>
        <label className="block text-sm mb-1">{t('notesFolder')}</label>
        <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} onClick={selectAndLoadFolder} className="w-full px-4 py-2 bg-zinc-800 rounded">{t('selectFolder')}</motion.button>
        <div className="text-xs mt-1 text-zinc-500 truncate">{mdConfig.notesFolder || 'None selected'}</div>
      </div>
      <div>
        <label className="block text-sm mb-1">{t('language')}</label>
        <select value={mdConfig.language || 'cs'} onChange={e => updateLanguage(e.target.value)} className="w-full bg-zinc-950 px-3 py-2 rounded focus:ring-1 focus:ring-zinc-700 transition-all">
          {languages.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm mb-1">{t('autoRefresh')}</label>
        <select
          value={mdConfig.autoRefreshInterval || 0}
          onChange={e => updateAutoRefresh(e.target.value)}
          className="w-full bg-zinc-950 px-3 py-2 rounded focus:ring-1 focus:ring-zinc-700 transition-all"
        >
          <option value={0}>{t('never')}</option>
          <option value={1}>1 {t('min')}</option>
          <option value={2}>2 {t('min')}</option>
          <option value={5}>5 {t('min')}</option>
          <option value={10}>10 {t('min')}</option>
          <option value={15}>15 {t('min')}</option>
          <option value={30}>30 {t('min')}</option>
        </select>
      </div>
    </>
  )
}