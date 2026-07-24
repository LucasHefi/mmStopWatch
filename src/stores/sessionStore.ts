import { create } from 'zustand'
import type { Session, MDConfig, FilterOptions, DeletedSession, RecentlyDeleted } from '../types/session'
import {
  selectNotesFolder,
  loadNotesFromFolder,
  updateFrontmatter,
  parseFrontmatter,
  parseTimeToMs,
} from '../services/mdStorage'
import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { activityService } from '../services/activityService'
import { loadConfig, saveConfig as appSaveConfig, loadDeleted, saveDeleted as appSaveDeleted, defaultConfig, saveCurrentProfile, switchProfile as applyProfileConfig, createProfileFromConfig } from '../services/appConfig'
import { formatMsToTime } from '../utils/time'
import { authorizeNotesFolder } from '../services/tauriScope'
import { useTimersStore } from './timersStore'

const LEGACY_CONFIG_KEY = 'mmstopwatch_md_config'
const pendingActivityDurations = new Map<string, number>()

interface MDState {
  notesFolder: string | null
  sessions: Session[]
  mdConfig: MDConfig
  filteredSessions: Session[]
  filters: FilterOptions
  deletedSessions: DeletedSession[]
  recentlyDeleted: RecentlyDeleted | null
  undoDelete: () => Promise<void>
  clearRecentlyDeleted: () => void
  selectAndLoadFolder: () => Promise<void>
  refreshSessions: () => Promise<void>
  saveSessionToNote: (durationMs: number, notePath?: string, reset?: boolean, operationId?: string) => Promise<void>
  updateSession: (session: Session) => Promise<void>
  deleteSession: (session: Session) => Promise<void>
  setFilters: (filters: Partial<FilterOptions>) => void
  addTagToSession: (session: Session, tag: string) => Promise<void>
  discardTimer: (timerId: string, timerState: { elapsed: number; pausedOffset: number }) => void
  setMDConfig: (config: Partial<MDConfig>) => void
  togglePinNote: (notePath: string) => void
  isPinned: (notePath: string) => boolean
  setTimeEstimate: (notePath: string, minutes: number | null) => Promise<void>
  setLanguage: (lang: string) => void
  activeNote: Session | null
  openNote: (session: Session, restoreState?: { elapsed: number; pausedOffset: number }) => void
  clearActiveNote: () => void
  initializeFromConfig: () => void
  switchProfile: (profileId: string) => Promise<void>
  saveCurrentProfileAs: (name: string) => Promise<void>
  deleteProfile: (profileId: string) => Promise<void>
}

function applyFilters(sessions: Session[], filters: FilterOptions): Session[] {
  return sessions.filter(s => {
    if (filters.tags.length > 0 && !filters.tags.some(t => s.tags?.includes(t))) return false
    if (filters.search && !s.name.toLowerCase().includes(filters.search.toLowerCase())) return false
    if (filters.dateRange) {
      const [start, end] = filters.dateRange
      if (s.created_at < start || s.created_at > end) return false
    }
    return true
  })
}

