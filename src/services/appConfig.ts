import { readTextFile, writeTextFile, exists, mkdir, readDir } from '@tauri-apps/plugin-fs'
import type { MDConfig, DeletedSession, ActivityHistory, VaultProfile } from '../types/session'

const CONFIG_FILE = 'config.json'
const DELETED_FILE = 'deleted_sessions.json'
const ACTIVITY_FILE = 'activity.json'

function getStorageDir(notesFolder: string, nick: string): string {
  return `${notesFolder}/.mmST-${nick}`
}

function getConfigPath(notesFolder: string, nick: string): string {
  return `${getStorageDir(notesFolder, nick)}/${CONFIG_FILE}`
}

function getDeletedPath(notesFolder: string, nick: string): string {
  return `${getStorageDir(notesFolder, nick)}/${DELETED_FILE}`
}

function getActivityPath(notesFolder: string, nick: string): string {
  return `${getStorageDir(notesFolder, nick)}/${ACTIVITY_FILE}`
}

async function ensureDir(dir: string): Promise<void> {
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true })
  }
}

// ---- Config ----

const LEGACY_CONFIG_KEY = 'mmstopwatch_md_config'
const LEGACY_DELETED_KEY = 'mmstopwatch_deleted_sessions'

export async function loadConfig(notesFolder: string | null, nick: string | null): Promise<MDConfig> {
  const fallback = (): MDConfig => {
    try {
      const raw = localStorage.getItem(LEGACY_CONFIG_KEY)
      return raw ? JSON.parse(raw) : defaultConfig()
    } catch {
      return defaultConfig()
    }
  }

  if (!notesFolder || !nick) return fallback()

  const path = getConfigPath(notesFolder, nick)
  try {
    if (await exists(path)) {
      const raw = await readTextFile(path)
      return JSON.parse(raw) as MDConfig
    }
  } catch {
    console.warn('Failed to load config from file, falling back to localStorage')
  }
  return fallback()
}

export async function saveConfig(config: MDConfig, notesFolder: string | null, nick: string | null): Promise<void> {
  if (!notesFolder || !nick) {
    // Fallback to localStorage
    localStorage.setItem(LEGACY_CONFIG_KEY, JSON.stringify(config))
    return
  }

  const dir = getStorageDir(notesFolder, nick)
  await ensureDir(dir)
  const path = getConfigPath(notesFolder, nick)
  await writeTextFile(path, JSON.stringify(config, null, 2))
}

// ---- Deleted Sessions ----

export async function loadDeleted(notesFolder: string | null, nick: string | null): Promise<DeletedSession[]> {
  if (!notesFolder || !nick) {
    try {
      const raw = localStorage.getItem(LEGACY_DELETED_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  }

  const path = getDeletedPath(notesFolder, nick)
  try {
    if (await exists(path)) {
      const raw = await readTextFile(path)
      return JSON.parse(raw)
    }
  } catch {
    console.warn('Failed to load deleted sessions from file')
  }
  return []
}

export async function saveDeleted(deleted: DeletedSession[], notesFolder: string | null, nick: string | null): Promise<void> {
  if (!notesFolder || !nick) {
    localStorage.setItem(LEGACY_DELETED_KEY, JSON.stringify(deleted))
    return
  }

  const dir = getStorageDir(notesFolder, nick)
  await ensureDir(dir)
  const path = getDeletedPath(notesFolder, nick)
  await writeTextFile(path, JSON.stringify(deleted, null, 2))
}

// ---- Activity History ----

export async function loadActivity(notesFolder: string | null, nick: string | null): Promise<ActivityHistory> {
  if (!notesFolder || !nick) return { entries: [] }

  const path = getActivityPath(notesFolder, nick)
  if (!(await exists(path))) return { entries: [] }

  const raw = await readTextFile(path)
  const data = JSON.parse(raw)
  if (!Array.isArray(data.entries)) throw new Error(`Invalid activity history: ${path}`)
  return data
}

export async function saveActivity(history: ActivityHistory, notesFolder: string | null, nick: string | null): Promise<void> {
  if (!notesFolder || !nick) return

  const dir = getStorageDir(notesFolder, nick)
  await ensureDir(dir)
  const path = getActivityPath(notesFolder, nick)
  await writeTextFile(path, JSON.stringify(history, null, 2))
}

export async function listAvailableNicks(notesFolder: string): Promise<string[]> {
  try {
    const entries = await readDir(notesFolder)
    return entries
      .filter(e => e.name?.startsWith('.mmST-'))
      .map(e => (e.name as string).slice(6)) // strip '.mmST-'
      .filter(Boolean)
  } catch {
    return []
  }
}

export { getStorageDir }

export function defaultConfig(): MDConfig {
  return {
    notesFolder: null,
    frontmatterKey: 'Timework',
    timeEstimateKey: 'timeEstimate',
    timeFormat: 'HH:mm:ss',
    tags: [],
    language: 'cs',
    dailyGoalMs: 28800000,
    roundTimes: { enabled: false, durations: [45, 60, 90, 120] },
    timeEstimates: {},
    autoRefreshInterval: 10,
    timerLimitAlert: {
      enabled: true,
      soundEnabled: false,
      soundPath: null,
      notificationsEnabled: true,
      customMessage: '',
      showOverlay: true,
    },
    notifications: { enabled: true, intervalMinutes: 60 },
    pinnedNotes: [],
    timerViewMode: 'cards',
    timerLayout: { mode: 'list', order: [] },
    statsFieldKeys: ['project', 'client', 'type'],
    profiles: [],
    activeProfileId: undefined,
  }
}

export function generateProfileId(): string {
  return 'vault_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6)
}

export function createProfileFromConfig(config: MDConfig, name?: string): VaultProfile {
  return {
    id: generateProfileId(),
    name: name || config.obsidianVault || config.nick || 'Vault',
    notesFolder: config.notesFolder,
    nick: config.nick || null,
    frontmatterKey: config.frontmatterKey,
    timeEstimateKey: config.timeEstimateKey,
    timeFormat: config.timeFormat,
    dailyGoalMs: config.dailyGoalMs,
    obsidianVault: config.obsidianVault,
  }
}

export async function saveCurrentProfile(config: MDConfig): Promise<MDConfig> {
  const profiles = config.profiles || []
  const activeId = config.activeProfileId
  if (!activeId) return config

  const profile = createProfileFromConfig(config)
  profile.id = activeId
  profile.name = profiles.find(p => p.id === activeId)?.name || profile.name

  const idx = profiles.findIndex(p => p.id === activeId)
  const updated = idx >= 0
    ? profiles.map((p, i) => i === idx ? profile : p)
    : [...profiles, profile]

  return { ...config, profiles: updated }
}

export async function switchProfile(config: MDConfig, profileId: string): Promise<MDConfig> {
  const profile = (config.profiles || []).find(p => p.id === profileId)
  if (!profile) return config

  return {
    ...config,
    notesFolder: profile.notesFolder,
    nick: profile.nick ?? undefined,
    frontmatterKey: profile.frontmatterKey ?? config.frontmatterKey,
    timeEstimateKey: profile.timeEstimateKey ?? config.timeEstimateKey,
    timeFormat: profile.timeFormat ?? config.timeFormat,
    dailyGoalMs: profile.dailyGoalMs ?? config.dailyGoalMs,
    obsidianVault: profile.obsidianVault ?? config.obsidianVault,
    activeProfileId: profileId,
  }
}
