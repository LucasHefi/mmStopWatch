export interface UpdateResult {
  available: boolean
  currentVersion: string
  latestVersion: string
  error?: string
  install?: () => Promise<void>
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => value.replace(/^v/, '').split(/[+-]/, 1)[0].split('.').map(part => Number(part) || 0)
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1
  }
  return 0
}

async function checkViaNative(currentVersion: string): Promise<UpdateResult> {
  const [{ check }, { relaunch }] = await Promise.all([
    import('@tauri-apps/plugin-updater'),
    import('@tauri-apps/plugin-process'),
  ])
  const update = await check()
  if (!update) return { available: false, currentVersion, latestVersion: currentVersion }
  return {
    available: true,
    currentVersion,
    latestVersion: update.version,
    install: async () => {
      await update.downloadAndInstall()
      await relaunch()
    },
  }
}

async function checkViaHttp(currentVersion: string): Promise<UpdateResult> {
  try {
    const response = await fetch('https://mediamaker.cz/mmstopwatch/release/latest.json')
    if (!response.ok) return { available: false, currentVersion, latestVersion: '', error: `HTTP ${response.status}` }
    const data = await response.json() as Record<string, unknown>
    const latestVersion = typeof data.version === 'string' ? data.version : typeof data.tag_name === 'string' ? data.tag_name : ''
    if (!latestVersion) return { available: false, currentVersion, latestVersion: '', error: 'No version in response' }
    return { available: compareVersions(latestVersion, currentVersion) > 0, currentVersion, latestVersion }
  } catch (error) {
    return { available: false, currentVersion, latestVersion: '', error: String(error) }
  }
}

export async function checkForUpdates(currentVersion: string): Promise<UpdateResult> {
  try {
    return isTauriRuntime() ? await checkViaNative(currentVersion) : await checkViaHttp(currentVersion)
  } catch (error) {
    return { available: false, currentVersion, latestVersion: '', error: String(error) }
  }
}

export function openReleasePage(): void {
  window.open('https://mediamaker.cz/mmstopwatch/releases', '_blank', 'noopener,noreferrer')
}
