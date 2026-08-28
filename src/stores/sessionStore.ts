import { create } from 'zustand'
import type { Session, MDConfig, FilterOptions, DeletedSession, RecentlyDeleted } from '../types/session'
import {
  selectNotesFolder,
  updateFrontmatter,
  removeFrontmatterKey,
  parseFrontmatter,
  parseTimeToMs,
} from '../services/mdStorage'
import { exists, readTextFile } from '@tauri-apps/plugin-fs'
import { activityService } from '../services/activityService'
import { loadConfig, saveConfig as appSaveConfig, loadDeleted, saveDeleted as appSaveDeleted, defaultConfig, normalizeConfig, saveCurrentProfile, switchProfile as applyProfileConfig, createProfileFromConfig } from '../services/appConfig'
import { formatMsToTime } from '../utils/time'
import { authorizeNotesFolder } from '../services/tauriScope'
import { useTimersStore } from './timersStore'
import { readFileSnapshot, snapshotFromContent, writeTextFileAtomically, FileConflictError } from '../services/safeFileWriter'
import { beginOperation, completeOperation, failOperation } from '../services/operationJournal'
import { resolveVaultMarkdownPath } from '../services/pathSecurity'
import { noteIndex } from '../services/noteIndex'

const LEGACY_CONFIG_KEY = 'mmstopwatch_md_config'
const pendingActivityDurations = new Map<string, number>()
let refreshGeneration = 0
let configWriteQueue: Promise<void> = Promise.resolve()

interface MDState {
  notesFolder: string | null
  sessions: Session[]
  mdConfig: MDConfig
  filteredSessions: Session[]
  notesLoading: boolean
  notesError: string | null
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
  setMDConfig: (config: Partial<MDConfig>, options?: { refresh?: boolean }) => Promise<void>
  togglePinNote: (notePath: string) => void
  isPinned: (notePath: string) => boolean
  setTimeEstimate: (notePath: string, minutes: number | null) => Promise<void>
  setLanguage: (lang: string) => Promise<void>
  activeNote: Session | null
  openNote: (session: Session, restoreState?: { elapsed: number; pausedOffset: number }) => void
  clearActiveNote: () => void
  initializeFromConfig: () => Promise<void>
  switchProfile: (profileId: string) => Promise<void>
  saveCurrentProfileAs: (name: string) => Promise<void>
  deleteProfile: (profileId: string) => Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
  notesLoading: false,
  notesError: null,
  filters: { tags: [], search: '' },
  activeNote: null,
  deletedSessions: [],
  recentlyDeleted: null,

  selectAndLoadFolder: async () => {
    const result = await selectNotesFolder()
    if (!result) return
    const folder = result.folder
    const vaultName = result.vaultName || folder.split(/[/\\]/).pop() || ''
    await authorizeNotesFolder(folder, get().mdConfig.nick || null)
    let config: MDConfig = { ...get().mdConfig, notesFolder: folder, obsidianVault: vaultName }

    if (!config.activeProfileId) {
      const profile = createProfileFromConfig(config, vaultName)
      config.activeProfileId = profile.id
      config.profiles = [...(config.profiles || []), profile]
    } else {
      config = await saveCurrentProfile(config)
    }

    await appSaveConfig(config, config.notesFolder, config.nick || null)
    try { localStorage.setItem(LEGACY_CONFIG_KEY, JSON.stringify(config)) } catch {}
    set({ notesFolder: folder, mdConfig: config })
    await activityService.loadHistory(folder)
    await get().refreshSessions()
  },

  refreshSessions: async () => {
    const request = ++refreshGeneration
    const { notesFolder, mdConfig, activeNote } = get()
    if (!notesFolder) {
      set({ sessions: [], filteredSessions: [], notesLoading: false, notesError: null, activeNote: null })
      return
    }
    set({ notesLoading: true, notesError: null })
    try {
      const sessions = await noteIndex.load({ folder: notesFolder, frontmatterKey: mdConfig.frontmatterKey, timeEstimateKey: mdConfig.timeEstimateKey, statsFieldKeys: mdConfig.statsFieldKeys })
      if (request !== refreshGeneration) return
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
      if (validPinned.length !== pinned.length) set({ mdConfig: { ...mdConfig, pinnedNotes: validPinned } })
      set({ sessions, filteredSessions: filtered, notesLoading: false, notesError: null, activeNote: stillExists ? activeNote : null })
    } catch (error) {
      console.error('Failed to load notes:', error)
      set({ notesLoading: false, notesError: errorMessage(error) })
    }
  },

