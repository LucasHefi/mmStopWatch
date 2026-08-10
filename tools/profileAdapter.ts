import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ConfigGetOutput, ConfigMetadataDto, ProfileDto, ProfileListOutput } from '../src/application/contracts'
import { validateAbsoluteVaultPath, validateProfileKey } from '../src/services/pathSecurity'

interface StoredProfile {
  id?: unknown
  name?: unknown
  nick?: unknown
}

interface StoredConfig {
  activeProfileId?: unknown
  profiles?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeProfile(value: unknown): ProfileDto | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as StoredProfile
  if (typeof candidate.id !== 'string' || !candidate.id.trim() || typeof candidate.name !== 'string' || !candidate.name.trim()) return undefined
  const profile: ProfileDto = {
    id: candidate.id.trim(),
    name: candidate.name.trim(),
    active: false,
  }
  if (typeof candidate.nick === 'string' && candidate.nick.trim()) profile.nick = validateProfileKey(candidate.nick)
  return profile
}

export class ProfileAdapter {
  constructor(private readonly vaultPath: string) {}

  async listProfiles(): Promise<ProfileListOutput> {
    const root = resolve(validateAbsoluteVaultPath(this.vaultPath))
    const entries = await readdir(root, { withFileTypes: true })
    const profiles = new Map<string, ProfileDto>()
    let activeProfileId: string | undefined

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || !entry.name.startsWith('.mmST-')) continue
      const nick = entry.name.slice('.mmST-'.length)
      try {
        validateProfileKey(nick)
        const config = JSON.parse(await readFile(join(root, entry.name, 'config.json'), 'utf8')) as StoredConfig
        if (typeof config.activeProfileId === 'string' && config.activeProfileId.trim() && !activeProfileId) {
          activeProfileId = config.activeProfileId.trim()
        }
        if (!Array.isArray(config.profiles)) continue
        for (const candidate of config.profiles) {
          const profile = safeProfile(candidate)
          if (profile && !profiles.has(profile.id)) profiles.set(profile.id, profile)
        }
      } catch {
        // A malformed or inaccessible profile must not hide other readable profiles.
      }
    }

    const active = activeProfileId && profiles.has(activeProfileId) ? activeProfileId : undefined
    return {
      profiles: [...profiles.values()].map(profile => ({ ...profile, active: profile.id === active })),
      ...(active ? { activeProfileId: active } : {}),
    }
  }

  async getConfig(nick: string): Promise<ConfigGetOutput> {
    const root = resolve(validateAbsoluteVaultPath(this.vaultPath))
    const safeNick = validateProfileKey(nick)
    const config = JSON.parse(await readFile(join(root, `.mmST-${safeNick}`, 'config.json'), 'utf8')) as StoredConfig
    const source = config as Record<string, unknown>
    const metadata: ConfigMetadataDto = {
      profileCount: Array.isArray(config.profiles) ? config.profiles.length : 0,
    }
    if (typeof source.activeProfileId === 'string' && source.activeProfileId.trim()) metadata.activeProfileId = source.activeProfileId.trim()
    for (const key of ['frontmatterKey', 'timeEstimateKey', 'timeFormat', 'language'] as const) {
      if (typeof source[key] === 'string' && source[key].trim()) metadata[key] = source[key].trim()
    }
    for (const key of ['dailyGoalMs', 'autoRefreshInterval'] as const) {
      if (typeof source[key] === 'number' && Number.isFinite(source[key])) metadata[key] = source[key]
    }
    if (isRecord(source.notifications) && typeof source.notifications.enabled === 'boolean') {
      metadata.notificationsEnabled = source.notifications.enabled
    }
    return { config: metadata }
  }
}
