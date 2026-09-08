import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdtemp, mkdir, writeFile, symlink, readFile, utimes, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createService } from './service.mjs'
import { timerMutationSchema, noteDurationSchema, routes } from './schema.mjs'

test('mutation schemas are separate and strict', () => {
  assert.notEqual(timerMutationSchema, noteDurationSchema)
  assert.equal(timerMutationSchema.properties.confirmed.const, true)
  assert.equal(noteDurationSchema.properties.confirmed.const, true)
  assert.deepEqual(timerMutationSchema.required, ['operation', 'confirmed', 'expectedRevision'])
  assert.deepEqual(noteDurationSchema.required, ['path', 'durationMs', 'confirmed', 'expectedRevision'])
  assert.ok(routes.includes('/api/v1/notes/get'))
})

test('file-backed service exposes scoped notes, status, stats and profile metadata', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mmstopwatch-mcp-'))
  await mkdir(join(vault, '.mmST-test'))
  await writeFile(join(vault, '.mmST-test', 'config.json'), JSON.stringify({ nick: 'test', frontmatterKey: 'Timework', timeEstimateKey: 'estimate' }))
  await writeFile(join(vault, 'work.md'), '---\nTimework: 00:01:02\ntags: [one, two]\n---\n# Work\n')
  const service = createService({ vaultPath: vault, profile: 'test' })
  const status = await service.status()
  assert.equal(status.ok, true)
  assert.equal((await service.notesList()).data[0].path, 'work.md')
  assert.equal((await service.stats()).data.noteCount, 1)
  assert.equal((await service.config()).data.profile, 'test')
})

test('symlinked notes outside the vault are rejected and external timers track elapsed time', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mmstopwatch-mcp-')); const outside = await mkdtemp(join(tmpdir(), 'mmstopwatch-outside-'))
  await mkdir(join(vault, '.mmST-test')); await writeFile(join(vault, '.mmST-test', 'config.json'), '{}')
  await writeFile(join(outside, 'secret.md'), '---\nTimework: 00:00:01\n---\n'); await symlink(join(outside, 'secret.md'), join(vault, 'link.md'))
  const service = createService({ vaultPath: vault, profile: 'test' })
  assert.equal((await service.notesGet('link.md')).error.code, 'SCOPE_VIOLATION')
  const empty = await service.timersList(); const started = await service.timersMutate({ operation: 'start', confirmed: true, expectedRevision: empty.revision, notePath: 'missing.md', timerId: 'external-1' })
  assert.equal(started.ok, false)
  assert.equal((await service.timersMutate({ operation: 'start', confirmed: true, expectedRevision: empty.revision, notePath: 'link.md', timerId: 'external-2' })).ok, false)
})

test('symlinked profiles fail closed without touching external profile files', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mmstopwatch-profile-link-'))
  const outside = await mkdtemp(join(tmpdir(), 'mmstopwatch-profile-outside-'))
  const profile = join(vault, '.mmST-test')
  await symlink(outside, profile)
  const service = createService({ vaultPath: vault, profile: 'test' })

  assert.equal((await service.status()).error.code, 'SCOPE_VIOLATION')
  assert.equal((await service.notesGet('missing.md')).error.code, 'SCOPE_VIOLATION')
  assert.equal((await service.notesList()).error.code, 'SCOPE_VIOLATION')
  assert.equal((await service.config()).error.code, 'SCOPE_VIOLATION')
  assert.equal((await service.timersList()).error.code, 'SCOPE_VIOLATION')
  assert.equal((await service.updateDuration({ path: 'missing.md', durationMs: 1000, confirmed: true, expectedRevision: 'stale' })).error.code, 'SCOPE_VIOLATION')
  assert.equal((await service.timersMutate({ operation: 'start', confirmed: true, expectedRevision: 'stale', timerId: 'link', notePath: 'missing.md' })).error.code, 'SCOPE_VIOLATION')
  for (const name of ['config.json', 'activity.json', 'mcp-timers.json', 'mcp-mutations.lock']) assert.equal(await access(join(outside, name)).then(() => true, () => false), false)
})

test('confirmation is checked before a denied mutation creates the selected profile', async () => {
  for (const invoke of [
    service => service.updateDuration({ path: 'missing.md', durationMs: 1000, confirmed: false, expectedRevision: 'revision' }),
    service => service.timersMutate({ operation: 'start', confirmed: false, expectedRevision: 'revision', timerId: 'denied', notePath: 'missing.md' }),
  ]) {
    const vault = await mkdtemp(join(tmpdir(), 'mmstopwatch-confirmation-'))
    const service = createService({ vaultPath: vault, profile: 'denied' })
    const result = await invoke(service)
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'CONFIRMATION_REQUIRED')
    assert.equal(await access(join(vault, '.mmST-denied')).then(() => true, () => false), false)
  }
})