  saveSessionToNote: async (durationMs: number, notePath?: string, reset = false, operationId?: string) => {
    const { mdConfig, notesFolder } = get()
    if (!notesFolder) return
    let targetPath = notePath
    if (!targetPath) {
      const now = new Date()
      targetPath = notesFolder + '/' + now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') + '.md'
    }
    if (notePath) targetPath = resolveVaultMarkdownPath(notesFolder, notePath)
    const operation = beginOperation('note.save', targetPath, operationId)
    if (operation.status === 'committed') return

    let content: string
    try { content = await readTextFile(targetPath) } catch (error) {
      if (await exists(targetPath)) throw error
      content = ''
    }
    const { data } = parseFrontmatter(content)
    const existing = data[mdConfig.frontmatterKey]
    const existingMs = existing ? parseTimeToMs(String(existing)).ms : 0
    let totalMs = durationMs
    let activityMs = durationMs
    if (existing && !reset) { totalMs = existingMs + durationMs } else if (reset) { activityMs = Math.max(0, durationMs - existingMs) }

    if (operationId) {
      const pendingDuration = pendingActivityDurations.get(operationId)
      if (pendingDuration === undefined) pendingActivityDurations.set(operationId, activityMs)
      else activityMs = pendingDuration
    }

    const updated = updateFrontmatter(content || '---\n---\n', mdConfig.frontmatterKey, formatMsToTime(totalMs, mdConfig.timeFormat))
    try {
      await writeTextFileAtomically(targetPath, updated, content ? snapshotFromContent(targetPath, content) : null)
    } catch (error) {
      failOperation(operation.id, error, error instanceof FileConflictError ? 'conflict' : 'failed')
      throw error
    }
    const noteName = targetPath.split(/[/\\]/).pop()?.replace('.md', '') || 'unknown'
    try {
      await activityService.logActivity(activityMs, targetPath, noteName, notesFolder, mdConfig.nick || null, operationId)
      completeOperation(operation.id)
    } catch (error) {
      failOperation(operation.id, error)
      throw error
    }
    if (operationId) pendingActivityDurations.delete(operationId)
    set(state => ({
      sessions: state.sessions.map(s => s.notePath === targetPath ? { ...s, duration_ms: totalMs } : s),
      filteredSessions: state.filteredSessions.map(s => s.notePath === targetPath ? { ...s, duration_ms: totalMs } : s),
    }))
  },

  updateSession: async (session: Session) => {
    if (!session.notePath) return
    const { mdConfig } = get()
    const safePath = resolveVaultMarkdownPath(get().notesFolder || '', session.notePath)
    const content = await readTextFile(safePath)
    const before = await readFileSnapshot(safePath)
    const updated = updateFrontmatter(content, session.frontmatterKey || mdConfig.frontmatterKey, formatMsToTime(session.duration_ms, mdConfig.timeFormat))
    await writeTextFileAtomically(safePath, updated, before)
    set(state => ({
      sessions: state.sessions.map(s => s.notePath === session.notePath ? { ...s, duration_ms: session.duration_ms } : s),
      filteredSessions: state.filteredSessions.map(s => s.notePath === session.notePath ? { ...s, duration_ms: session.duration_ms } : s),
    }))
  },

  deleteSession: async (session: Session) => {
    if (!session.notePath) return
    const { mdConfig } = get()
    const safePath = resolveVaultMarkdownPath(get().notesFolder || '', session.notePath)
    const content = await readTextFile(safePath)
    const before = await readFileSnapshot(safePath)
    const updated = removeFrontmatterKey(content, session.frontmatterKey || mdConfig.frontmatterKey)
    await writeTextFileAtomically(safePath, updated, before)
    const now = Date.now()
    const deleted: DeletedSession = { session: { ...session }, deletedAt: now }
    set(state => ({
      sessions: state.sessions.filter(s => s.notePath !== session.notePath),
      filteredSessions: state.filteredSessions.filter(s => s.notePath !== session.notePath),
      activeNote: state.activeNote?.notePath === session.notePath ? null : state.activeNote,
      deletedSessions: [...state.deletedSessions, deleted].slice(-20),
      recentlyDeleted: { session: { ...session }, deletedAt: now, expiresAt: now + 30000 },
    }))
    await appSaveDeleted(get().deletedSessions, mdConfig.notesFolder, mdConfig.nick || null)
  },

