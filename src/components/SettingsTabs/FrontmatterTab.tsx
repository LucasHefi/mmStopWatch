import { useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useTranslation } from '../../i18n/useTranslation'
import { X, Plus } from 'lucide-react'
import { motion } from 'framer-motion'

export default function FrontmatterTab() {
  const { mdConfig, setMDConfig } = useSessionStore()
  const { t } = useTranslation()
  const [newField, setNewField] = useState('')

  const updateKey = (v: string) => setMDConfig({ frontmatterKey: v }, { refresh: false })
  const updateEstimateKey = (v: string) => setMDConfig({ timeEstimateKey: v }, { refresh: false })
  const updateFormat = (v: string) => setMDConfig({ timeFormat: v }, { refresh: false })
  const updateVault = (v: string) => setMDConfig({ obsidianVault: v }, { refresh: false })
  const refreshIndex = () => setMDConfig({}, { refresh: true })

  const statsFields = mdConfig.statsFieldKeys || ['project', 'client', 'type']

  const addField = () => {
    const key = newField.trim()
    if (!key || statsFields.includes(key)) return
    setMDConfig({ ...mdConfig, statsFieldKeys: [...statsFields, key] })
    setNewField('')
  }

  const removeField = (key: string) => {
    setMDConfig({ ...mdConfig, statsFieldKeys: statsFields.filter(k => k !== key) })
  }

  return (
    <>
      <div>
        <label className="block text-sm mb-1">Obsidian Vault Name</label>
        <input value={mdConfig.obsidianVault || ''} onChange={e => updateVault(e.target.value)} placeholder="YourVault" className="w-full bg-zinc-950 px-3 py-2 rounded focus:ring-1 focus:ring-zinc-700 transition-all" />
        <div className="text-xs mt-1 text-zinc-500">Used for obsidian://open links</div>
      </div>
      <div>
        <label className="block text-sm mb-1">{t('frontmatterKey')}</label>
        <input value={mdConfig.frontmatterKey} onChange={e => updateKey(e.target.value)} onBlur={refreshIndex} className="w-full bg-zinc-950 px-3 py-2 rounded focus:ring-1 focus:ring-zinc-700 transition-all" />
      </div>
      <div>
        <label className="block text-sm mb-1">{t('timeEstimateKey')}</label>
        <input value={mdConfig.timeEstimateKey || 'timeEstimate'} onChange={e => updateEstimateKey(e.target.value)} onBlur={refreshIndex} className="w-full bg-zinc-950 px-3 py-2 rounded focus:ring-1 focus:ring-zinc-700 transition-all" />
        <div className="text-xs mt-1 text-zinc-500">Frontmatter key for time estimate (minutes)</div>
      </div>
      <div>
        <label className="block text-sm mb-1">{t('timeFormat')}</label>
        <input value={mdConfig.timeFormat} onChange={e => updateFormat(e.target.value)} className="w-full bg-zinc-950 px-3 py-2 rounded focus:ring-1 focus:ring-zinc-700 transition-all" placeholder="HH:mm:ss" />
      </div>
      <div className="pt-3 border-t border-zinc-800">
        <label className="block text-sm mb-2">Stats Fields</label>
        <div className="text-xs text-zinc-500 mb-2">Frontmatter fields for stats breakdown (e.g. project, client, type)</div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {statsFields.map(key => (
            <span key={key} className="flex items-center gap-1 text-xs px-2 py-1 bg-zinc-800 rounded text-zinc-300">
              {key}
              <button type="button" aria-label={`Remove ${key}`} onClick={() => removeField(key)} className="text-zinc-500 hover:text-red-400"><X size={10} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newField}
            onChange={e => setNewField(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addField() }}
            placeholder="Add field..."
            className="flex-1 bg-zinc-950 px-3 py-1.5 rounded text-sm focus:ring-1 focus:ring-zinc-700"
          />
          <motion.button type="button" aria-label="Add field" whileTap={{ scale: 0.95 }} onClick={addField} className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400"><Plus size={14} /></motion.button>
        </div>
      </div>
    </>
  )
}
