import { useTranslation } from '../../i18n/useTranslation'

interface FolderStepProps {
  folder: string
  vaultName: string
  onSelectFolder: () => void
}

export default function FolderStep({ folder, vaultName, onSelectFolder }: FolderStepProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-medium">{t('folderTitle')}</h2>
      <p className="text-sm text-zinc-400">
        {t('folderDescription')}
      </p>
      <button
        onClick={onSelectFolder}
        className="w-full px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm transition-all"
      >
        {folder ? t('changeFolder') : t('selectFolder')}
      </button>
      {folder && (
        <>
          <div className="text-xs text-zinc-500 truncate bg-zinc-950 rounded-lg px-3 py-2">
            {folder}
          </div>
          <div className="text-xs text-zinc-400 bg-zinc-950 rounded-lg px-3 py-2 flex items-center gap-2">
            <span>{t('obsidianVault')}: </span>
            <span className="text-zinc-300 font-mono">{vaultName || '—'}</span>
            {vaultName && !vaultName.includes('/') && !vaultName.includes('\\') && (
              <span className="text-emerald-400 text-[10px] px-1.5 py-0.5 rounded bg-emerald-400/10">{t('autoDetected')}</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