  undoDelete: async () => {
    const { recentlyDeleted, sessions, filteredSessions } = get()
    if (!recentlyDeleted) return
    const session = { ...recentlyDeleted.session }
    const timerState = recentlyDeleted.timerState
    if (!sessions.some(item => item.notePath === session.notePath)) {
      set({ sessions: [...sessions, session], filteredSessions: [...filteredSessions, session] })
    }
    set({ recentlyDeleted: null, activeNote: session })
    if (session.notePath && timerState) get().openNote(session, timerState)
  },

  clearRecentlyDeleted: () => set({ recentlyDeleted: null }),

  setFilters: newFilters => {
    const filters = { ...get().filters, ...newFilters }
    set({ filters, filteredSessions: applyFilters(get().sessions, filters) })
  },

  setMDConfig: async (partial, options) => {
    const operation = configWriteQueue.catch(() => undefined).then(async () => {
      const previousConfig = get().mdConfig
      const normalized = normalizeConfig({ ...previousConfig, ...partial })
      const cfg = await saveCurrentProfile(normalized)
      const previousFolder = get().notesFolder
      const profileChanged = cfg.nick !== previousConfig.nick
      if (cfg.notesFolder && (cfg.notesFolder !== previousFolder || profileChanged)) {
        await authorizeNotesFolder(cfg.notesFolder, cfg.nick || null)
      }
      await appSaveConfig(cfg, cfg.notesFolder, cfg.nick || null)
      try { localStorage.setItem(LEGACY_CONFIG_KEY, JSON.stringify(cfg)) } catch {}
      set({ mdConfig: cfg, notesFolder: cfg.notesFolder })
      const indexSettingsChanged = previousConfig.notesFolder !== cfg.notesFolder
        || previousConfig.frontmatterKey !== cfg.frontmatterKey
        || previousConfig.timeEstimateKey !== cfg.timeEstimateKey
        || JSON.stringify(previousConfig.statsFieldKeys || []) !== JSON.stringify(cfg.statsFieldKeys || [])
      if (options?.refresh !== false && (options?.refresh === true || indexSettingsChanged)) await get().refreshSessions()
    })
    configWriteQueue = operation
    await operation
  },

  togglePinNote: async notePath => {
    const current = get().mdConfig.pinnedNotes || []
    const updated = current.includes(notePath) ? current.filter(path => path !== notePath) : [...current, notePath]
    let cfg = await saveCurrentProfile({ ...get().mdConfig, pinnedNotes: updated })
    await appSaveConfig(cfg, cfg.notesFolder, cfg.nick || null)
    const sorted = [...get().sessions].sort((a, b) => (updated.includes(b.notePath || '') ? 1 : 0) - (updated.includes(a.notePath || '') ? 1 : 0) || a.name.localeCompare(b.name))
    set({ mdConfig: cfg, sessions: sorted, filteredSessions: applyFilters(sorted, get().filters) })
  },

  isPinned: notePath => (get().mdConfig.pinnedNotes || []).includes(notePath),

  setLanguage: async lang => {
    const cfg = { ...get().mdConfig, language: lang }
    await appSaveConfig(cfg, cfg.notesFolder, cfg.nick || null)
    try { localStorage.setItem(LEGACY_CONFIG_KEY, JSON.stringify(cfg)) } catch (error) { console.error('Failed to persist language fallback:', error) }
    set({ mdConfig: cfg })
  },

