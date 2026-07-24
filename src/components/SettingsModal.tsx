import { useState } from 'react'
import pkg from '../../package.json'
import { useTranslation } from '../i18n/useTranslation'
import { motion, AnimatePresence } from 'framer-motion'
import { Settings, FileText, Bell, Target, Database } from 'lucide-react'
import GoalsTab from './SettingsTabs/GoalsTab'
import GeneralTab from './SettingsTabs/GeneralTab'
import FrontmatterTab from './SettingsTabs/FrontmatterTab'
import NotificationsTab from './SettingsTabs/NotificationsTab'
import ProfilesTab from './SettingsTabs/ProfilesTab'

type Tab = 'general' | 'frontmatter' | 'notifications' | 'goals' | 'profiles'

const TABS: { key: Tab; label: string; icon: typeof Settings }[] = [
  { key: 'goals', label: 'Target', icon: Target },
  { key: 'general', label: 'General', icon: Settings },
  { key: 'profiles', label: 'Vaults', icon: Database },
  { key: 'frontmatter', label: 'Frontmatter', icon: FileText },
  { key: 'notifications', label: 'notificationsTabLabel', icon: Bell },
]

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('goals')

  return (
    <AnimatePresence>
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-zinc-900 p-6 rounded-2xl w-[90vw] max-w-lg min-w-80 max-h-[90vh] overflow-y-auto"
      >
        <h3 className="text-xl mb-4">{t('settings')}</h3>

        <div className="flex gap-1 mb-4 border-b border-zinc-800 overflow-x-auto scrollbar-hide">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key)} className={`px-3 py-1.5 text-sm rounded-t flex flex-col items-center gap-0.5 min-w-fit shrink-0 ${tab === key ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
              <Icon size={14} />
              <span className="text-xs">{key === 'notifications' ? t('notificationsTabLabel') : label}</span>
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {tab === 'goals' && <GoalsTab />}
          {tab === 'general' && <GeneralTab />}
          {tab === 'profiles' && <ProfilesTab />}
          {tab === 'frontmatter' && <FrontmatterTab />}
          {tab === 'notifications' && <NotificationsTab />}
        </div>

        <div className="flex gap-2 mt-6">
          <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} onClick={onClose} className="flex-1 py-2 bg-zinc-800 rounded">{t('close')}</motion.button>
        </div>

        <div className="mt-4 pt-4 border-t border-zinc-800 text-xs text-zinc-500 text-center">
          <div className="flex items-center justify-center gap-1 mb-2">
            <span>mmStopWatch v{pkg.version}</span>
            <span>•</span>
            <span>by Lhefn</span>
          </div>
          <a href="https://mediamaker.cz" target="_blank" rel="noreferrer" className="hover:text-white opacity-60 hover:opacity-100" aria-label="Visit author website">
            mediamaker.cz
          </a>
        </div>
      </motion.div>
    </div>
    </AnimatePresence>
  )
}