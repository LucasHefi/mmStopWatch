import { useState, useEffect, useRef, useCallback } from 'react'
import { useTimersStore, type TimerInstance } from '../stores/timersStore'
import { useSessionStore, selectMdConfig } from '../stores/sessionStore'
import { useTimerElapsed } from './useTimerTick'
import { useTimerExpiration, clearAlertedTimer } from '../services/timerExpiration'
import { formatTime, formatTimeShort } from '../utils/time'

const PRESETS = [15, 25, 30, 45, 60, 90, 120]

export function useTimerActions(timer: TimerInstance) {
  const { startTimer, pauseTimer, stopTimer, setTimeEstimate, removeTimer } = useTimersStore()
  const { discardTimer, setTimeEstimate: sessionSetEstimate } = useSessionStore()
  const mdConfig = useSessionStore(selectMdConfig)
  const { timer: currentTimer, elapsed: elapsedMs } = useTimerElapsed(timer.id)
  const timeRef = useRef<HTMLDivElement>(null)
  const addedTimeRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [progress, setProgress] = useState(0)
  const [showOverlay, setShowOverlay] = useState(false)
  const progressRef = useRef(progress)
  const overlayDismissedRef = useRef(false)
  useEffect(() => { progressRef.current = progress }, [progress])

  useTimerExpiration(currentTimer || timer, () => setShowOverlay(true))

  useEffect(() => {
    if (currentTimer?.status !== 'RUNNING') {
      setShowOverlay(false)
      overlayDismissedRef.current = false
    }
  }, [currentTimer?.status, timer.id])

  const notePath = timer.notePath
  const timeEstimate = currentTimer?.timeEstimate || mdConfig.timeEstimates?.[notePath] || null

  const isRunning = currentTimer?.status === 'RUNNING'

  const openEditor = useCallback(() => {
    setEditing(true)
    setEditValue(timeEstimate ? String(timeEstimate) : '')
    setTimeout(() => editInputRef.current?.focus(), 50)
  }, [timeEstimate])

  const saveEdit = useCallback(() => {
    const mins = parseInt(editValue)
    if (mins > 0 && notePath) {
      setTimeEstimate(notePath, mins)
      sessionSetEstimate(notePath, mins)
    } else if (notePath) {
      setTimeEstimate(notePath, null)
      sessionSetEstimate(notePath, null)
    }
    setEditing(false)
  }, [editValue, notePath, setTimeEstimate, sessionSetEstimate])

  const applyPreset = useCallback((mins: number) => {
    if (notePath) {
      setTimeEstimate(notePath, mins)
      sessionSetEstimate(notePath, mins)
    }
  }, [notePath, setTimeEstimate, sessionSetEstimate])

  const removeEstimateFn = useCallback(() => {
    if (notePath) {
      setTimeEstimate(notePath, null)
      sessionSetEstimate(notePath, null)
    }
  }, [notePath, setTimeEstimate, sessionSetEstimate])

  useEffect(() => {
    if (timeEstimate) {
      const newProgress = Math.min((elapsedMs / 60000 / timeEstimate) * 100, 100)
      if (Math.abs(newProgress - progressRef.current) > 0.1) {
        setProgress(newProgress)
      }
    }
  }, [elapsedMs, timeEstimate])

  useEffect(() => {
    if (timeRef.current) {
      timeRef.current.innerText = formatTime(elapsedMs)
    }
    if (addedTimeRef.current) {
      const base = (currentTimer?.baseElapsed ?? timer.baseElapsed ?? timer.elapsed) || 0
      const added = Math.max(0, elapsedMs - base)
      addedTimeRef.current.innerText = '+' + formatTimeShort(added)
    }
  }, [elapsedMs, currentTimer?.baseElapsed, timer.baseElapsed, timer.elapsed])

  const noteColor = timer.color || '#64748b'
  const realProgress = timeEstimate ? Math.min((elapsedMs / 60000 / timeEstimate) * 100, 100) : 0
  const shouldShowOverlay = showOverlay && mdConfig.timerLimitAlert?.showOverlay !== false && isRunning && realProgress >= 100
  const currentElapsedMin = timeEstimate ? (realProgress / 100) * timeEstimate : 0
  const remainingMin = timeEstimate ? Math.max(timeEstimate - currentElapsedMin, 0) : 0
  const remainingSec = Math.floor(remainingMin * 60)
  const remainingMinInt = Math.floor(remainingMin)
  const isComplete = timeEstimate ? realProgress >= 100 : false
  const isExpired = isComplete && isRunning
  const isSaving = currentTimer?.status === 'STOPPED'
  const barColor = isComplete ? 'bg-red-500' : progress > 80 ? 'bg-red-500' : progress > 50 ? 'bg-amber-500' : 'bg-emerald-500'

  const handleDiscard = useCallback(() => {
    const state = { elapsed: elapsedMs, pausedOffset: elapsedMs }
    discardTimer(timer.id, state)
    removeTimer(timer.id)
    clearAlertedTimer(timer.id)
  }, [elapsedMs, timer.id, discardTimer, removeTimer])

  const handlePlayPause = useCallback(() => {
    currentTimer?.status === 'RUNNING' ? pauseTimer(timer.id) : startTimer(timer.id)
  }, [currentTimer?.status, timer.id, pauseTimer, startTimer])

  const handleSave = useCallback(() => {
    void stopTimer(timer.id, (elapsed, notePath, operationId) => useSessionStore.getState().saveSessionToNote(elapsed, notePath, true, operationId))
      .catch(error => console.error('Failed to save timer:', error))
  }, [timer.id, stopTimer])

  return {
    currentTimer, elapsedMs, timeRef, addedTimeRef, editInputRef,
    editing, editValue, setEditValue, progress, showOverlay, setShowOverlay,
    openEditor, saveEdit, applyPreset, removeEstimate: removeEstimateFn,
    noteColor, isRunning, isSaving, realProgress, shouldShowOverlay,
    remainingMin, remainingSec, remainingMinInt, isComplete, isExpired, barColor,
    timeEstimate, PRESETS, mdConfig,
    handleDiscard, handlePlayPause, handleSave,
    setEditing,
  }
}
