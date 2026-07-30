import { afterEach, describe, expect, it } from 'vitest'
import { request as httpRequest } from 'node:http'
import { startHttpServer, type ControlPlaneServerHandle } from '../../tools/controlPlaneServer'

const servers: ControlPlaneServerHandle[] = []

function requestStatus(server: ControlPlaneServerHandle, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: server.host,
      port: server.port,
      path: '/api/v1/status',
      headers,
    }, response => {
      response.resume()
      response.on('end', () => resolve(response.statusCode || 0))
    })
    request.on('error', reject)
    request.end()
  })
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()))
})

describe('localhost control plane HTTP boundary', () => {
  it('requires a bearer token and serves versioned status', async () => {
    const server = await startHttpServer({ token: 'test-token' })
    servers.push(server)

    const unauthorized = await fetch(`${server.url}/api/v1/status`)
    expect(unauthorized.status).toBe(401)

    const response = await fetch(`${server.url}/api/v1/status`, {
      headers: { Authorization: `Bearer ${server.token}` },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      protocolVersion: '1',
      data: { appVersion: '1.6.1', ready: true },
    })
  })

  it('exposes read-only capabilities and keeps unimplemented mutations absent', async () => {
    const server = await startHttpServer({ token: 'test-token' })
    servers.push(server)
    const headers = { Authorization: `Bearer ${server.token}` }

    const capabilities = await fetch(`${server.url}/api/v1/capabilities`, { headers })
    expect(capabilities.status).toBe(200)
    await expect(capabilities.json()).resolves.toMatchObject({
      ok: true,
      data: { readOnly: true, commands: ['status', 'capabilities', 'list_notes', 'get_stats', 'preview_report'] },
    })

    const notes = await fetch(`${server.url}/api/v1/notes`, { headers })
    expect(notes.status).toBe(501)
    await expect(notes.json()).resolves.toMatchObject({ ok: false, error: { code: 'NOT_IMPLEMENTED' } })
  })

  it('rejects non-loopback hosts and unapproved origins', async () => {
    const server = await startHttpServer({ token: 'test-token', allowedOrigins: ['http://tauri.localhost'] })
    servers.push(server)
    const headers = { Authorization: `Bearer ${server.token}` }

    const badHost = await requestStatus(server, { ...headers, Host: 'evil.example' })
    expect(badHost).toBe(400)

    const badOrigin = await fetch(`${server.url}/api/v1/status`, { headers: { ...headers, Origin: 'http://evil.example' } })
    expect(badOrigin.status).toBe(403)
  })
})
