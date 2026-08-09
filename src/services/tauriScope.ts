import { invoke } from '@tauri-apps/api/core'
import { validateAbsoluteVaultPath, validateProfileKey } from './pathSecurity'

export function profileStorageKey(nick: string): string {
  return validateProfileKey(nick)
}

export async function authorizeNotesFolder(folder: string, nick?: string | null): Promise<void> {
  const path = validateAbsoluteVaultPath(folder)
  const profileKey = nick == null || nick.trim() === '' ? undefined : validateProfileKey(nick)
  await invoke('authorize_folder', { path, profileKey })
}
