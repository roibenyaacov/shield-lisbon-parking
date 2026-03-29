# Shield Lisbon Parking — App Logic

## Overview

Shield Lisbon Parking is a weekly parking spot management system for the Shield Portugal office. It manages **10 parking spots** across employees, using a **fair allocation algorithm** that runs every Friday. The app is built with **Next.js 16**, **Supabase** (auth + database), **Resend** (emails), and deployed on **Vercel**.

---

## Parking Spots

| Spot | Priority | Notes |
|------|----------|-------|
| #1 | Motorcycle | Reassigned to cars if no motorcycles apply |
| #2 | General | — |
| #37 | EV | Electric vehicle charging |
| #38 | EV | Electric vehicle charging |
| #39 | General | **Fixed** — Raíssa Ramos (`raissa.ramos@shieldfc.com`) |
| #40 | General | — |
| #41 | General | — |
| #48 | General | — |
| #49 | General | **Fixed** — Rita Vaz (`rita.vaz@shieldfc.com`) |
| #51 | General | — |

Fixed spot users are auto-assigned upon signup via a database trigger that matches their email.

---

## Team Priority Schedule

Each team has a designated "priority day" where they get first access to spots:

| Day | Priority Teams |
|-----|---------------|
| Monday | CS |
| Tuesday | CloudOps, PMs, SMs |
| Wednesday | Marketing, Data Sources |
| Thursday | DevOps |
| Friday | App Team |

---

## Weekly Flow

```
Wed 19:00 ─── Registration Opens ──► Thu all day ──► Fri 08:00 ─── Registration Closes
                                                          │
                                                          ▼
                                                   Allocation Algorithm Runs
                                                   (Vercel Cron Job)
                                                          │
                                                          ▼
                                                   Emails Sent to All Users
                                                          │
                                                          ▼
                                              Mon-Fri ─── Parking Week Begins
```

### Registration (Wednesday 19:00 → Friday 08:00, Lisbon time)

- Users select which days they need parking next week (max 3 days)
- Users can edit their request while registration is open
- After Friday 08:00, registration locks — no more edits

### Allocation (Friday 08:00, automatic via Vercel Cron)

The fair allocation algorithm runs and assigns spots. See "Allocation Algorithm" below.

### Post-Allocation (Friday 08:00 → Wednesday 19:00)

- Dashboard shows "Registration Closed" with a lock icon
- Users can view their allocated spots in the weekly view
- If someone releases a spot, the waitlist is automatically promoted

---

## Allocation Algorithm (3-Pass Fair System)

**File:** `lib/allocation.ts`

For each day of the week (Monday–Friday):

### Pre-step: Fixed Spots
Spots #39 and #49 are assigned to their fixed users (unless they released the day via the My Spot toggle).

### Pass 1 — Team Day Priority
Users whose team matches the day's priority get their **1st spot** assigned. Sorted by registration timestamp (FCFS within the team).

### Pass 2 — FCFS for Everyone Else
Remaining users who requested that day get their **1st spot** by first-come-first-served. Team day users who weren't assigned in Pass 1 are also included here.

### Pass 3a — 2nd Day
Users who have exactly 1 day assigned get a **2nd day**, prioritizing team day users first.

### Pass 3b — 3rd Day (Equity Check)
A 3rd day is only assigned if **no user in the request pool has 0 days**. This ensures fair distribution — nobody gets 3 days while someone else has 0.

