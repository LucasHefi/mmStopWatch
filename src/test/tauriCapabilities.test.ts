import { describe, expect, it } from 'vitest'
import capability from '../../src-tauri/capabilities/default.json'
import tauriConfig from '../../src-tauri/tauri.conf.json'

describe('Tauri filesystem capability', () => {
  it('does not grant static filesystem access outside app data', () => {
    const serialized = JSON.stringify(capability.permissions)

    expect(serialized).not.toContain('$HOME/**')
    expect(serialized).not.toContain('D:/**')
    expect(capability.permissions).toContain('fs:default')
  })

  it('enables a restrictive production content security policy', () => {
    const csp = tauriConfig.app.security.csp

    expect(csp).not.toBeNull()
    expect(csp['default-src']).toContain("'self'")
    expect(csp['connect-src']).toBe('ipc: http://ipc.localhost')
    expect(JSON.stringify(csp)).not.toContain('https:')
  })
})
