import { NextResponse, type NextRequest } from 'next/server'
import {
  registrationReminderHtml,
  weeklyAllocationHtml,
  waitlistPromotionHtml,
  sendTestEmail,
} from '@/lib/resend'
import { createClient, createServiceClient } from '@/lib/supabase/server'
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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type') ?? 'reminder'
  const sendTo = searchParams.get('send')

  // ── Admin-only gate for ?send= ────────────────────────────────────────
  // The HTML preview without ?send stays public.  Sending a real email
  // (which would go out from our verified Resend domain) is restricted
  // to authenticated admins to prevent the endpoint being used as an
  // open relay for spoofed messages.
  //
  // Mirrors the admin-auth pattern in /api/allocate.  We return 403 in
  // both the unauthenticated and non-admin cases to avoid leaking
  // account state to anonymous callers.
  let adminUserId: string | null = null
  if (sendTo) {
    const userClient = await createClient()
    const { data: { user } } = await userClient.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: rawProfile } = await userClient
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    const profile = rawProfile as Profile | null
    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    adminUserId = user.id
  }

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
    // Use the shared sender so this test send goes through the same
    // FROM/replyTo conventions and lands in the email_log table just
    // like production sends do.
    const serviceClient = await createServiceClient()
    const summary = await sendTestEmail(serviceClient, adminUserId, {
      to:      sendTo,
      subject: `[TEST] ${SUBJECT_MAP[type] ?? type}`,
      html,
      type,
    })
    if (summary.failed > 0) {
      return NextResponse.json(
        { error: summary.errors[0]?.message ?? 'Send failed', email_summary: summary },
        { status: 500 }
      )
    }
    return NextResponse.json({ success: true, sent_to: sendTo, type, email_summary: summary })
  }

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
