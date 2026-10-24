import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isCronAllocationWindow } from './cron-window.ts'

const FRIDAY = 5

describe('isCronAllocationWindow', () => {
  it('accepts an on-time Friday allocation (08:00 Lisbon)', () => {
    assert.equal(isCronAllocationWindow(FRIDAY, 8, FRIDAY), true)
  })

  it('accepts the late Friday runs production skipped', () => {
    // 2026-09-11 11:59 UTC succeeded at Lisbon hour 12 (boundary of the old guard).
    assert.equal(isCronAllocationWindow(FRIDAY, 12, FRIDAY), true)
    // 2026-09-18 12:01 UTC and 2026-09-25 12:30 UTC skipped at Lisbon hour 13.
    assert.equal(isCronAllocationWindow(FRIDAY, 13, FRIDAY), true)
    // 2026-08-28 19:12 UTC skipped at Lisbon hour 20.
    assert.equal(isCronAllocationWindow(FRIDAY, 20, FRIDAY), true)
    assert.equal(isCronAllocationWindow(FRIDAY, 23, FRIDAY), true)
  })

  it('keeps the existing 06:00 lower bound, including the winter 07:00 slot', () => {
    assert.equal(isCronAllocationWindow(FRIDAY, 5, FRIDAY), false)
    assert.equal(isCronAllocationWindow(FRIDAY, 6, FRIDAY), true)
    assert.equal(isCronAllocationWindow(FRIDAY, 7, FRIDAY), true)
  })

  it('does not run on other weekdays, even inside the hour range', () => {
    for (const day of [0, 1, 2, 3, 4, 6]) {
      assert.equal(isCronAllocationWindow(day, 8, FRIDAY), false)
      assert.equal(isCronAllocationWindow(day, 13, FRIDAY), false)
    }
  })
})