  addTagToSession: async (session, tag) => {
    if (!session.notePath) return
    const safePath = resolveVaultMarkdownPath(get().notesFolder || '', session.notePath)
    const content = await readTextFile(safePath)
    const before = await readFileSnapshot(safePath)
    const { data } = parseFrontmatter(content)
    const existingTags = Array.isArray(data.tags) ? data.tags : (data.tags && typeof data.tags === 'string' ? [data.tags] : [])
    const merged = Array.from(new Set([...existingTags, tag]))
    await writeTextFileAtomically(safePath, updateFrontmatter(content, 'tags', merged), before)
    set(state => ({
      sessions: state.sessions.map(s => s.notePath === session.notePath ? { ...s, tags: merged } : s),
      filteredSessions: state.filteredSessions.map(s => s.notePath === session.notePath ? { ...s, tags: merged } : s),
    }))
  },

  discardTimer: (_timerId, timerState) => {
    if (timerState.elapsed <= 1000) return
    const { recentlyDeleted, activeNote } = get()
    if (recentlyDeleted) return
    const timestamp = Date.now()
    set({ recentlyDeleted: {
      session: activeNote || { id: '', name: '', started_at: 0, ended_at: 0, duration_ms: 0, created_at: 0, notePath: '' },
      deletedAt: timestamp,
      expiresAt: timestamp + 10000,
      timerState: { elapsed: timerState.elapsed, pausedOffset: timerState.pausedOffset },
    } })
  },

  openNote: (session, restoreState) => {
    set({ activeNote: session })
    let notePath: string | undefined
    if (session.notePath) {
      try { notePath = resolveVaultMarkdownPath(get().notesFolder || '', session.notePath) } catch { notePath = undefined }
    }
    let finalRestoreState = restoreState
    if (notePath && !restoreState) {
      const { recentlyDeleted } = get()
      const now = Date.now()
      if (recentlyDeleted?.session.notePath === notePath && recentlyDeleted.expiresAt > now && recentlyDeleted.timerState) finalRestoreState = recentlyDeleted.timerState
    }
    useTimersStore.getState().addTimer(session, finalRestoreState)
    if (notePath) {
      readTextFile(notePath).catch(() => '').then(content => {
        if (!content) return
        const currentConfig = get().mdConfig
        const { data } = parseFrontmatter(content)
        const key = currentConfig.timeEstimateKey || 'timeEstimate'
        const estimate = data[key] != null ? Number(data[key]) : undefined
        if (estimate !== undefined) set({ mdConfig: { ...currentConfig, timeEstimates: { ...(currentConfig.timeEstimates || {}), [notePath]: estimate } } })
      })
    }
  },

  clearActiveNote: () => set({ activeNote: null }),

  setTimeEstimate: async (notePath, minutes) => {
    if (!notePath) return
    const { mdConfig } = get()
    const safePath = resolveVaultMarkdownPath(get().notesFolder || '', notePath)
    const timeEstimates = { ...mdConfig.timeEstimates }
    if (minutes === null || minutes <= 0) delete timeEstimates[notePath]
    else timeEstimates[notePath] = minutes
    set({ mdConfig: { ...mdConfig, timeEstimates } })
    try {
      const content = await readTextFile(safePath).catch(() => '')
      if (!content) return
      const before = await readFileSnapshot(safePath)
      const key = mdConfig.timeEstimateKey || 'timeEstimate'
      if (minutes === null || minutes <= 0) {
        const newContent = removeFrontmatterKey(content, key)
        await writeTextFileAtomically(safePath, newContent, before)
      } else {
        await writeTextFileAtomically(safePath, updateFrontmatter(content, key, minutes), before)
      }
    } catch (error) {
      console.error('Failed to save timeEstimate:', error)
    }
  },

  switchProfile: async profileId => {
    const { mdConfig } = get()
    const newConfig = await applyProfileConfig(mdConfig, profileId)
    if (newConfig === mdConfig) return
    await appSaveConfig(newConfig, newConfig.notesFolder, newConfig.nick || null)
    try { localStorage.setItem(LEGACY_CONFIG_KEY, JSON.stringify(newConfig)) } catch {}
    const folder = newConfig.notesFolder
    if (folder) await authorizeNotesFolder(folder, newConfig.nick || null)
    set({ notesFolder: folder, mdConfig: newConfig, activeNote: null, recentlyDeleted: null })
    useTimersStore.getState().resetAll()
    if (folder) {
      await activityService.loadHistory(folder)
      set({ deletedSessions: await loadDeleted(folder, newConfig.nick || null) })
      await get().refreshSessions()
    } else {
      set({ sessions: [], filteredSessions: [], deletedSessions: [] })
    }
  },

