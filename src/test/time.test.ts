import { describe, it, expect } from 'vitest'
import { formatTime, formatDuration, formatTimeShort, formatMsToTime } from '../utils/time'

describe('formatTime', () => {
  it('formats milliseconds to HH:mm:ss.cc', () => {
    expect(formatTime(0)).toBe('00:00:00.00')
    expect(formatTime(1000)).toBe('00:00:01.00')
    expect(formatTime(61000)).toBe('00:01:01.00')
    expect(formatTime(3661000)).toBe('01:01:01.00')
    expect(formatTime(3661100)).toBe('01:01:01.10')
  })
})

describe('formatDuration', () => {
  it('formats duration without centiseconds', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(1000)).toBe('0:01')
    expect(formatDuration(60000)).toBe('1:00')
    expect(formatDuration(3600000)).toBe('1:00:00')
    expect(formatDuration(3661000)).toBe('1:01:01')
  })
})

describe('formatTimeShort', () => {
  it('formats short time mm:ss.cc', () => {
    expect(formatTimeShort(0)).toBe('00:00.00')
    expect(formatTimeShort(1000)).toBe('00:01.00')
    expect(formatTimeShort(61000)).toBe('01:01.00')
  })
})

describe('formatMsToTime', () => {
  it('formats as HH:mm:ss when format matches', () => {
    expect(formatMsToTime(3661000, 'HH:mm:ss')).toBe('01:01:01')
    expect(formatMsToTime(0, 'HH:mm:ss')).toBe('00:00:00')
  })

  it('returns seconds when format does not match', () => {
    expect(formatMsToTime(3661000, 'seconds')).toBe('3661')
  })
})
