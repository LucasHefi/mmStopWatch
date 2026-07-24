import { invoke } from '@tauri-apps/api/core'

export async function authorizeNotesFolder(folder: string): Promise<void> {
  if (!folder.trim()) throw new Error('Notes folder is required')
  await invoke('authorize_folder', { path: folder })
}