  saveCurrentProfileAs: async name => {
    const { mdConfig } = get()
    const profile = createProfileFromConfig(mdConfig, name)
    const cfg = { ...mdConfig, profiles: [...(mdConfig.profiles || []), profile], activeProfileId: profile.id }
    await appSaveConfig(cfg, cfg.notesFolder, cfg.nick || null)
    try { localStorage.setItem(LEGACY_CONFIG_KEY, JSON.stringify(cfg)) } catch {}
    set({ mdConfig: cfg })
  },

  deleteProfile: async profileId => {
    const { mdConfig } = get()
    const profiles = (mdConfig.profiles || []).filter(profile => profile.id !== profileId)
    let cfg = { ...mdConfig, profiles }
    if (mdConfig.activeProfileId === profileId) {
      if (profiles.length > 0) {
        const switched = await applyProfileConfig({ ...cfg, activeProfileId: undefined }, profiles[0].id)
        await appSaveConfig(switched, switched.notesFolder, switched.nick || null)
        try { localStorage.setItem(LEGACY_CONFIG_KEY, JSON.stringify(switched)) } catch {}
        set({ notesFolder: switched.notesFolder, mdConfig: switched, activeNote: null, recentlyDeleted: null })
        useTimersStore.getState().resetAll()
        if (switched.notesFolder) {
          await authorizeNotesFolder(switched.notesFolder, switched.nick || null)
          await activityService.loadHistory(switched.notesFolder)
          set({ deletedSessions: await loadDeleted(switched.notesFolder, switched.nick || null) })
          await get().refreshSessions()
        } else {
          set({ sessions: [], filteredSessions: [], deletedSessions: [] })
        }
        return
      }
      cfg.activeProfileId = undefined
    }
    await appSaveConfig(cfg, cfg.notesFolder, cfg.nick || null)
    try { localStorage.setItem(LEGACY_CONFIG_KEY, JSON.stringify(cfg)) } catch {}
    set({ mdConfig: cfg })
  },

  initializeFromConfig: async () => {
    let config: MDConfig
    try {
      const raw = localStorage.getItem(LEGACY_CONFIG_KEY)
      config = raw ? normalizeConfig(JSON.parse(raw)) : defaultConfig()
    } catch {
      config = defaultConfig()
    }
    const startupFolder = config.notesFolder
    if (startupFolder) {
      try { await authorizeNotesFolder(startupFolder, config.nick || null) }
      catch (error) {
        console.error('Saved notes folder could not be authorized:', error)
        set({ mdConfig: { ...config, notesFolder: null, onboardingComplete: false }, notesFolder: null })
        return
      }
    }
    if (startupFolder && config.nick) {
      const fileConfig = await loadConfig(startupFolder, config.nick)
      config = { ...config, ...fileConfig, notesFolder: startupFolder }
    }
    if (config.activeProfileId) {
      config = await applyProfileConfig(config, config.activeProfileId)
      // Keep the vault that was successfully authorized above. This also makes
      // upgrades from Windows configs work when the same vault is now on Linux.
      if (startupFolder) config = { ...config, notesFolder: startupFolder }
    }
    if (config.notesFolder) {
      const normalizedFolder = config.notesFolder.replace(/\\/g, '/')
      config = { ...config, notesFolder: normalizedFolder }
    }
    set({ mdConfig: config })
    if (config.notesFolder) {
      set({ notesFolder: config.notesFolder })
      try {
        await activityService.loadHistory(config.notesFolder)
        set({ deletedSessions: await loadDeleted(config.notesFolder, config.nick || null) })
        await get().refreshSessions()
      } catch (error) {
        console.error('Failed to initialize notes:', error)
        set({ notesLoading: false, notesError: errorMessage(error) })
      }
    } else {
      set({ notesFolder: null, sessions: [], filteredSessions: [], notesLoading: false, notesError: null })
    }
  },
}))

export const selectSessions = (state: MDState) => state.sessions
export const selectFilteredSessions = (state: MDState) => state.filteredSessions
export const selectMdConfig = (state: MDState) => state.mdConfig
export const selectActiveNote = (state: MDState) => state.activeNote
