import { describe, expect, it } from 'vitest'
import { isPathInside, UnsafePathError, validateProfileKey, validateRelativeMarkdownPath } from '../services/pathSecurity'

describe('path security', () => {
  it('normalizes safe relative markdown paths', () => expect(validateRelativeMarkdownPath('Projects\\Note.md')).toBe('Projects/Note.md'))
  it('rejects traversal and absolute paths', () => {
    for (const value of ['../secret.md', '/tmp/secret.md', 'C:\\secret.md', '\\\\server\\share\\note.md', 'foo.txt', 'a/%2e%2e/secret.md', 'a/%2fsecret.md', 'a/\u0001.md']) expect(() => validateRelativeMarkdownPath(value)).toThrow(UnsafePathError)
  })
  it('validates profile keys', () => {
    expect(validateProfileKey(' alice ')).toBe('alice')
    expect(() => validateProfileKey('../alice')).toThrow(UnsafePathError)
  })
  it('checks path containment', () => {
    expect(isPathInside('D:/vault', 'D:/vault/Projects/note.md')).toBe(true)
    expect(isPathInside('D:/vault', 'D:/vault-evil/note.md')).toBe(false)
  })
})