test('profile data symlinks are rejected without external reads or writes', async () => {
  const cases = [
    { file: 'config.json', contents: JSON.stringify({ frontmatterKey: 'Outside' }), invoke: service => service.config() },
    { file: 'mcp-timers.json', contents: JSON.stringify([{ id: 'outside', state: 'running' }]), invoke: service => service.timersList() },
    { file: 'activity.json', contents: JSON.stringify({ entries: [{ operationId: 'outside' }] }), invoke: service => service.updateDuration({ path: 'work.md', durationMs: 1000, confirmed: true, expectedRevision: 'stale' }) },
  ]
  for (const { file, contents, invoke } of cases) {
    const vault = await mkdtemp(join(tmpdir(), 'mmstopwatch-profile-file-link-'))
    const outside = await mkdtemp(join(tmpdir(), 'mmstopwatch-profile-file-outside-'))
    const profile = join(vault, '.mmST-test')
    await mkdir(profile)
    await writeFile(join(vault, 'work.md'), '---\nTimework: 00:00:00\n---\n')
    const external = join(outside, file)
    await writeFile(external, contents)
    await symlink(external, join(profile, file))
    const result = await invoke(createService({ vaultPath: vault, profile: 'test' }))
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'SCOPE_VIOLATION')
    assert.equal(await readFile(external, 'utf8'), contents)
  }
})

test('duration updates only change the configured key inside frontmatter', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mmstopwatch-frontmatter-'))
  await mkdir(join(vault, '.mmST-test'))
  await writeFile(join(vault, '.mmST-test/config.json'), '{}')
  await writeFile(join(vault, 'work.md'), '---\ntags: [work]\n---\nTimework: body-value\n# Work\n')
  const service = createService({ vaultPath: vault, profile: 'test' })
  const note = await service.notesGet('work.md')
  const result = await service.updateDuration({ path: 'work.md', durationMs: 1000, confirmed: true, expectedRevision: note.revision, operationId: 'frontmatter-only' })
  assert.equal(result.ok, true)
  const text = await readFile(join(vault, 'work.md'), 'utf8')
  assert.match(text, /^Timework: 00:00:01$/m)
  assert.match(text, /^Timework: body-value$/m)
  assert.equal((await service.notesGet('work.md')).data.frontmatter.Timework, '00:00:01')
})

test('absent selected profiles fail closed for reads while mutations retain creation policy', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mmstopwatch-profile-absent-'))
  const note = '---\nTimework: 00:00:00\n---\n'
  await writeFile(join(vault, 'work.md'), note)
  const service = createService({ vaultPath: vault, profile: 'absent' })

  for (const result of [
    await service.status(),
    await service.notesGet('work.md'),
    await service.notesList(),
    await service.timersList(),
    await service.config(),
    await service.stats(),
    await service.reportPreview(),
  ]) {
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'NOT_CONFIGURED')
  }

  const expectedRevision = createHash('sha256').update(note).digest('hex')
  const mutation = await service.updateDuration({ path: 'work.md', durationMs: 1000, confirmed: true, expectedRevision, operationId: 'absent-profile-create' })
  assert.equal(mutation.ok, true)
  assert.equal((await service.status()).ok, true)
})

test('timer stop is idempotent and operationId defaults to a value', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mmstopwatch-idempotency-'))
  await mkdir(join(vault, '.mmST-test'))
  await writeFile(join(vault, '.mmST-test/config.json'), '{}')
  const service = createService({ vaultPath: vault, profile: 'test' })
  const initial = await service.timersList()
  const started = await service.timersMutate({ operation: 'start', confirmed: true, expectedRevision: initial.revision, timerId: 'timer-1', notePath: 'missing.md' })
  assert.equal(started.ok, false)
  await writeFile(join(vault, 'work.md'), '---\nTimework: 00:00:00\n---\n')
  const reset = await service.timersList()
  const running = await service.timersMutate({ operation: 'start', confirmed: true, expectedRevision: reset.revision, timerId: 'timer-1', notePath: 'work.md', operationId: 'op-1' })
  assert.equal(running.ok, true)
  assert.equal((await service.timersList()).revision, running.revision)
  const stopped = await service.timersMutate({ operation: 'stop', confirmed: true, expectedRevision: running.revision, timerId: 'timer-1', operationId: 'op-stop' })
  assert.equal(stopped.ok, true)
  const repeated = await service.timersMutate({ operation: 'stop', confirmed: true, expectedRevision: 'stale', timerId: 'timer-1', operationId: 'op-stop' })
  assert.equal(repeated.ok, true)
  assert.equal(repeated.data.operationId, 'op-stop')
})

