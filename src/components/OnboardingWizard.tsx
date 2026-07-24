import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSessionStore } from '../stores/sessionStore'
import { useTranslation } from '../i18n/useTranslation'
import { selectNotesFolder } from '../services/mdStorage'
import { saveConfig as appSaveConfig } from '../services/appConfig'
import NickStep from './onboarding/NickStep'
import FolderStep from './onboarding/FolderStep'
import FrontmatterStep from './onboarding/FrontmatterStep'
import ConfigStep from './onboarding/ConfigStep'

const steps = ['nick', 'folder', 'frontmatter', 'config'] as const
type Step = typeof steps[number]

export default function OnboardingWizard({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation()
  const { mdConfig, setMDConfig } = useSessionStore()
  const [step, setStep] = useState<Step>('nick')
  const [nick, setNick] = useState(mdConfig.nick || '')
  const [folder, setFolder] = useState(mdConfig.notesFolder || '')
  const [vaultName, setVaultName] = useState(mdConfig.obsidianVault || '')
  const [frontmatterKey, setFrontmatterKey] = useState(mdConfig.frontmatterKey || 'Timework')
  const [timeEstimateKey, setTimeEstimateKey] = useState(mdConfig.timeEstimateKey || 'timeEstimate')
  const [statsFieldKeys, setStatsFieldKeys] = useState<string[]>(mdConfig.statsFieldKeys || ['project', 'client', 'type'])
  const [timeFormat, setTimeFormat] = useState(mdConfig.timeFormat || 'HH:mm:ss')
  const [language, setLanguage] = useState(mdConfig.language || 'cs')
  const [dailyGoal, setDailyGoal] = useState(mdConfig.dailyGoalMs ? String(mdConfig.dailyGoalMs / 60000) : '480')
  const [notifEnabled, setNotifEnabled] = useState(mdConfig.notifications?.enabled !== false)

  const stepIndex = steps.indexOf(step)

  const buildConfig = () => ({
    ...mdConfig,
    nick: nick.trim() || 'default',
    notesFolder: folder,
    obsidianVault: vaultName,
    frontmatterKey,
    timeEstimateKey,
    statsFieldKeys,
    timeFormat,
    language,
    dailyGoalMs: parseInt(dailyGoal) * 60000 || 28800000,
    autoRefreshInterval: 10,
    timerLimitAlert: {
      enabled: true,
      soundEnabled: false,
      soundPath: null,
      notificationsEnabled: true,
      customMessage: '',
      showOverlay: true,
    },
    notifications: { enabled: notifEnabled, intervalMinutes: 60 as 0 | 5 | 10 | 15 | 30 | 60 | 120 },
    onboardingComplete: true,
  })

  async function handleNext() {
    if (step === 'nick' && !nick.trim()) return
    if (step === 'folder' && !folder) return

    if (step === 'config') {
      const config = buildConfig()
      setMDConfig(config)
      await appSaveConfig(config, folder, nick.trim())
      saveConfigLegacy(config)
      onComplete()
      return
    }

    const nextIdx = stepIndex + 1
    if (nextIdx < steps.length) {
      setStep(steps[nextIdx])
    }
  }

  async function handleSelectFolder() {
    const result = await selectNotesFolder()
    if (result) {
      setFolder(result.folder)
      setVaultName(result.vaultName || result.folder.split(/[/\\]/).pop() || '')
    }
  }

  async function handleSkip() {
    const config = buildConfig()
    setMDConfig(config)
    saveConfigLegacy(config)
    if (folder && config.nick) {
      await appSaveConfig(config, folder, config.nick)
    }
    onComplete()
  }

  function saveConfigLegacy(cfg: Record<string, unknown>) {
    try {
      localStorage.setItem('mmstopwatch_md_config', JSON.stringify(cfg))
    } catch {}
  }

  const canProceed = step === 'nick' ? nick.trim().length > 0
    : step === 'folder' ? folder.length > 0
    : true

  return (
    <div className="h-screen bg-zinc-950 text-white flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-zinc-900 p-8 rounded-2xl w-[90vw] max-w-lg"
      >
        {/* Progress dots */}
        <div className="flex gap-2 mb-6 justify-center">
          {steps.map((s, i) => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i <= stepIndex ? 'bg-indigo-500 w-6' : 'bg-zinc-700 w-1.5'
              }`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {step === 'nick' && (
              <NickStep nick={nick} onChange={setNick} />
            )}

            {step === 'folder' && (
              <FolderStep folder={folder} vaultName={vaultName} onSelectFolder={handleSelectFolder} />
            )}

            {step === 'frontmatter' && (
              <FrontmatterStep
                frontmatterKey={frontmatterKey}
                timeEstimateKey={timeEstimateKey}
                statsFieldKeys={statsFieldKeys}
                onFrontmatterKeyChange={setFrontmatterKey}
                onTimeEstimateKeyChange={setTimeEstimateKey}
                onStatsFieldKeysChange={setStatsFieldKeys}
              />
            )}

            {step === 'config' && (
              <ConfigStep
                timeFormat={timeFormat}
                language={language}
                dailyGoal={dailyGoal}
                notifEnabled={notifEnabled}
                vaultName={vaultName}
                frontmatterKey={frontmatterKey}
                timeEstimateKey={timeEstimateKey}
                onTimeFormatChange={setTimeFormat}
                onLanguageChange={setLanguage}
                onDailyGoalChange={setDailyGoal}
                onNotifEnabledChange={setNotifEnabled}
              />
            )}
          </motion.div>
        </AnimatePresence>

        <div className="flex gap-2 mt-8">
          {stepIndex > 0 && (
            <button
              onClick={() => setStep(steps[stepIndex - 1])}
              className="px-4 py-2 bg-zinc-800 rounded-xl text-sm"
            >
                {t('back')}
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={handleSkip}
            className="px-4 py-2 text-zinc-500 hover:text-zinc-300 text-sm"
          >
            {t('skip')}
          </button>
          <button
            onClick={handleNext}
            disabled={!canProceed}
            className={`px-6 py-2 rounded-xl text-sm font-medium transition-all ${
              canProceed
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
            }`}
          >
            {step === 'config' ? t('finish') : t('continueStep')}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