### Spot Selection Logic (`pickSpot`)
- EV users get EV spots (#37, #38) first
- Motorcycle users get the motorcycle spot (#1) first
- General spots are assigned by lowest label number
- If preferred spots are taken, any available spot is assigned

### Waitlist
Users who requested a day but didn't get assigned are placed on the waitlist for that day, ordered by registration timestamp.

### Cap
Maximum **3 days per user per week**.

---

## Auth Flow

### Signup
1. User enters email, password, full name, team, vehicle type
2. Supabase creates account with metadata
3. 6-digit OTP code sent via email
4. User enters OTP on the same page
5. On verification, profile is created via database trigger (`handle_new_user`)
6. If email matches a fixed spot user, the spot is auto-assigned
7. Redirect to `/dashboard`

### Login
1. Email + password sign-in via `supabase.auth.signInWithPassword`
2. Redirect to `/dashboard`

### Forgot Password
1. User enters email on `/forgot-password`
2. Reset link sent via Supabase
3. User clicks link → `/reset-password`
4. User sets new password

### Route Protection (`proxy.ts`)
- **Public routes:** `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/api/auth/callback`
- Unauthenticated users on protected routes → redirect to `/login`
- Authenticated users on login/signup → redirect to `/dashboard`
- Authenticated users without completed profile → redirect to `/profile-setup`

---

## Pages

### `/dashboard` — Main Dashboard (Regular Users)
- **Hero Card:** Shows today's (or next upcoming) parking spot in a large card with spot number, date, and checkmark
- **Week View:** Lists Monday–Friday with spot numbers, waitlist status, or "No spot" per day
- **Expandable Grid:** Tap any day to see a 4-column grid of all 10 spots (available in green, taken in gray, yours in blue)
- **Week Navigation:** Arrows to browse This Week / Next Week (up to 4 weeks ahead)
- **Request Form:** Below the week view, shows one of three states:
  - *Not Open:* Countdown timer to Wednesday 19:00
  - *Open:* Day selection form (max 3 days, team day highlighted)
  - *Closed:* Lock icon + "Allocations have been published"
- Fixed spot users are **redirected to `/my-spot`**

### `/my-spot` — Fixed Spot Users (Raíssa & Rita)
- Shows their assigned spot number and label
- **Daily Toggle:** For each day, tap to switch between "Coming" and "Not coming"
- **Week Navigation:** Browse current week and up to 4 weeks ahead
- Past days are disabled
- Releasing a day removes their allocation and promotes the first waitlist user
- Reclaiming a day re-inserts their allocation

### `/login` — Sign In
- Email + password form with "Forgot password?" link

### `/signup` — Create Account
- Multi-field form: email, password, full name, team, vehicle type
- OTP verification step after submission

### `/forgot-password` — Request Password Reset
- Email input, sends reset link

### `/reset-password` — Set New Password
- New password + confirmation, redirects to dashboard

### `/profile-setup` — Complete Profile
- Team and vehicle type selection (shown if profile is incomplete after auth)

---

## API Routes

### `POST /api/allocate` & `GET /api/allocate`
**Auth:** `Authorization: Bearer <CRON_SECRET>` or logged-in admin user.

Runs the full allocation algorithm for the next week:
1. Fetches all spots, requests, profiles, and releases
2. Runs 3-pass allocation
3. Saves allocations and waitlist to database
4. Sends email notifications to all affected users

POST accepts optional `{ week_start: "YYYY-MM-DD" }` to override target week.

**Vercel Cron:** Configured to call GET every Friday at 08:00 UTC (`vercel.json`).

### `POST /api/release`
**Auth:** Logged-in user (must match `user_id` in body).

**Body:** `{ date, spot_id, user_id, action? }`

- `action === 'reclaim'`: Re-inserts the user's allocation for that date/spot
- Default (release): Deletes the allocation; if waitlist exists for that date, promotes the first person (FIFO), assigns them the spot, and sends a notification email

### `GET /api/auth/callback`
Handles Supabase auth redirects:
- PKCE code exchange (`?code=...`)
- OTP/magic link verification (`?token_hash=...&type=...`)
- Redirects to `/dashboard` on success, `/login?error=...` on failure

---

## Email Notifications

**Service:** Resend (`lib/resend.ts`)

All emails use a consistent template with Shield branding (dark gradient header, logo, rounded card body, footer).

| Email | When | Content |
|-------|------|---------|
| **Parking Confirmed** | Friday allocation | Table of assigned days + spot numbers, "Open in app" button |
| **Waitlisted** | Friday allocation (no spots) | List of waitlisted days, "you'll be notified if a spot opens" |
| **Waitlist Promotion** | Spot released mid-week | Spot number + date, "automatically moved from waitlist" |
| **OTP Code** | Signup | 6-digit verification code (Supabase template) |
| **Password Reset** | Forgot password | Reset link (Supabase template) |

---

## Database Schema

**File:** `supabase/migrations/001_initial_schema.sql`

### Tables

#### `profiles`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | References `auth.users` |
| full_name | text | — |
| email | text | — |
| team | team_enum | cs, cloudops, pm, sm, marketing, data_sources, devops, app_team |
| vehicle_type | vehicle_type_enum | car, electric, motorcycle |
| role | user_role | admin, user (default: user) |
| is_active | boolean | default: true |
| created_at | timestamptz | — |
| updated_at | timestamptz | — |

#### `parking_spots`
| Column | Type | Notes |
|--------|------|-------|
| id | serial (PK) | — |
| label | text | Spot number displayed to users |
| priority | spot_priority_enum | ev, motorcycle, general |
| is_active | boolean | default: true |
| fixed_user_id | uuid (FK) | References profiles; null for non-fixed spots |

#### `weekly_requests`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | — |
| user_id | uuid (FK) | — |
| week_start | date | Monday of the requested week |
| mon–fri | boolean | One column per day |
| created_at | timestamptz | Used for FCFS ordering |
| **Unique** | | `(user_id, week_start)` |

#### `weekly_allocations`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | — |
| user_id | uuid (FK) | — |
| spot_id | integer (FK) | — |
| date | date | Specific day |
| pass_number | integer | 0=fixed, 1=team day, 2=FCFS, 3=fill-up, 4=waitlist promotion |
| created_at | timestamptz | — |
| **Unique** | | `(spot_id, date)` — one user per spot per day |

#### `waitlist`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | — |
| user_id | uuid (FK) | — |
| date | date | — |
| created_at | timestamptz | FIFO ordering |
| **Unique** | | `(user_id, date)` |

#### `spot_releases`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | — |
| user_id | uuid (FK) | — |
| spot_id | integer (FK) | — |
| week_start | date | — |
| created_at | timestamptz | — |

### Database Trigger: `handle_new_user`
Fires on `INSERT` to `auth.users`:
1. Creates a profile row with `full_name` and `email` from user metadata
2. If email is `raissa.ramos@shieldfc.com` → sets `fixed_user_id` on spot #39
3. If email is `rita.vaz@shieldfc.com` → sets `fixed_user_id` on spot #49

### Row Level Security (RLS)
- All tables have RLS enabled
- Users can read/write their own data
- Service role has full access for allocation operations

### Realtime
Supabase Realtime is enabled for `weekly_allocations` and `waitlist` tables, powering live dashboard updates.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email/password + OTP) |
| Email | Resend |
| Styling | Tailwind CSS v4 |
| Animations | Framer Motion |
| Icons | Lucide React |
| Toasts | react-hot-toast |
| Deployment | Vercel (with Cron Jobs) |
| Timezone | Europe/Lisbon |

---

## Key Files Reference

```
├── app/
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Redirect to /dashboard
│   ├── dashboard/page.tsx      # Main user dashboard
│   ├── my-spot/page.tsx        # Fixed spot user page
│   ├── request/page.tsx        # Standalone request form
│   ├── login/page.tsx          # Sign in
│   ├── signup/page.tsx         # Create account
│   ├── forgot-password/page.tsx
│   ├── reset-password/page.tsx
│   ├── profile-setup/page.tsx
│   └── api/
│       ├── allocate/route.ts   # Allocation endpoint (GET/POST)
│       ├── release/route.ts    # Release/reclaim spots (POST)
│       └── auth/callback/route.ts
├── components/
│   ├── dashboard/
│   │   ├── MyWeek.tsx          # User's weekly parking view
│   │   ├── MySpotManager.tsx   # Fixed spot toggle UI
│   │   ├── SignOutButton.tsx
│   │   ├── WeeklyGrid.tsx      # Admin grid (unused)
│   │   └── SpotCell.tsx        # Grid cell component
│   ├── forms/
│   │   ├── LoginForm.tsx
│   │   ├── SignupForm.tsx      # Multi-step with OTP
│   │   ├── ProfileForm.tsx
│   │   └── RequestForm.tsx     # Day selection + countdown
│   ├── layout/
│   │   ├── Shell.tsx
│   │   └── Navbar.tsx
│   └── ui/
│       ├── Button.tsx
│       ├── Card.tsx
│       └── Input.tsx
├── lib/
│   ├── allocation.ts           # Fair allocation algorithm
│   ├── resend.ts               # Email templates + sending
│   ├── constants.ts            # Teams, days, config
│   ├── utils.ts                # cn() helper
│   └── supabase/
│       ├── client.ts           # Browser client
│       └── server.ts           # Server + service role clients
├── types/
│   └── db.ts                   # All TypeScript types
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql
├── proxy.ts                    # Route protection middleware
├── vercel.json                 # Cron job config
└── .env.local                  # Environment variables (not in git)
```

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key (client-side) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only) |
| `RESEND_API_KEY` | Resend API key for sending emails |
| `CRON_SECRET` | Secret token to authenticate Vercel Cron calls |
