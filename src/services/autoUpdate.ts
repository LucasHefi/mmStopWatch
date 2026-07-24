// Auto-update service
// For full auto-update: install `npm i @tauri-apps/plugin-updater @tauri-apps/plugin-process`
// and uncomment the Tauri plugin code below.

interface UpdateResult {
  available: boolean
  currentVersion: string
  latestVersion: string
  error?: string
}

// HTTP-based update check via mediamaker.cz release endpoint
async function checkViaHttp(currentVersion: string): Promise<UpdateResult> {
  try {
    const response = await fetch('https://mediamaker.cz/mmstopwatch/release/latest.json')
    if (!response.ok) {
      return { available: false, currentVersion, latestVersion: '', error: `HTTP ${response.status}` }
    }
    const data = await response.json() as Record<string, string>
    const latestVersion = data.version || data.tag_name || ''
    if (!latestVersion) {
      return { available: false, currentVersion, latestVersion: '', error: 'No version in response' }
    }
    // Compare versions
    const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number)
    const current = parse(currentVersion)
    const latest = parse(latestVersion)
    const isNewer = latest.some((n, i) => n > (current[i] || 0))
    return {
      available: isNewer,
      currentVersion,
      latestVersion,
    }
  } catch (err) {
    return { available: false, currentVersion, latestVersion: '', error: String(err) }
  }
}

export async function checkForUpdates(currentVersion: string): Promise<UpdateResult> {
  return checkViaHttp(currentVersion)
}

export function openReleasePage(): void {
  window.open('https://mediamaker.cz/mmstopwatch/releases', '_blank')
}