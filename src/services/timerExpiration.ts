import { useEffect, useRef } from 'react'
import { useTimersStore, type TimerInstance } from '../stores/timersStore'
import { useSessionStore } from '../stores/sessionStore'
import { open } from '@tauri-apps/plugin-dialog'
import { convertFileSrc } from '@tauri-apps/api/core'
import { t as translate, type Language } from '../i18n/translations'
import { sendOsNotification } from '../core/notificationManager'

// Track which timers already got expiration alert (per session)
const alertedTimers = new Set<string>()
const expirationListeners = new Map<string, Set<() => void>>()
let expirationInterval: number | null = null

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

function checkExpirations(): void {
  if (expirationListeners.size === 0) return

  const mdConfig = useSessionStore.getState().mdConfig
  const timers = useTimersStore.getState().timers
  const timersById = new Map(timers.map(timer => [timer.id, timer]))

  for (const [timerId, callbacks] of expirationListeners) {
    const currentTimer = timersById.get(timerId)
    if (!currentTimer || currentTimer.status !== 'RUNNING' || !currentTimer.timeEstimate) {
      alertedTimers.delete(timerId)
      continue
    }

    const now = performance.now()
    const elapsed = currentTimer.pausedOffset + Math.max(0, now - currentTimer.startTime)
    const limitMs = currentTimer.timeEstimate * 60000
    if (elapsed < limitMs || alertedTimers.has(timerId)) continue

    const alertConfig = mdConfig.timerLimitAlert
    if (!alertConfig?.enabled) continue

    alertedTimers.add(timerId)
    if (alertConfig.soundEnabled && alertConfig.soundPath) void playSound(alertConfig.soundPath)
    if (alertConfig.notificationsEnabled) void sendExpirationNotification(currentTimer.name)
    for (const callback of callbacks) callback()
  }
}

function startExpirationMonitor(): void {
  if (expirationInterval !== null) return
  expirationInterval = window.setInterval(checkExpirations, 1000)
}

function stopExpirationMonitor(): void {
  if (expirationInterval === null) return
  window.clearInterval(expirationInterval)
  expirationInterval = null
}

function subscribeToExpiration(timerId: string, callback: () => void): () => void {
  const callbacks = expirationListeners.get(timerId) || new Set<() => void>()
  callbacks.add(callback)
  expirationListeners.set(timerId, callbacks)
  startExpirationMonitor()
  return () => {
    const currentCallbacks = expirationListeners.get(timerId)
    currentCallbacks?.delete(callback)
    if (currentCallbacks?.size === 0) expirationListeners.delete(timerId)
    if (!expirationListeners.size) {
      alertedTimers.clear()
      stopExpirationMonitor()
    }
  }
}

export function useTimerExpiration(timer: TimerInstance, onExpired?: () => void) {
  const callbackRef = useRef(onExpired)
  callbackRef.current = onExpired

  useEffect(() => {
    if (timer.status !== 'RUNNING' || !timer.timeEstimate) {
      alertedTimers.delete(timer.id)
      return
    }
    return subscribeToExpiration(timer.id, () => callbackRef.current?.())
  }, [timer.id, timer.status, timer.timeEstimate])

  // Cleanup alertedTimers when timer is removed or stops
  useEffect(() => {
    if (timer.status !== 'RUNNING') alertedTimers.delete(timer.id)
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
