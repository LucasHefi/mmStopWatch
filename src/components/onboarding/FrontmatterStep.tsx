import { useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import { X, Plus } from 'lucide-react'
import { motion } from 'framer-motion'

interface FrontmatterStepProps {
  frontmatterKey: string
  timeEstimateKey: string
  statsFieldKeys: string[]
  onFrontmatterKeyChange: (val: string) => void
  onTimeEstimateKeyChange: (val: string) => void
  onStatsFieldKeysChange: (val: string[]) => void
}

export default function FrontmatterStep({
  frontmatterKey,
  timeEstimateKey,
  statsFieldKeys,
  onFrontmatterKeyChange,
  onTimeEstimateKeyChange,
  onStatsFieldKeysChange,
}: FrontmatterStepProps) {
  const { t } = useTranslation()
  const [newField, setNewField] = useState('')

  const addField = () => {
    const key = newField.trim().toLowerCase()
    if (!key || statsFieldKeys.includes(key)) return
    onStatsFieldKeysChange([...statsFieldKeys, key])
    setNewField('')
  }

  const removeField = (key: string) => {
    onStatsFieldKeysChange(statsFieldKeys.filter(k => k !== key))
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-medium">{t('configTitle')}</h2>
      <p className="text-sm text-zinc-400">{t('configDescription')}</p>

      <div>
        <label className="block text-sm text-zinc-400 mb-1">{t('frontmatterTimeKey')}</label>
        <input
          type="text"
          value={frontmatterKey}
          onChange={e => onFrontmatterKeyChange(e.target.value)}
          className="w-full bg-zinc-950 px-3 py-2 rounded text-sm"
        />
      </div>

      <div>
        <label className="block text-sm text-zinc-400 mb-1">{t('timeEstimateKey')}</label>
        <input
          type="text"
          value={timeEstimateKey}
          onChange={e => onTimeEstimateKeyChange(e.target.value)}
          className="w-full bg-zinc-950 px-3 py-2 rounded text-sm"
        />
      </div>

      <div className="pt-3 border-t border-zinc-800">
        <label className="block text-sm text-zinc-400 mb-1">{t('frontmatterStatsKey')}</label>
        <div className="text-xs text-zinc-500 mb-2">Frontmatter fields for stats breakdown (e.g. project, client, type)</div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {statsFieldKeys.map(key => (
            <span key={key} className="flex items-center gap-1 text-xs px-2 py-1 bg-zinc-800 rounded text-zinc-300">
              {key}
              <button onClick={() => removeField(key)} className="text-zinc-500 hover:text-red-400"><X size={10} /></button>
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
          <motion.button whileTap={{ scale: 0.95 }} onClick={addField} className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400"><Plus size={14} /></motion.button>
        </div>
      </div>
    </div>
  )
}
