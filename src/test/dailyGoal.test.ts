import { describe, expect, it } from 'vitest'
import { resolveDailyGoalMs } from '../services/stats'

describe('resolveDailyGoalMs', () => {
  it('preserves an explicit zero goal', () => {
    expect(resolveDailyGoalMs(0)).toBe(0)
  })

  it('uses the default only when the goal is absent', () => {
    expect(resolveDailyGoalMs(undefined)).toBe(28_800_000)
  })
})
