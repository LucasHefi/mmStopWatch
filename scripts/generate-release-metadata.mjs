import { createHash } from 'node:crypto'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const bundleRoot = join(process.cwd(), 'src-tauri', 'target', 'release', 'bundle')
const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const bundleFiles = []
const artifactExtensions = new Set(['.AppImage', '.deb', '.dmg', '.exe', '.msi', '.rpm'])

async function collectFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory() && !entry.name.endsWith('.app')) {
      await collectFiles(path)
    } else if (
      entry.isFile() &&
      !['SHA256SUMS.txt', 'BUILD-METADATA.json'].includes(entry.name) &&
      entry.name.includes(packageJson.version) &&
      artifactExtensions.has(entry.name.slice(entry.name.lastIndexOf('.')))
    ) {
      bundleFiles.push(path)
    }
  }
}

await collectFiles(bundleRoot)
bundleFiles.sort()

const checksumLines = []
for (const path of bundleFiles) {
  const digest = createHash('sha256').update(await readFile(path)).digest('hex')
  checksumLines.push(`${digest}  ${relative(bundleRoot, path)}`)
}

await writeFile(join(bundleRoot, 'SHA256SUMS.txt'), `${checksumLines.join('\n')}\n`)
await writeFile(
  join(bundleRoot, 'BUILD-METADATA.json'),
  `${JSON.stringify({
    name: packageJson.name,
    version: packageJson.version,
    commit: process.env.GITHUB_SHA || null,
    ref: process.env.GITHUB_REF_NAME || null,
    runner: process.env.RUNNER_OS || process.platform,
    files: bundleFiles.map(path => relative(bundleRoot, path)),
  }, null, 2)}\n`,
)

console.log(`Generated metadata for ${bundleFiles.length} bundle files`)
