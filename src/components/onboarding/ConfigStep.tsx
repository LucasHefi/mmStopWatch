import { useTranslation } from '../../i18n/useTranslation'
import { languages } from '../../i18n/translations'

interface ConfigStepProps {
  timeFormat: string
  language: string
  dailyGoal: string
  notifEnabled: boolean
  vaultName: string
  frontmatterKey: string
  timeEstimateKey: string
  onTimeFormatChange: (val: string) => void
  onLanguageChange: (val: string) => void
  onDailyGoalChange: (val: string) => void
  onNotifEnabledChange: (val: boolean) => void
}

export default function ConfigStep({
  timeFormat, language, dailyGoal, notifEnabled, vaultName, frontmatterKey, timeEstimateKey,
  onTimeFormatChange, onLanguageChange, onDailyGoalChange, onNotifEnabledChange,
}: ConfigStepProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-medium">{t('configTitle')}</h2>
      <p className="text-sm text-zinc-400">
        {t('configDescription')}
      </p>

      <div>
        <label className="block text-sm text-zinc-400 mb-1">{t('timeFormat')}</label>
        <input
          type="text"
          value={timeFormat}
          onChange={e => onTimeFormatChange(e.target.value)}
          className="w-full bg-zinc-950 px-3 py-2 rounded text-sm"
        />
      </div>
      <div>
        <label className="block text-sm text-zinc-400 mb-1">{t('language')}</label>
        <select
          value={language}
          onChange={e => onLanguageChange(e.target.value)}
          className="w-full bg-zinc-950 px-3 py-2 rounded text-sm"
        >
          {languages.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm text-zinc-400 mb-1">{t('dailyGoalMinutes')}</label>
        <input
          type="number"
          value={dailyGoal}
          onChange={e => onDailyGoalChange(e.target.value)}
          className="w-full bg-zinc-950 px-3 py-2 rounded text-sm"
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="wizardNotif"
          checked={notifEnabled}
          onChange={e => onNotifEnabledChange(e.target.checked)}
        />
        <label htmlFor="wizardNotif" className="text-sm text-zinc-400">{t('enableHourlyNotification')}</label>
      </div>
      <div className="text-xs text-zinc-500 bg-zinc-950 rounded-lg px-3 py-2 space-y-1">
        <div>{t('obsidianVault')} <span className="text-zinc-300">{vaultName || '—'}</span></div>
        <div>{t('autoRefresh')}: <span className="text-zinc-300">10 {t('min')}</span></div>
        <div>{t('limitAlert')} <span className="text-zinc-300">{t('enableAlerts')} ({t('playSound')}, {t('sendNotification')}, {t('showOverlay')})</span></div>
        <div>{t('frontmatterKey')}: <span className="text-zinc-300">{frontmatterKey}</span></div>
        <div>{t('timeEstimateKey')}: <span className="text-zinc-300">{timeEstimateKey}</span></div>
      </div>
    </div>
  )
}
