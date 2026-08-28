import { readTextFile, exists, mkdir, readDir } from '@tauri-apps/plugin-fs'
import { writeTextFileAtomically } from './safeFileWriter'
import { validateAbsoluteVaultPath, validateProfileKey, validateFrontmatterKey } from './pathSecurity'
import type { MDConfig, DeletedSession, ActivityHistory, VaultProfile, LayoutMode } from '../types/session'

const CONFIG_FILE = 'config.json'
const DELETED_FILE = 'deleted_sessions.json'
const ACTIVITY_FILE = 'activity.json'

function getStorageDir(notesFolder: string, nick: string): string {
  return validateAbsoluteVaultPath(notesFolder) + '/.mmST-' + validateProfileKey(nick)
}

function getConfigPath(notesFolder: string, nick: string): string {
  return getStorageDir(notesFolder, nick) + '/' + CONFIG_FILE
}

function getDeletedPath(notesFolder: string, nick: string): string {
  return getStorageDir(notesFolder, nick) + '/' + DELETED_FILE
}

function getActivityPath(notesFolder: string, nick: string): string {
  return getStorageDir(notesFolder, nick) + '/' + ACTIVITY_FILE
}

async function ensureDir(dir: string): Promise<void> {
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
}

const LEGACY_CONFIG_KEY = 'mmstopwatch_md_config'
const LEGACY_DELETED_KEY = 'mmstopwatch_deleted_sessions'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown, fallback: number, minimum = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum ? value : fallback
}

function safeKey(value: unknown, fallback: string): string {
  try {
    return validateFrontmatterKey(typeof value === 'string' ? value : fallback)
  } catch {
    return fallback
  }
}

/** Keep persisted settings backward-compatible and safe to consume after upgrades. */
export function normalizeConfig(value: unknown): MDConfig {
  const defaults = defaultConfig()
  const defaultRoundTimes = defaults.roundTimes || { enabled: false, durations: [45, 60, 90, 120] }
  const defaultNotifications = defaults.notifications || { enabled: true, intervalMinutes: 60 as const }
  const defaultTimerLimitAlert = defaults.timerLimitAlert || { enabled: true, soundEnabled: false, soundPath: null, notificationsEnabled: true, customMessage: '', showOverlay: true }
  const defaultTimerLayout = defaults.timerLayout || { mode: 'list' as const, order: [] }
  if (!isRecord(value)) return defaults
  const config = { ...defaults, ...value } as MDConfig
  config.notesFolder = typeof value.notesFolder === 'string' && value.notesFolder.trim() ? value.notesFolder : null
  config.frontmatterKey = safeKey(value.frontmatterKey, defaults.frontmatterKey)
  config.timeEstimateKey = safeKey(value.timeEstimateKey, defaults.timeEstimateKey || 'timeEstimate')
  config.timeFormat = typeof value.timeFormat === 'string' && value.timeFormat.trim().length <= 32 ? value.timeFormat.trim() : defaults.timeFormat
  config.tags = Array.isArray(value.tags) ? value.tags.filter((item): item is string => typeof item === 'string') : defaults.tags
  config.pinnedNotes = Array.isArray(value.pinnedNotes) ? value.pinnedNotes.filter((item): item is string => typeof item === 'string' && item.length > 0) : defaults.pinnedNotes
  config.statsFieldKeys = Array.isArray(value.statsFieldKeys) ? value.statsFieldKeys.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : defaults.statsFieldKeys
  config.dailyGoalMs = finiteNumber(value.dailyGoalMs, defaults.dailyGoalMs ?? 28_800_000)
  config.autoRefreshInterval = finiteNumber(value.autoRefreshInterval, defaults.autoRefreshInterval ?? 10)
  config.timeEstimates = isRecord(value.timeEstimates)
    ? Object.fromEntries(Object.entries(value.timeEstimates).filter(([, minutes]) => typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0)) as Record<string, number>
    : defaults.timeEstimates
  config.roundTimes = isRecord(value.roundTimes)
    ? { enabled: typeof value.roundTimes.enabled === 'boolean' ? value.roundTimes.enabled : defaultRoundTimes.enabled, customMinutes: typeof value.roundTimes.customMinutes === 'number' && Number.isFinite(value.roundTimes.customMinutes) ? value.roundTimes.customMinutes : undefined, durations: Array.isArray(value.roundTimes.durations) ? value.roundTimes.durations.filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0) : defaultRoundTimes.durations }
    : defaultRoundTimes
  config.notifications = isRecord(value.notifications)
    ? { enabled: typeof value.notifications.enabled === 'boolean' ? value.notifications.enabled : defaultNotifications.enabled, intervalMinutes: [0, 5, 10, 15, 30, 60, 120].includes(value.notifications.intervalMinutes as number) ? value.notifications.intervalMinutes as 0 | 5 | 10 | 15 | 30 | 60 | 120 : defaultNotifications.intervalMinutes }
    : defaultNotifications
  config.timerLimitAlert = isRecord(value.timerLimitAlert)
    ? { enabled: typeof value.timerLimitAlert.enabled === 'boolean' ? value.timerLimitAlert.enabled : defaultTimerLimitAlert.enabled, soundEnabled: typeof value.timerLimitAlert.soundEnabled === 'boolean' ? value.timerLimitAlert.soundEnabled : defaultTimerLimitAlert.soundEnabled, soundPath: typeof value.timerLimitAlert.soundPath === 'string' ? value.timerLimitAlert.soundPath : null, notificationsEnabled: typeof value.timerLimitAlert.notificationsEnabled === 'boolean' ? value.timerLimitAlert.notificationsEnabled : defaultTimerLimitAlert.notificationsEnabled, customMessage: typeof value.timerLimitAlert.customMessage === 'string' ? value.timerLimitAlert.customMessage : defaultTimerLimitAlert.customMessage, showOverlay: typeof value.timerLimitAlert.showOverlay === 'boolean' ? value.timerLimitAlert.showOverlay : defaultTimerLimitAlert.showOverlay }
    : defaultTimerLimitAlert
  config.timerLayout = isRecord(value.timerLayout)
    ? { mode: ['list', 'grid-1', 'grid-2', 'grid-3', 'grid-4'].includes(value.timerLayout.mode as string) ? value.timerLayout.mode as LayoutMode : defaultTimerLayout.mode, order: Array.isArray(value.timerLayout.order) ? value.timerLayout.order.filter((item): item is string => typeof item === 'string') : defaultTimerLayout.order }
    : defaultTimerLayout
  config.profiles = Array.isArray(value.profiles) ? value.profiles.filter(isRecord).filter(profile => typeof profile.id === 'string' && typeof profile.name === 'string') as unknown as VaultProfile[] : defaults.profiles
  config.activeProfileId = typeof value.activeProfileId === 'string' ? value.activeProfileId : undefined
  if (typeof value.nick === 'string') {
    try { config.nick = validateProfileKey(value.nick) } catch { config.nick = undefined }
  } else {
    config.nick = undefined
  }
  config.obsidianVault = typeof value.obsidianVault === 'string' ? value.obsidianVault.trim().slice(0, 200) : undefined
  return config
}

