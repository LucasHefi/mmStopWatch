import { useEffect } from 'react'
import { useTimersStore } from '../stores/timersStore'

const CHECKPOINT_INTERVAL_MS = 10_000

/** Keeps active timers recoverable across visibility changes and normal shutdown. */
export function useRecoveryLifecycle(): void {
  useEffect(() => {
    const checkpoint = () => useTimersStore.getState().checkpointAll()
    const interval = window.setInterval(checkpoint, CHECKPOINT_INTERVAL_MS)
    const onVisibilityChange = () => { if (document.visibilityState !== 'visible') checkpoint() }
    const onPageHide = () => checkpoint()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [])
}
