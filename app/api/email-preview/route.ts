import { NextResponse, type NextRequest } from 'next/server'
import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import { registrationReminderHtml, weeklyAllocationHtml, waitlistPromotionHtml } from '@/lib/resend'
import { format, nextMonday, addDays } from 'date-fns'
import type { Profile } from '@/types/db'

function buildHtml(type: string, weekStart: Date, weekLabel: string): string | null {
  if (type === 'reminder') {
    return registrationReminderHtml('Roi', weekLabel)
  }

  if (type === 'allocation') {
    const mon = format(weekStart, 'yyyy-MM-dd')
    const wed = format(addDays(weekStart, 2), 'yyyy-MM-dd')
    const thu = format(addDays(weekStart, 3), 'yyyy-MM-dd')
    return weeklyAllocationHtml(
      'Roi',
      [
        { date: mon, spotLabel: '39' },
        { date: wed, spotLabel: '39' },
        { date: thu, spotLabel: '39' },
      ],
      []
    )
  }

  if (type === 'allocation-waitlist') {
    const mon = format(weekStart, 'yyyy-MM-dd')
    const tue = format(addDays(weekStart, 1), 'yyyy-MM-dd')
    const fri = format(addDays(weekStart, 4), 'yyyy-MM-dd')
    return weeklyAllocationHtml(
      'Roi',
      [{ date: mon, spotLabel: '39' }],
      [tue, fri]
    )
  }

  if (type === 'waitlist-promotion') {
    const date = format(addDays(weekStart, 1), 'yyyy-MM-dd')
    return waitlistPromotionHtml('Roi', '41', date)
  }

  return null
}

const SUBJECT_MAP: Record<string, string> = {
  reminder: 'Parking Registration Open',
  allocation: 'Your Parking for Next Week',
  'allocation-waitlist': 'Your Parking + Waitlist',
  'waitlist-promotion': 'You Got a Spot!',
}

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: rawProfile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  const profile = rawProfile as Profile | null
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return null
}

export async function GET(request: NextRequest) {
  const adminError = await requireAdmin()
  if (adminError) return adminError

  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type') ?? 'reminder'
  const sendTo = searchParams.get('send')

  const weekStart = nextMonday(new Date())
  const weekLabel = format(weekStart, 'MMMM d, yyyy')

  const html = buildHtml(type, weekStart, weekLabel)

  if (!html) {
    return NextResponse.json({
      available: [
        '/api/email-preview?type=reminder',
        '/api/email-preview?type=allocation',
        '/api/email-preview?type=allocation-waitlist',
        '/api/email-preview?type=waitlist-promotion',
      ],
      send_param: 'Add &send=email@example.com to send a real email',
    })
  }

  if (sendTo) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error } = await resend.emails.send({
      from: 'Shield Parking <parking@shield-parking.com>',
      to: sendTo,
      subject: `[TEST] ${SUBJECT_MAP[type] ?? type}`,
      html,
    })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true, sent_to: sendTo, type })
  }

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