function loadLegacyConfig(): MDConfig {
  try {
    const raw = localStorage.getItem(LEGACY_CONFIG_KEY)
    return raw ? normalizeConfig(JSON.parse(raw)) : defaultConfig()
  } catch {
    return defaultConfig()
  }
}

export async function loadConfig(notesFolder: string | null, nick: string | null): Promise<MDConfig> {
  if (!notesFolder || !nick) return loadLegacyConfig()
  const normalizedFolder = validateAbsoluteVaultPath(notesFolder)
  const path = getConfigPath(normalizedFolder, nick)
  if (await exists(path)) {
    let stored: MDConfig
    try {
      stored = normalizeConfig(JSON.parse(await readTextFile(path)))
    } catch (error) {
      console.warn('Invalid vault config, using defaults/legacy settings:', error)
      stored = loadLegacyConfig()
    }
    // The config file lives inside this vault. Its historical notesFolder value
    // may belong to another operating system (for example D:\\... from Windows),
    // so never let it redirect the current vault scan.
    return { ...stored, notesFolder: normalizedFolder }
  }
  const legacy = loadLegacyConfig()
  return { ...legacy, notesFolder: normalizedFolder }
}

export async function saveConfig(config: MDConfig, notesFolder: string | null, nick: string | null): Promise<void> {
  if (!notesFolder || !nick) {
    localStorage.setItem(LEGACY_CONFIG_KEY, JSON.stringify(config))
    return
  }
  const dir = getStorageDir(notesFolder, nick)
  await ensureDir(dir)
  await writeTextFileAtomically(getConfigPath(notesFolder, nick), JSON.stringify(config, null, 2))
}

export async function loadDeleted(notesFolder: string | null, nick: string | null): Promise<DeletedSession[]> {
  if (!notesFolder || !nick) {
    try {
      const raw = localStorage.getItem(LEGACY_DELETED_KEY)
      return raw ? JSON.parse(raw) as DeletedSession[] : []
    } catch {
      return []
    }
  }
  const path = getDeletedPath(notesFolder, nick)
  if (await exists(path)) return JSON.parse(await readTextFile(path)) as DeletedSession[]
  return []
}

export async function saveDeleted(deleted: DeletedSession[], notesFolder: string | null, nick: string | null): Promise<void> {
  if (!notesFolder || !nick) {
    localStorage.setItem(LEGACY_DELETED_KEY, JSON.stringify(deleted))
    return
  }
  const dir = getStorageDir(notesFolder, nick)
  await ensureDir(dir)
  await writeTextFileAtomically(getDeletedPath(notesFolder, nick), JSON.stringify(deleted, null, 2))
}

export async function loadActivity(notesFolder: string | null, nick: string | null): Promise<ActivityHistory> {
  if (!notesFolder || !nick) return { entries: [] }
  const path = getActivityPath(notesFolder, nick)
  if (!(await exists(path))) return { entries: [] }
  const data = JSON.parse(await readTextFile(path)) as ActivityHistory
  if (!Array.isArray(data.entries)) throw new Error('Invalid activity history: ' + path)
  return data
}

export async function saveActivity(history: ActivityHistory, notesFolder: string | null, nick: string | null): Promise<void> {
  if (!notesFolder || !nick) return
  const dir = getStorageDir(notesFolder, nick)
  await ensureDir(dir)
  await writeTextFileAtomically(getActivityPath(notesFolder, nick), JSON.stringify(history, null, 2))
}

export async function listAvailableNicks(notesFolder: string): Promise<string[]> {
  try {
    const entries = await readDir(notesFolder)
    return entries.filter(entry => entry.name?.startsWith('.mmST-')).map(entry => (entry.name as string).slice(6)).filter(Boolean)
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
    timerLimitAlert: { enabled: true, soundEnabled: false, soundPath: null, notificationsEnabled: true, customMessage: '', showOverlay: true },
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
  return 'vault_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
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
  profile.name = profiles.find(item => item.id === activeId)?.name || profile.name
  const index = profiles.findIndex(item => item.id === activeId)
  const updated = index >= 0 ? profiles.map((item, position) => position === index ? profile : item) : [...profiles, profile]
  return { ...config, profiles: updated }
}

export async function switchProfile(config: MDConfig, profileId: string): Promise<MDConfig> {
  const profile = (config.profiles || []).find(item => item.id === profileId)
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