test('timer elapsed time survives a process restart using wall-clock persistence', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mmstopwatch-cross-process-'))
  await mkdir(join(vault, '.mmST-test')); await writeFile(join(vault, '.mmST-test/config.json'), '{}')
  await writeFile(join(vault, 'work.md'), '---\nTimework: 00:00:00\n---\n')
  const script = `import { createService } from './service.mjs'; const s=createService({vaultPath:process.argv[1],profile:'test'}); const t=await s.timersList(); const a=JSON.parse(process.argv[2]); if (a.expectedRevision === undefined) a.expectedRevision=t.revision; const r=await s.timersMutate(a); console.log(JSON.stringify(r))`
  const start = await new Promise((resolve, reject) => { const child = spawn(process.execPath, ['--input-type=module', '-e', script, vault, JSON.stringify({ operation: 'start', confirmed: true, timerId: 'cross-process', notePath: 'work.md' })], { cwd: new URL('.', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; child.stdout.on('data', chunk => { out += chunk }); child.on('error', reject); child.on('close', code => code ? reject(new Error(out)) : resolve(JSON.parse(out))) })
  await new Promise(resolve => setTimeout(resolve, 120))
  const stopped = await new Promise((resolve, reject) => { const child = spawn(process.execPath, ['--input-type=module', '-e', script, vault, JSON.stringify({ operation: 'stop', confirmed: true, expectedRevision: start.revision, timerId: 'cross-process' })], { cwd: new URL('.', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; child.stdout.on('data', chunk => { out += chunk }); child.on('error', reject); child.on('close', code => code ? reject(new Error(out)) : resolve(JSON.parse(out))) })
  assert.equal(stopped.ok, true); assert.ok(stopped.data.durationMs >= 100)
})

test('concurrent duration mutations preserve records and dedupe an operationId', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mmstopwatch-concurrency-'))
  await mkdir(join(vault, '.mmST-test'))
  await writeFile(join(vault, '.mmST-test/config.json'), '{}')
  await writeFile(join(vault, 'one.md'), '---\nTimework: 00:00:00\n---\n')
  await writeFile(join(vault, 'two.md'), '---\nTimework: 00:00:00\n---\n')
  await writeFile(join(vault, 'three.md'), '---\nTimework: 00:00:00\n---\n')
  const service = createService({ vaultPath: vault, profile: 'test' })
  const [one, two, three] = await Promise.all([service.notesGet('one.md'), service.notesGet('two.md'), service.notesGet('three.md')])
  const [first, second] = await Promise.all([
    service.updateDuration({ path: 'one.md', durationMs: 1000, confirmed: true, expectedRevision: one.revision, operationId: 'concurrent-one' }),
    service.updateDuration({ path: 'two.md', durationMs: 2000, confirmed: true, expectedRevision: two.revision, operationId: 'concurrent-two' }),
  ])
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)

  const [repeatA, repeatB] = await Promise.all([
    service.updateDuration({ path: 'three.md', durationMs: 1000, confirmed: true, expectedRevision: three.revision, operationId: 'same-operation' }),
    service.updateDuration({ path: 'three.md', durationMs: 1000, confirmed: true, expectedRevision: three.revision, operationId: 'same-operation' }),
  ])
  assert.equal(repeatA.ok, true)
  assert.deepEqual(repeatB, repeatA)
  const history = JSON.parse(await readFile(join(vault, '.mmST-test/activity.json'), 'utf8'))
  assert.equal(history.entries.filter(entry => entry.operationId === 'same-operation').length, 1)
  assert.equal((await service.notesGet('one.md')).data.frontmatter.Timework, '00:00:01')
  assert.equal((await service.notesGet('two.md')).data.frontmatter.Timework, '00:00:02')
  assert.equal((await service.notesGet('three.md')).data.frontmatter.Timework, '00:00:01')
})

test('stale mutation locks reclaim missing and malformed owners', async () => {
  for (const owner of [null, '{malformed']) {
    const vault = await mkdtemp(join(tmpdir(), 'mmstopwatch-stale-lock-'))
    const profile = join(vault, '.mmST-test'); const lock = join(profile, 'mcp-mutations.lock')
    await mkdir(profile); await writeFile(join(profile, 'config.json'), '{}'); await writeFile(join(vault, 'work.md'), '---\nTimework: 00:00:00\n---\n')
    await mkdir(lock); if (owner !== null) await writeFile(join(lock, 'owner'), owner)
    const old = new Date(Date.now() - 60000); await utimes(lock, old, old)
    const service = createService({ vaultPath: vault, profile: 'test' }); const note = await service.notesGet('work.md')
    const result = await service.updateDuration({ path: 'work.md', durationMs: 1000, confirmed: true, expectedRevision: note.revision, operationId: `stale-${owner}` })
    assert.equal(result.ok, true)
    await rm(vault, { recursive: true, force: true })
  }
})

test('stale lock with a live owner is bounded and not reclaimed', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mmstopwatch-live-lock-')); const profile = join(vault, '.mmST-test'); const lock = join(profile, 'mcp-mutations.lock')
  await mkdir(lock, { recursive: true }); await writeFile(join(profile, 'config.json'), '{}'); await writeFile(join(vault, 'work.md'), '---\nTimework: 00:00:00\n---\n')
  await writeFile(join(lock, 'owner'), JSON.stringify({ pid: process.pid, token: 'live-test', createdAt: Date.now() })); const old = new Date(Date.now() - 60000); await utimes(lock, old, old)
  const service = createService({ vaultPath: vault, profile: 'test' }); const note = await service.notesGet('work.md'); const started = Date.now()
  const result = await service.updateDuration({ path: 'work.md', durationMs: 1000, confirmed: true, expectedRevision: note.revision, operationId: 'live-lock' })
  assert.equal(result.error.code, 'LOCK_TIMEOUT'); assert.ok(Date.now() - started < 5500)
  await rm(vault, { recursive: true, force: true })
})
