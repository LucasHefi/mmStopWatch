import { useEffect, useRef } from 'react'
import { useTimersStore, type TimerInstance } from '../stores/timersStore'
import { useSessionStore } from '../stores/sessionStore'
import { open } from '@tauri-apps/plugin-dialog'
import { convertFileSrc } from '@tauri-apps/api/core'
import { t as translate, type Language } from '../i18n/translations'
import { sendOsNotification } from '../core/notificationManager'

// Track which timers already got expiration alert (per session)
const alertedTimers = new Set<string>()

let audioElement: HTMLAudioElement | null = null

function getAudioElement(): HTMLAudioElement {
  if (!audioElement) {
    audioElement = new Audio()
    audioElement.preload = 'auto'
  }
  return audioElement
}

export function clearAlertedTimer(timerId: string): void {
  alertedTimers.delete(timerId)
}

export function clearAllAlertedTimers(): void {
  alertedTimers.clear()
}

export function cleanupAudio(): void {
  if (audioElement) {
    audioElement.pause()
    audioElement.src = ''
    audioElement = null
  }
}

async function playSound(soundPath: string) {
  try {
    const audio = getAudioElement()
    const src = soundPath.startsWith('http') ? soundPath : convertFileSrc(soundPath)
    audio.src = src
    audio.loop = false
    await audio.play()
  } catch (err) {
    console.error('Failed to play timer expiration sound:', err)
  }
}

function getLanguage(): Language {
  return (useSessionStore.getState().mdConfig.language || 'cs') as Language
}

async function sendExpirationNotification(timerName: string) {
  const lang = getLanguage()
  await sendOsNotification('mmStopWatch', translate('limitExpired', lang).replace('{name}', timerName))
}

export function useTimerExpiration(timer: TimerInstance, onExpired?: () => void) {
  const hasAlertedRef = useRef(false)
  const configRef = useRef(useSessionStore.getState().mdConfig)

  useEffect(() => {
    const unsub = useSessionStore.subscribe((state) => {
      configRef.current = state.mdConfig
    })
    configRef.current = useSessionStore.getState().mdConfig
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!timer.timeEstimate || timer.status !== 'RUNNING') return

    const checkExpiration = () => {
      const currentTimer = useTimersStore.getState().timers.find(t => t.id === timer.id)
      if (!currentTimer) return

      const now = performance.now()
      const elapsed = currentTimer.pausedOffset + (currentTimer.status === 'RUNNING' ? now - currentTimer.startTime : 0)
      const limitMs = currentTimer.timeEstimate! * 60000
      const config = configRef.current

      // Check if limit exceeded
      if (elapsed >= limitMs && !hasAlertedRef.current) {
        const alertConfig = config.timerLimitAlert
        if (alertConfig?.enabled) {
          hasAlertedRef.current = true
          alertedTimers.add(timer.id)

          // Play sound if enabled
          if (alertConfig.soundEnabled && alertConfig.soundPath) {
            playSound(alertConfig.soundPath)
          }

          // Send notification if enabled
          if (alertConfig.notificationsEnabled) {
            sendExpirationNotification(currentTimer.name)
          }

          // Trigger overlay callback
          if (onExpired) {
            onExpired()
          }
        }
      }

      // Reset alert flag when timer stops/pauses
      if (currentTimer.status !== 'RUNNING') {
        hasAlertedRef.current = false
      }
    }

    const interval = setInterval(checkExpiration, 1000)
    return () => clearInterval(interval)
  }, [timer.id, timer.timeEstimate, timer.status])

  // Cleanup alertedTimers when timer is removed or stops
  useEffect(() => {
    if (timer.status !== 'RUNNING' && !timer.timeEstimate) {
      alertedTimers.delete(timer.id)
    }
  }, [timer.id, timer.status, timer.timeEstimate])
}

export async function selectSoundFile(): Promise<string | null> {
  try {
    const lang = getLanguage()
    const selected = await open({
      title: translate('selectSoundFileTitle', lang),
      filters: [{
        name: 'Audio',
        extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac'],
      }],
    })
    return selected
  } catch (err) {
    console.error('Failed to select sound file:', err)
    return null
  }
}