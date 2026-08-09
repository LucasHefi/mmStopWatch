import { spawnSync } from 'node:child_process'

const commands = [
  ['typecheck', 'npm', ['run', 'typecheck']],
  ['tests', 'npm', ['test']],
  ['frontend build', 'npm', ['run', 'build']],
  ['tauri check', 'npm', ['run', 'tauri:check']],
  ['dependency audit', 'npm', ['audit', '--audit-level=high']],
  ['diff check', 'git', ['diff', '--check']],
]
let failed = false
for (const [label, executable, args] of commands) {
  process.stdout.write('\n[2.0] ' + label + '\n')
  const result = spawnSync(executable, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) { failed = true; process.stderr.write('[2.0] FAILED: ' + label + '\n'); break }
}
if (!failed) process.stdout.write('\n[2.0] automated gates passed\n')
process.exitCode = failed ? 1 : 0
