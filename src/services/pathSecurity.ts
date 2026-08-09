const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const WINDOWS_ABSOLUTE = /^[a-z]:(?:[\/]|$)/i
const UNC = /^\\(?:\\|\?\|\.\\)/
const ENCODED_SEPARATOR_OR_DOT = /%(?:2e|2f|5c)/i

export class UnsafePathError extends Error {
  readonly code = 'UNSAFE_PATH' as const
}

function fail(message: string): never {
  throw new UnsafePathError(message)
}

export function validateProfileKey(value: string): string {
  if (typeof value !== 'string') fail('Profile key must be a string')
  const normalized = value.trim().normalize('NFKC')
  if (!normalized || normalized.length > 80 || CONTROL_CHARS.test(normalized)
    || normalized.includes('/') || normalized.includes('\\')
    || normalized === '.' || normalized === '..' || normalized.includes('..')) {
    fail('Profile key contains unsafe characters')
  }
  return normalized
}

export function validateFrontmatterKey(value: string): string {
  if (typeof value !== 'string') fail('Frontmatter key must be a string')
  const normalized = value.trim()
  if (!normalized || normalized.length > 100 || CONTROL_CHARS.test(normalized) || normalized.includes(':')) {
    fail('Frontmatter key contains unsafe characters')
  }
  return normalized
}

export function validateAbsoluteVaultPath(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || CONTROL_CHARS.test(value)) fail('Vault path must be a non-empty absolute path')
  const trimmed = value.trim()
  const normalized = trimmed.replace(/\\/g, '/')
  if (UNC.test(trimmed) || normalized.startsWith('//') || !(normalized.startsWith('/') || WINDOWS_ABSOLUTE.test(normalized))) fail('Vault path must be absolute')
  return normalized.replace(/\/+$/, '') || '/'
}

export function validateRelativeMarkdownPath(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || CONTROL_CHARS.test(value)) fail('Note path must be a non-empty relative path')
  const normalized = value.trim().replace(/\\/g, '/')
  if (normalized.startsWith('/') || WINDOWS_ABSOLUTE.test(normalized) || UNC.test(value) || ENCODED_SEPARATOR_OR_DOT.test(normalized)) fail('Note path must be relative')
  const segments = normalized.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) fail('Note path contains an unsafe segment')
  if (!normalized.toLowerCase().endsWith('.md')) fail('Only Markdown notes are allowed')
  return segments.join('/')
}

function normalizeForComparison(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeForComparison(root)
  const normalizedCandidate = normalizeForComparison(candidate)
  const windowsPath = WINDOWS_ABSOLUTE.test(normalizedRoot) || WINDOWS_ABSOLUTE.test(normalizedCandidate) || normalizedRoot.includes('\\') || normalizedCandidate.includes('\\')
  const left = windowsPath ? normalizedRoot.toLowerCase() : normalizedRoot
  const right = windowsPath ? normalizedCandidate.toLowerCase() : normalizedCandidate
  return right === left || right.startsWith(left + '/')
}

export function resolveVaultMarkdownPath(vaultRoot: string, candidate: string): string {
  const root = validateAbsoluteVaultPath(vaultRoot)
  const trimmed = candidate.trim()
  const isAbsolute = trimmed.startsWith('/') || WINDOWS_ABSOLUTE.test(trimmed) || UNC.test(trimmed)
  const resolved = isAbsolute ? trimmed.replace(/\\/g, '/') : root + '/' + validateRelativeMarkdownPath(trimmed)
  if (!isPathInside(root, resolved)) fail('Note path is outside the selected vault')
  if (!resolved.toLowerCase().endsWith('.md')) fail('Only Markdown notes are allowed')
  return resolved
}
