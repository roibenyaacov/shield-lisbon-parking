import assert from 'node:assert/strict'
import test from 'node:test'
import { isReminderCronWindow } from '../lib/reminder-window.ts'

// Local components only. The predicate reads getDay/getHours, which return
// the same numbers the Lisbon-zoned Date exposes in production.
function wallClock(year, month, day, hour, minute = 0) {
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

test('Wednesday afternoon through Thursday is inside the reminder window', () => {
  const wednesdayAfternoon = wallClock(2026, 11, 25, 15, 0)
  const scheduledWinter = wallClock(2026, 11, 25, 17, 0)
  const scheduledSummerLisbon = wallClock(2026, 11, 25, 18, 0)
  const wednesdayLate = wallClock(2026, 11, 25, 23, 18)
  // 2026-11-26 00:52 Lisbon. GitHub run 45731794019 was skipped here.
  const thursdayAfterMidnight = wallClock(2026, 11, 26, 0, 52)
  const thursdayEvening = wallClock(2026, 11, 26, 23, 59)

  assert.equal(wednesdayAfternoon.getDay(), 3)
  assert.equal(thursdayAfterMidnight.getDay(), 4)

  assert.equal(isReminderCronWindow(wednesdayAfternoon), true)
  assert.equal(isReminderCronWindow(scheduledWinter), true)
  assert.equal(isReminderCronWindow(scheduledSummerLisbon), true)
  assert.equal(isReminderCronWindow(wednesdayLate), true)
  assert.equal(isReminderCronWindow(thursdayAfterMidnight), true)
  assert.equal(isReminderCronWindow(thursdayEvening), true)
})

test('before Wednesday 15:00 and from Friday onward the cron stays skipped', () => {
  assert.equal(isReminderCronWindow(wallClock(2026, 11, 25, 14, 59)), false)
  assert.equal(isReminderCronWindow(wallClock(2026, 11, 25, 0, 52)), false)
  assert.equal(isReminderCronWindow(wallClock(2026, 11, 24, 17, 0)), false)
  assert.equal(isReminderCronWindow(wallClock(2026, 11, 27, 0, 0)), false)
  assert.equal(isReminderCronWindow(wallClock(2026, 11, 27, 7, 0)), false)
  assert.equal(isReminderCronWindow(wallClock(2026, 11, 28, 12, 0)), false)
})
