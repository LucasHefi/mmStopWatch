import { useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useTranslation } from '../../i18n/useTranslation'
import { Target, Clock, Minus } from 'lucide-react'

export default function GoalsTab() {
  const { mdConfig, setMDConfig } = useSessionStore()
  const { t } = useTranslation()
  const [customGoal, setCustomGoal] = useState(mdConfig.dailyGoalMs ? String(mdConfig.dailyGoalMs / 60000) : '480')
  const [customPresetMin, setCustomPresetMin] = useState('')

  const saveGoal = () => {
    const mins = parseInt(customGoal)
    if (mins > 0) {
      setMDConfig({ dailyGoalMs: mins * 60000 })
      setTimeout(() => setCustomGoal(String(mins)), 0)
    }
  }

  const addPreset = () => {
    const mins = parseInt(customPresetMin)
    if (mins > 0) {
      const durations = mdConfig.roundTimes?.durations || [45, 60, 90, 120]
      if (!durations.includes(mins)) {
        setMDConfig({ roundTimes: { enabled: true, durations: [...durations, mins] } })
      }
    }
    setCustomPresetMin('')
  }

  const removePreset = (d: number) => {
    const durations = (mdConfig.roundTimes?.durations || [45, 60, 90, 120]).filter(x => x !== d)
    setMDConfig({ roundTimes: { enabled: true, durations } })
  }

  return (
    <>
      <div>
        <label className="block text-sm mb-2 flex items-center gap-2"><Target size={14} /> {t('dailyGoal')}</label>
        <div className="flex gap-2">
          <input type="number" value={customGoal} onChange={e => setCustomGoal(e.target.value)} className="flex-1 bg-zinc-950 px-3 py-2 rounded focus:ring-1 focus:ring-zinc-700 transition-all" />
          <span className="flex items-center text-sm text-zinc-400">min</span>
        </div>
        <button onClick={saveGoal} className="mt-2 text-xs px-3 py-1 bg-zinc-800 rounded">{t('save')}</button>
        <div className="text-xs mt-1 text-zinc-500">{mdConfig.dailyGoalMs ? `${mdConfig.dailyGoalMs / 60000} min` : 'Not set'}</div>
      </div>
      <div className="pt-4 border-t border-zinc-800">
        <label className="block text-sm mb-2 flex items-center gap-2"><Clock size={14} /> {t('timeEstimatePresets')}</label>
        <div className="flex gap-1 mb-2 flex-wrap">
          {[15, 25, 30, 45, 60, 90, 120].map(d => {
            const exists = (mdConfig.timeEstimates || {})[d] || (mdConfig.roundTimes?.durations || []).includes(d)
            return (
              <span key={d} className="text-xs px-2 py-1 bg-zinc-800 rounded flex items-center gap-1">
                {d}m
                {exists && (
                  <button onClick={() => removePreset(d)} className="text-zinc-500 hover:text-red-400"><Minus size={10} /></button>
                )}
              </span>
            )
          })}
        </div>
        <div className="flex gap-2">
          <input type="number" value={customPresetMin} onChange={e => setCustomPresetMin(e.target.value)} placeholder={t('customDuration')} className="flex-1 bg-zinc-950 px-3 py-2 rounded text-sm" />
          <button onClick={addPreset} className="text-xs px-3 py-2 bg-zinc-800 rounded">+</button>
        </div>
      </div>
    </>
  )
}