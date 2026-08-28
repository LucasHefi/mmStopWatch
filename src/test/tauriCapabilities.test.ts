import { describe, expect, it } from 'vitest'
import capability from '../../src-tauri/capabilities/default.json'
import tauriConfig from '../../src-tauri/tauri.conf.json'

describe('Tauri filesystem capability', () => {
  it('does not grant static filesystem access outside app data', () => {
    const serialized = JSON.stringify(capability.permissions)

    expect(serialized).not.toContain('$HOME/**')
    expect(serialized).not.toContain('D:/**')
    expect(capability.permissions).toContain('fs:default')
    expect(capability.permissions).toContain('fs:allow-rename')
    expect(capability.permissions).toContain('fs:allow-remove')
  })

  it('enables a restrictive production content security policy', () => {
    const csp = tauriConfig.app.security.csp

    expect(csp).not.toBeNull()
    expect(csp['default-src']).toContain("'self'")
    expect(csp['connect-src']).toContain('ipc: http://ipc.localhost')
    expect(csp['connect-src']).toContain('https://mediamaker.cz')
    expect(tauriConfig.bundle.createUpdaterArtifacts).toBe(true)
    expect(tauriConfig.plugins.updater.endpoints[0]).toBe('https://mediamaker.cz/mmstopwatch/release/latest.json')
  })

  it('exposes hidden profile directories inside the runtime-selected vault', () => {
    expect(tauriConfig.plugins.fs).toEqual({ requireLiteralLeadingDot: false })
  })
})
