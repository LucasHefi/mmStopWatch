import { useTranslation } from '../../i18n/useTranslation'

interface NickStepProps {
  nick: string
  onChange: (val: string) => void
}

export default function NickStep({ nick, onChange }: NickStepProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-medium">{t('welcomeTitle')}</h2>
      <p className="text-sm text-zinc-400">
        {t('welcomeDescription')} <code className="text-indigo-400 text-xs bg-zinc-800 px-1.5 py-0.5 rounded">.mmST-{nick || 'nick'}</code>
      </p>
      <input
        type="text"
        value={nick}
        onChange={e => onChange(e.target.value)}
        placeholder={t('nickPlaceholder')}
        className="w-full bg-zinc-950 px-4 py-3 rounded-xl text-sm focus:ring-1 focus:ring-indigo-500 transition-all"
        autoFocus
      />
      <p className="text-xs text-zinc-500">{t('nickExample')}</p>
    </div>
  )
}
