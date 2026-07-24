import { useSessionStore } from '../../stores/sessionStore'
import { useTranslation } from '../../i18n/useTranslation'
import { selectSoundFile } from '../../services/timerExpiration'
import { Bell, Clock, Music } from 'lucide-react'

export default function NotificationsTab() {
  const { t } = useTranslation()
  const { mdConfig, setMDConfig } = useSessionStore()

  const setTimerLimit = (partial: Partial<NonNullable<typeof mdConfig.timerLimitAlert>>) => {
    const current = mdConfig.timerLimitAlert || { enabled: false, soundEnabled: false, soundPath: null, notificationsEnabled: false, customMessage: '', showOverlay: true }
    setMDConfig({ timerLimitAlert: { ...current, ...partial } })
  }

  const setNotification = (partial: Partial<NonNullable<typeof mdConfig.notifications>>) => {
    const current = mdConfig.notifications || { enabled: false, intervalMinutes: 0 }
    setMDConfig({ notifications: { ...current, ...partial } })
  }

  return (
    <div className="space-y-6">
      <div className="pt-2 border-t border-zinc-800">
        <h4 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
          <Bell size={14} /> {t('timerLimitAlertsSection')}
        </h4>

        <div className="flex items-center gap-2 mb-3">
          <input type="checkbox" id="timerLimitEnabled" checked={mdConfig.timerLimitAlert?.enabled || false} onChange={e => setTimerLimit({ enabled: e.target.checked })} />
          <label htmlFor="timerLimitEnabled" className="text-sm text-zinc-400">{t('enableAlerts')}</label>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <input type="checkbox" id="timerLimitSound" checked={mdConfig.timerLimitAlert?.soundEnabled || false} disabled={!mdConfig.timerLimitAlert?.enabled} onChange={e => setTimerLimit({ soundEnabled: e.target.checked })} />
          <label htmlFor="timerLimitSound" className="text-sm text-zinc-400">{t('playSound')}</label>
        </div>

        {mdConfig.timerLimitAlert?.soundEnabled && (
          <div className="ml-6 mb-3">
            <div className="flex items-center gap-2">
              <button onClick={async () => { const file = await selectSoundFile(); if (file) setTimerLimit({ soundPath: file }) }} className="text-xs px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded flex items-center gap-1 text-zinc-400">
                <Music size={12} /> {mdConfig.timerLimitAlert?.soundPath ? t('changeSoundFile') : t('selectSoundFile')}
              </button>
              {mdConfig.timerLimitAlert?.soundPath && <span className="text-xs text-zinc-500 truncate max-w-[200px]">{mdConfig.timerLimitAlert.soundPath.split('\\').pop()}</span>}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 mb-3">
          <input type="checkbox" id="timerLimitNotif" checked={mdConfig.timerLimitAlert?.notificationsEnabled || false} disabled={!mdConfig.timerLimitAlert?.enabled} onChange={e => setTimerLimit({ notificationsEnabled: e.target.checked })} />
          <label htmlFor="timerLimitNotif" className="text-sm text-zinc-400">{t('sendNotification')}</label>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <input type="checkbox" id="timerLimitOverlay" checked={mdConfig.timerLimitAlert?.showOverlay ?? true} disabled={!mdConfig.timerLimitAlert?.enabled} onChange={e => setTimerLimit({ showOverlay: e.target.checked })} />
          <label htmlFor="timerLimitOverlay" className="text-sm text-zinc-400">{t('showOverlay')}</label>
        </div>

        <div className="ml-6">
          <label className="block text-sm text-zinc-400 mb-1">{t('customMessage')}</label>
          <input type="text" value={mdConfig.timerLimitAlert?.customMessage || ''} onChange={e => setTimerLimit({ customMessage: e.target.value })} placeholder={t('customMessagePlaceholder')} className="w-full bg-zinc-950 px-3 py-2 rounded text-sm focus:ring-1 focus:ring-zinc-700" />
        </div>
      </div>

      <div className="pt-4 border-t border-zinc-800">
        <h4 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
          <Clock size={14} /> {t('regularAlertsSection')}
        </h4>
        <div className="flex items-center gap-2 mb-2">
          <input type="checkbox" checked={mdConfig.notifications?.enabled || false} onChange={e => setNotification({ enabled: e.target.checked })} />
          <span className="text-sm text-zinc-400">{t('enableNotifications')}</span>
        </div>
        <select value={mdConfig.notifications?.intervalMinutes || 0} onChange={e => setNotification({ intervalMinutes: parseInt(e.target.value) as 0 | 5 | 10 | 15 | 30 | 60 | 120 })} className="w-full bg-zinc-950 px-3 py-2 rounded">
          <option value={0}>{t('never')}</option>
          <option value={5}>{t('every5Min')}</option>
          <option value={10}>{t('every10Min')}</option>
          <option value={15}>{t('every15Min')}</option>
          <option value={30}>{t('every30Min')}</option>
          <option value={60}>{t('everyHour')}</option>
          <option value={120}>{t('every2Hours')}</option>
        </select>
      </div>
    </div>
  )
}