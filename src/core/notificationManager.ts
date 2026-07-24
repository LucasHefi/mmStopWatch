import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { useSessionStore } from '../stores/sessionStore'
import { useTimersStore } from '../stores/timersStore'

// Map to track last notified minute for each timer by its ID
const lastNotifiedMap = new Map<string, number>()

let permissionCache: boolean | null = null

export async function sendOsNotification(title: string, body: string): Promise<void> {
  try {
    if (permissionCache === null) {
      permissionCache = await isPermissionGranted()
      if (!permissionCache) {
        const permission = await requestPermission()
        permissionCache = permission === 'granted'
      }
    }
    if (permissionCache) {
      sendNotification({ title, body, sound: 'default' })
    }
  } catch (err) {
    console.error('Failed to send notification:', err)
  }
}

export function resetPermissionCache(): void {
  permissionCache = null
}

export async function checkAndNotify() {
  const { mdConfig } = useSessionStore.getState()
  const { timers } = useTimersStore.getState()
  const notif = mdConfig.notifications

  if (!notif?.enabled || !notif.intervalMinutes) {
    return
  }

  const runningTimers = timers.filter(t => t.status === 'RUNNING')
  if (runningTimers.length === 0) {
    return
  }

  const now = performance.now()

  for (const timer of runningTimers) {
    const elapsedMs = timer.pausedOffset + (now - timer.startTime)
    const elapsedMin = Math.floor(elapsedMs / 60000)
    const lastNotifiedMin = lastNotifiedMap.get(timer.id) || 0

    if (elapsedMin > 0 && elapsedMin % notif.intervalMinutes === 0 && elapsedMin !== lastNotifiedMin) {
      await sendOsNotification('mmStopWatch', `Timer "${timer.name}" is running for ${elapsedMin} minutes.`)
      lastNotifiedMap.set(timer.id, elapsedMin)
    }
  }
}

export function resetNotificationCycle() {
  lastNotifiedMap.clear()
}

export async function sendTestNotification() {
  await sendOsNotification('mmStopWatch', 'Test notification working correctly!')
}
