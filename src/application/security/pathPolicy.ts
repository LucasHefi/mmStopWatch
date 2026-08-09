const ABSOLUTE_UNIX = /^\//
const ABSOLUTE_WINDOWS = /^[a-z]:(?:[\/]|$)/i
const UNC_PATH = /^\\(?:\\|\?\|\.\\)/
const ENCODED_SEPARATOR_OR_DOT = /%(?:2e|2f|5c)/i
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/

export function validateRelativeNotePath(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || CONTROL_CHAR.test(value)) throw new Error('Note path must be a non-empty relative path')
  const path = value.trim().replace(/\\/g, '/')
  if (!path || ABSOLUTE_UNIX.test(path) || ABSOLUTE_WINDOWS.test(path) || UNC_PATH.test(value) || ENCODED_SEPARATOR_OR_DOT.test(path)) throw new Error('Note path must be relative to the selected vault')
  const segments = path.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) throw new Error('Note path contains an unsafe segment')
  if (!path.toLowerCase().endsWith('.md')) throw new Error('Only Markdown notes are supported')
  return segments.join('/')
}
