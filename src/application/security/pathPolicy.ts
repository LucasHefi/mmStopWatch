const ABSOLUTE_UNIX = /^\//
const ABSOLUTE_WINDOWS = /^[a-z]:([\\/]|$)/i
const UNC_PATH = /^\\\\/
const ENCODED_DOT_SEGMENT = /%2e/i

export function validateRelativeNotePath(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new Error('Note path must be a non-empty relative path')
  }

  const path = value.trim()
  if (
    !path ||
    ABSOLUTE_UNIX.test(path) ||
    ABSOLUTE_WINDOWS.test(path) ||
    UNC_PATH.test(path) ||
    ENCODED_DOT_SEGMENT.test(path)
  ) {
    throw new Error('Note path must be relative to the selected vault')
  }

  const segments = path.split(/[\\/]/)
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('Note path contains an unsafe segment')
  }

  return segments.join('/')
}
