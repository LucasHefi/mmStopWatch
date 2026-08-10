// @vitest-environment node

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMMAND_REGISTRY, PROTOCOL_VERSION } from '../application/contracts'

type SchemaRoute = {
  method: string
  path: string
  command: string
  readOnly: boolean
  responseSchema: string
}

type ControlPlaneSchema = {
  protocolVersion: string
  commandRegistry: Record<string, { domain: string; mutating: boolean }>
  routes: SchemaRoute[]
  responseSchemas: Record<string, { '$ref': string }>
  $defs?: Record<string, unknown>
}

async function loadSchema(): Promise<ControlPlaneSchema> {
  const raw = await readFile(join(process.cwd(), 'schemas/control-plane-v1.json'), 'utf8')
  return JSON.parse(raw) as ControlPlaneSchema
}

describe('control-plane JSON Schema contract', () => {
  it('matches the typed command registry and documents the versioned read routes', async () => {
    const schema = await loadSchema()

    expect(schema.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(schema.$defs).toEqual(expect.objectContaining({
      commandRequest: expect.any(Object),
      successEnvelope: expect.any(Object),
      errorEnvelope: expect.any(Object),
    }))

    expect(Object.keys(schema.commandRegistry).sort()).toEqual(Object.keys(COMMAND_REGISTRY).sort())
    for (const [command, definition] of Object.entries(COMMAND_REGISTRY)) {
      expect(schema.commandRegistry[command]).toEqual(definition)
    }

    const routeKeys = schema.routes.map(route => `${route.method} ${route.path} ${route.command}`)
    expect(new Set(routeKeys).size).toBe(routeKeys.length)
    expect(schema.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'GET', path: '/api/v1/status', command: 'status', readOnly: true }),
      expect.objectContaining({ method: 'GET', path: '/api/v1/capabilities', command: 'capabilities', readOnly: true }),
      expect.objectContaining({ method: 'GET', path: '/api/v1/notes', command: 'list_notes', readOnly: true }),
      expect.objectContaining({ method: 'GET', path: '/api/v1/profiles', command: 'profile_list', readOnly: true }),
      expect.objectContaining({ method: 'GET', path: '/api/v1/config', command: 'config_get', readOnly: true }),
      expect.objectContaining({ method: 'GET', path: '/api/v1/notifications', command: 'notification_status', readOnly: true }),
      expect.objectContaining({ method: 'GET', path: '/api/v1/stats', command: 'get_stats', readOnly: true }),
      expect.objectContaining({ method: 'POST', path: '/api/v1/reports/preview', command: 'preview_report', readOnly: true }),
    ]))
    for (const route of schema.routes) {
      expect(COMMAND_REGISTRY[route.command as keyof typeof COMMAND_REGISTRY]).toBeDefined()
      if (route.readOnly) expect(COMMAND_REGISTRY[route.command as keyof typeof COMMAND_REGISTRY].mutating).toBe(false)
      expect(schema.$defs?.[route.responseSchema]).toBeDefined()
      expect(schema.responseSchemas[route.command]).toEqual({ '$ref': `#/$defs/${route.responseSchema}` })
    }
  })
})
