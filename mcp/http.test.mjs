import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHttpServer } from './http.mjs'
import { createService } from './service.mjs'

test('HTTP boundary requires bearer auth and rejects origins', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mmstopwatch-http-')); await mkdir(join(vault, '.mmST-test')); await writeFile(join(vault, '.mmST-test/config.json'), '{}')
  const server = createHttpServer({ service: createService({ vaultPath: vault, profile: 'test' }), token: 'test-token', port: 0 })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port
  const unauth = await fetch(`http://127.0.0.1:${port}/api/v1/status`); assert.equal(unauth.status, 401)
  const denied = await fetch(`http://127.0.0.1:${port}/api/v1/status`, { headers: { authorization: 'Bearer test-token', origin: 'https://evil.invalid' } }); assert.equal(denied.status, 403)
  const status = await fetch(`http://127.0.0.1:${port}/api/v1/status`, { headers: { authorization: 'Bearer test-token' } }); assert.equal((await status.json()).ok, true)
  await new Promise(resolve => server.close(resolve))
})

test('HTTP advertises the note query route, enforces methods, and bounds bodies safely', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mmstopwatch-http-route-'))
  await mkdir(join(vault, '.mmST-test'))
  await writeFile(join(vault, '.mmST-test/config.json'), '{}')
  await writeFile(join(vault, 'work.md'), '---\nTimework: 00:00:01\n---\n')
  const server = createHttpServer({ service: createService({ vaultPath: vault, profile: 'test' }), token: 'test-token', port: 0 })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const headers = { authorization: 'Bearer test-token' }
  const note = await fetch(`${base}/api/v1/notes/get?path=work.md`, { headers })
  assert.equal(note.status, 200)
  assert.equal((await note.json()).ok, true)
  const wrongMethod = await fetch(`${base}/api/v1/notes/get?path=work.md`, { headers, method: 'POST', body: '{}' })
  assert.equal(wrongMethod.status, 405)
  assert.equal((await wrongMethod.json()).error.code, 'METHOD_NOT_ALLOWED')
  const unknown = await fetch(`${base}/api/v1/nope`, { headers })
  assert.equal(unknown.status, 404)
  const oversized = await fetch(`${base}/api/v1/timers/mutate`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ x: 'x'.repeat(1024 * 1024) }) })
  assert.ok([400, 413].includes(oversized.status))
  assert.equal((await oversized.json()).ok, false)
  await new Promise(resolve => server.close(resolve))
})

test('HTTP rejects invalid query and mutation schemas before service invocation', async () => {
  let calls = 0
  const service = new Proxy({}, { get: () => async () => { calls += 1; return { ok: true, data: {} } } })
  const server = createHttpServer({ service, token: 'test-token', port: 0 })
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    const headers = { authorization: 'Bearer test-token', 'content-type': 'application/json' }
    for (const url of [`${base}/api/v1/notes/get`, `${base}/api/v1/notes/get?path=`]) {
      const response = await fetch(url, { headers })
      assert.equal(response.status, 400)
      assert.equal((await response.json()).error.code, 'INVALID_ARGUMENT')
    }
    const unknownQuery = await fetch(`${base}/api/v1/notes/get?path=x.md&unexpected=true`, { headers })
    assert.equal(unknownQuery.status, 400)
    assert.equal((await unknownQuery.json()).error.code, 'INVALID_ARGUMENT')
    const response = await fetch(`${base}/api/v1/timers/mutate`, { method: 'POST', headers, body: JSON.stringify({ operation: 'start', confirmed: true, expectedRevision: 'r', unknown: true }) })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, 'INVALID_ARGUMENT')
    assert.equal(calls, 0)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