export const useSessionStore = create<MDState>()(
  (set, get) => ({
  notesFolder: null,
  sessions: [],
  mdConfig: defaultConfig(),
  filteredSessions: [],
  filters: { tags: [], search: '' },
  activeNote: null,
  deletedSessions: [],
  recentlyDeleted: null,

  selectAndLoadFolder: async () => {
    const result = await selectNotesFolder()
    if (!result) return
    const folder = result.folder
    const vaultName = result.vaultName || folder.split(/[/\\]/).pop() || ''
    await authorizeNotesFolder(folder)
    let config: MDConfig = { ...get().mdConfig, notesFolder: folder, obsidianVault: vaultName }

    // Auto-create a profile if none exists
    if (!config.activeProfileId) {
      const profile = createProfileFromConfig(config, vaultName)
      config.activeProfileId = profile.id
      config.profiles = [...(config.profiles || []), profile]
    } else {
      config = await saveCurrentProfile(config)
    }

    await appSaveConfig(config, config.notesFolder, config.nick || null)
    try {
      localStorage.setItem(LEGACY_CONFIG_KEY, JSON.stringify(config))
    } catch {}
    set({ notesFolder: folder, mdConfig: config })
    await activityService.loadHistory(folder)
    await get().refreshSessions()
  },

  refreshSessions: async () => {
    const { notesFolder, mdConfig, activeNote } = get()
    if (!notesFolder) return
    let sessions = await loadNotesFromFolder(notesFolder, mdConfig.frontmatterKey, mdConfig.timeEstimateKey, mdConfig.statsFieldKeys)
    const pinned = mdConfig.pinnedNotes || []
    sessions.sort((a, b) => {
      const ap = pinned.includes(a.notePath || '')
      const bp = pinned.includes(b.notePath || '')
      if (ap && !bp) return -1
      if (!ap && bp) return 1
      return a.name.localeCompare(b.name)
    })
    const filtered = applyFilters(sessions, get().filters)
    const stillExists = activeNote && sessions.some(s => s.notePath === activeNote.notePath)
    const validPinned = pinned.filter(p => sessions.some(s => s.notePath === p))
    if (validPinned.length !== pinned.length) {
      const cfg = { ...mdConfig, pinnedNotes: validPinned }
      set({ mdConfig: cfg })
    }
    set({ sessions, filteredSessions: filtered, activeNote: stillExists ? activeNote : null })
  },

  saveSessionToNote: async (durationMs: number, notePath?: string, reset = false, operationId?: string) => {
    const { mdConfig, notesFolder } = get()
    if (!notesFolder) return

    let targetPath = notePath
    if (!targetPath) {
      const now = new Date()
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      targetPath = `${notesFolder}/${dateStr}.md`
    }

    let content: string
    try {
      content = await readTextFile(targetPath)
    } catch (error) {
      if (await exists(targetPath)) throw error
      content = ''
    }
    const { data } = parseFrontmatter(content)
    const existing = data[mdConfig.frontmatterKey]
    const existingMs = existing ? parseTimeToMs(String(existing)).ms : 0

    let totalMs = durationMs
    let activityMs = durationMs

    if (existing && !reset) {
      totalMs = existingMs + durationMs
      activityMs = durationMs
    } else if (reset) {
      totalMs = durationMs
      activityMs = Math.max(0, durationMs - existingMs)
    }

    if (operationId) {
      const pendingDuration = pendingActivityDurations.get(operationId)
      if (pendingDuration === undefined) pendingActivityDurations.set(operationId, activityMs)
      else activityMs = pendingDuration
    }

    const timeStr = formatMsToTime(totalMs, mdConfig.timeFormat)
    const updated = updateFrontmatter(content || '---\n---\n', mdConfig.frontmatterKey, timeStr)
    await writeTextFile(targetPath, updated)

    // Log activity
    const noteName = targetPath.split('/').pop()?.replace('.md', '') || 'unknown'
    await activityService.logActivity(activityMs, targetPath, noteName, notesFolder, mdConfig.nick || null, operationId)
    if (operationId) pendingActivityDurations.delete(operationId)
    // Patch locally instead of full refresh (avoids O(n) folder scan delay)
    set(state => ({
      sessions: state.sessions.map(s =>
        s.notePath === targetPath ? { ...s, duration_ms: totalMs } : s
      ),
      filteredSessions: state.filteredSessions.map(s =>
        s.notePath === targetPath ? { ...s, duration_ms: totalMs } : s
      ),
    }))
  },

  updateSession: async (session: Session) => {
    if (!session.notePath) return
    const { mdConfig } = get()
    const content = await readTextFile(session.notePath)
    const timeStr = formatMsToTime(session.duration_ms, mdConfig.timeFormat)
    const updated = updateFrontmatter(content, session.frontmatterKey || mdConfig.frontmatterKey, timeStr)
    await writeTextFile(session.notePath, updated)
    set(state => ({
      sessions: state.sessions.map(s => s.notePath === session.notePath ? { ...s, duration_ms: session.duration_ms } : s),
      filteredSessions: state.filteredSessions.map(s => s.notePath === session.notePath ? { ...s, duration_ms: session.duration_ms } : s),
    }))
  },

  deleteSession: async (session: Session) => {
    if (!session.notePath) return
    const content = await readTextFile(session.notePath)
    const { data } = parseFrontmatter(content)
    delete data[session.frontmatterKey || 'stopwatch_time']
    let yaml = '---\n'
    Object.entries(data).forEach(([k,v]) => yaml += `${k}: ${Array.isArray(v)?`[${v.join(',')}]`:v}\n`)
    yaml += '---\n'
    const rest = content.split('---\n').slice(2).join('---\n')
    await writeTextFile(session.notePath, yaml + rest)
    const now = Date.now()
    const deleted: DeletedSession = { session: { ...session }, deletedAt: now }
    set(state => ({
      sessions: state.sessions.filter(s => s.notePath !== session.notePath),
      filteredSessions: state.filteredSessions.filter(s => s.notePath !== session.notePath),
      activeNote: state.activeNote?.notePath === session.notePath ? null : state.activeNote,
      deletedSessions: [...state.deletedSessions, deleted].slice(-20),
      recentlyDeleted: { session: { ...session }, deletedAt: now, expiresAt: now + 30000 },
    }))
    const { mdConfig } = get()
    await appSaveDeleted(get().deletedSessions, mdConfig.notesFolder, mdConfig.nick || null)
  },

  undoDelete: async () => {
    const { recentlyDeleted, sessions, filteredSessions } = get()
    if (!recentlyDeleted) return
    const session = { ...recentlyDeleted.session }
    const timerState = recentlyDeleted.timerState

    // Check if session was already restored by another operation (e.g., refresh)
    const exists = sessions.some((s) => s.notePath === session.notePath)
    if (!exists) {
      set({
        sessions: [...sessions, session],
        filteredSessions: [...filteredSessions, session],
      })
    }

    set({ recentlyDeleted: null, activeNote: session })

    // Restore timer state - pass timerState to openNote which forwards to addTimer
    if (session.notePath && timerState) {
      get().openNote(session, timerState)
    }
  },

  clearRecentlyDeleted: () => {
    set({ recentlyDeleted: null })
  },

  setFilters: (newFilters) => {
    const filters = { ...get().filters, ...newFilters }
    const filtered = applyFilters(get().sessions, filters)
    set({ filters, filteredSessions: filtered })
  },

  setMDConfig: async (partial) => {
    let cfg = { ...get().mdConfig, ...partial }
    // Auto-save current profile when key fields change
    cfg = await saveCurrentProfile(cfg)
    // Save to file storage (.mmST-{nick}/config.json)
    await appSaveConfig(cfg, cfg.notesFolder, cfg.nick || null)
    // Also keep localStorage in sync for initializeFromConfig bootstrapping
    try {
      localStorage.setItem(LEGACY_CONFIG_KEY, JSON.stringify(cfg))
    } catch {}
    set({ mdConfig: cfg })
    await get().refreshSessions()
  },

  togglePinNote: async (notePath: string) => {
    const current = get().mdConfig.pinnedNotes || []
    const updated = current.includes(notePath) ? current.filter(p => p !== notePath) : [...current, notePath]
    let cfg: MDConfig = { ...get().mdConfig, pinnedNotes: updated }
    cfg = await saveCurrentProfile(cfg)
    set({ mdConfig: cfg })
    // Persist to disk
    await appSaveConfig(cfg, cfg.notesFolder, cfg.nick || null)
    const pinned = updated
    const sorted = [...get().sessions].sort((a, b) => {
      const ap = pinned.includes(a.notePath || '')
      const bp = pinned.includes(b.notePath || '')
      if (ap && !bp) return -1
      if (!ap && bp) return 1
      return a.name.localeCompare(b.name)
    })
    const filtered = applyFilters(sorted, get().filters)
    set({ mdConfig: cfg, sessions: sorted, filteredSessions: filtered })
  },

  isPinned: (notePath: string) => {
    return (get().mdConfig.pinnedNotes || []).includes(notePath)
  },

  setLanguage: (lang) => {
    const cfg = { ...get().mdConfig, language: lang }
    set({ mdConfig: cfg })
  },

  addTagToSession: async (session: Session, tag: string) => {
    if (!session.notePath) return
    const content = await readTextFile(session.notePath)
    const { data } = parseFrontmatter(content)
    const existingTags = Array.isArray(data.tags) ? data.tags : (data.tags && typeof data.tags === 'string' ? [data.tags] : [])
    const merged = Array.from(new Set([...existingTags, tag]))
    const updated = updateFrontmatter(content, 'tags', merged)
    await writeTextFile(session.notePath, updated)
    set(state => ({
      sessions: state.sessions.map(s => s.notePath === session.notePath ? { ...s, tags: merged } : s),
      filteredSessions: state.filteredSessions.map(s => s.notePath === session.notePath ? { ...s, tags: merged } : s),
    }))
  },

  discardTimer: (_timerId: string, timerState: { elapsed: number; pausedOffset: number }) => {
    // Only allow undo if there was some time measured
    if (timerState.elapsed > 1000) {
      const { recentlyDeleted, activeNote } = get()
      if (recentlyDeleted) return // Prevent multiple rapid discards
      
      const timestamp = Date.now()
      const session = activeNote || { id: '', name: '', started_at: 0, ended_at: 0, duration_ms: 0, created_at: 0, notePath: '' }
      set({
        recentlyDeleted: {
          session,
          deletedAt: timestamp,
          expiresAt: timestamp + 10000, // 10 seconds for timer discard
          timerState: {
            elapsed: timerState.elapsed,
            pausedOffset: timerState.pausedOffset, // Restore as paused
          },
        },
      })
    }
    // Note: Timer removal is handled by the component calling useTimersStore.getState().removeTimer()
  },

  openNote: (session: Session, restoreState?: { elapsed: number; pausedOffset: number }) => {
    set({ activeNote: session })
    const notePath = session.notePath
    let finalRestoreState = restoreState
    if (notePath && !restoreState) {
      const { recentlyDeleted } = get()
      const now = Date.now()
      if (recentlyDeleted && recentlyDeleted.session.notePath === notePath && recentlyDeleted.expiresAt > now && recentlyDeleted.timerState) {
        finalRestoreState = recentlyDeleted.timerState
      }
    }
    useTimersStore.getState().addTimer(session, finalRestoreState)
    if (notePath) {
      readTextFile(notePath).catch(() => '').then(content => {
        if (content) {
          const currentConfig = get().mdConfig
          const { data } = parseFrontmatter(content)
          const ek = currentConfig.timeEstimateKey || 'timeEstimate'
          const te = data[ek] != null ? Number(data[ek]) : undefined

          if (te !== undefined) {
            const timeEstimates: Record<string, number> = { ...(currentConfig.timeEstimates || {}) }
            timeEstimates[notePath] = te
            const cfg = { ...currentConfig, timeEstimates }
            set({ mdConfig: cfg })
          }
        }
      })
    }
  },

  clearActiveNote: () => {
    set({ activeNote: null })
  },

  setTimeEstimate: async (notePath: string, minutes: number | null) => {
    if (!notePath) return
    const { mdConfig } = get()
    const timeEstimates = { ...mdConfig.timeEstimates }
    if (minutes === null || minutes <= 0) {
      delete timeEstimates[notePath]
    } else {
      timeEstimates[notePath] = minutes
    }
    const cfg = { ...mdConfig, timeEstimates }
    set({ mdConfig: cfg })
    // Update the markdown file frontmatter
    try {
      const content = await readTextFile(notePath).catch(() => '')
      if (!content) return
      const ek = mdConfig.timeEstimateKey || 'timeEstimate'
      if (minutes === null || minutes <= 0) {
        // Remove timeEstimate from frontmatter
        const lines = content.split('\n')
        const newLines = lines.filter(l => !l.trim().startsWith(ek + ':'))
        const newContent = newLines.join('\n')
        await writeTextFile(notePath, newContent)
      } else {
        const updated = updateFrontmatter(content, ek, minutes)
        await writeTextFile(notePath, updated)
      }
    } catch (e) {
      console.error('Failed to save timeEstimate:', e)
    }
  },

  switchProfile: async (profileId: string) => {
    const { mdConfig } = get()
    const newConfig = await applyProfileConfig(mdConfig, profileId)
    if (newConfig === mdConfig) return

    await appSaveConfig(newConfig, newConfig.notesFolder, newConfig.nick || null)
    try {
      localStorage.setItem(LEGACY_CONFIG_KEY, JSON.stringify(newConfig))
    } catch {}

    const folder = newConfig.notesFolder
    if (folder) await authorizeNotesFolder(folder)
    set({ notesFolder: folder, mdConfig: newConfig, activeNote: null, recentlyDeleted: null })

    // Clear all active timers when switching vaults
    useTimersStore.getState().resetAll()

    if (folder) {
      await activityService.loadHistory(folder)
      const deleted = await loadDeleted(folder, newConfig.nick || null)
      set({ deletedSessions: deleted })
      await get().refreshSessions()
    } else {
      set({ sessions: [], filteredSessions: [], deletedSessions: [] })
    }
  },

  saveCurrentProfileAs: async (name: string) => {
    const { mdConfig } = get()
    const profile = createProfileFromConfig(mdConfig, name)
    const profiles = [...(mdConfig.profiles || []), profile]
    const cfg = { ...mdConfig, profiles, activeProfileId: profile.id }
    await appSaveConfig(cfg, cfg.notesFolder, cfg.nick || null)
    try {
      localStorage.setItem(LEGACY_CONFIG_KEY, JSON.stringify(cfg))
    } catch {}
    set({ mdConfig: cfg })
  },

  deleteProfile: async (profileId: string) => {
    const { mdConfig } = get()
    const profiles = (mdConfig.profiles || []).filter(p => p.id !== profileId)
    const wasActive = mdConfig.activeProfileId === profileId
    let cfg = { ...mdConfig, profiles }

    if (wasActive) {
      // Reset active profile if the active one was deleted
      cfg.activeProfileId = undefined
      if (profiles.length > 0) {
        // Switch to the next available profile
        await get().switchProfile(profiles[0].id)
        return
      }
    }

    await appSaveConfig(cfg, cfg.notesFolder, cfg.nick || null)
    try {
      localStorage.setItem(LEGACY_CONFIG_KEY, JSON.stringify(cfg))
    } catch {}
    set({ mdConfig: cfg })
  },

  initializeFromConfig: async () => {
    let config: MDConfig
    try {
      const raw = localStorage.getItem(LEGACY_CONFIG_KEY)
      config = raw ? JSON.parse(raw) : defaultConfig()
    } catch {
      config = defaultConfig()
    }

    if (config.notesFolder) {
      try {
        await authorizeNotesFolder(config.notesFolder)
      } catch (error) {
        console.error('Saved notes folder could not be authorized:', error)
        set({ mdConfig: { ...config, notesFolder: null, onboardingComplete: false }, notesFolder: null })
        return
      }
    }

    if (config.notesFolder && config.nick) {
      const fileConfig = await loadConfig(config.notesFolder, config.nick)
      config = { ...config, ...fileConfig }
    }

    if (config.activeProfileId) {
      config = await applyProfileConfig(config, config.activeProfileId)
    }

    set({ mdConfig: config })
    if (config.notesFolder) {
      set({ notesFolder: config.notesFolder })
      await activityService.loadHistory(config.notesFolder)

      const deleted = await loadDeleted(config.notesFolder, config.nick || null)
      set({ deletedSessions: deleted })

      await get().refreshSessions()
    }
  },
}))

export const selectSessions = (state: MDState) => state.sessions
export const selectFilteredSessions = (state: MDState) => state.filteredSessions
export const selectMdConfig = (state: MDState) => state.mdConfig
export const selectActiveNote = (state: MDState) => state.activeNote