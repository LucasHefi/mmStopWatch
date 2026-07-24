import { useSessionStore } from '../stores/sessionStore'
import { t, type Language } from './translations'

export function useTranslation() {
  const language = useSessionStore((s) => ((s.mdConfig.language || 'cs') as Language))
  return {
    t: (key: string) => t(key, language),
    language,
  }
}
