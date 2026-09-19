import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getDefaultAllocationWeekStart } from './allocationWeek'

describe('getDefaultAllocationWeekStart', () => {
  it('targets next Monday on Friday (summer WEST, cron hour)', () => {
    // 2026-09-18 07:00 UTC = Friday 08:00 Lisbon
    const now = new Date('2026-09-18T07:00:00Z')
    assert.equal(getDefaultAllocationWeekStart(now), '2026-09-21')
  })

  it('still targets that same Monday after a delayed Friday skip', () => {
    // 2026-09-18 12:01 UTC = Friday 13:01 Lisbon (hour 13, cron skipped)
    const now = new Date('2026-09-18T12:01:00Z')
    assert.equal(getDefaultAllocationWeekStart(now), '2026-09-21')
  })

  it('targets next Monday on Saturday and Sunday (weekend recovery)', () => {
    assert.equal(
      getDefaultAllocationWeekStart(new Date('2026-09-19T11:00:00Z')),
      '2026-09-21'
    )
    assert.equal(
      getDefaultAllocationWeekStart(new Date('2026-09-20T12:00:00Z')),
      '2026-09-21'
    )
  })

  it('targets the in-progress week on Monday after a missed Friday run', () => {
    // 2026-09-21 07:00 UTC = Monday 08:00 Lisbon
    // nextMonday() would return 2026-09-28 and allocate the wrong week.
    const now = new Date('2026-09-21T07:00:00Z')
    assert.equal(getDefaultAllocationWeekStart(now), '2026-09-21')
  })

  it('keeps Mon–Thu retries on the current parking week', () => {
    assert.equal(
      getDefaultAllocationWeekStart(new Date('2026-09-22T12:00:00Z')),
      '2026-09-21'
    )
    assert.equal(
      getDefaultAllocationWeekStart(new Date('2026-09-24T12:00:00Z')),
      '2026-09-21'
    )
  })

  it('targets next Monday on Friday in winter (WET = UTC)', () => {
    // 2026-01-09 08:00 UTC = Friday 08:00 Lisbon
    const now = new Date('2026-01-09T08:00:00Z')
    assert.equal(getDefaultAllocationWeekStart(now), '2026-01-12')
  })

  it('targets the in-progress week on a winter Monday', () => {
    const now = new Date('2026-01-12T08:00:00Z')
    assert.equal(getDefaultAllocationWeekStart(now), '2026-01-12')
  })
})
