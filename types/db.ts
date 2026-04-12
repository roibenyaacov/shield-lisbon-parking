/**
 * Shield Lisbon Parking - Database Types
 */

// ============================================
// ENUMS
// ============================================

export type Team =
  | 'cs'
  | 'cloudops'
  | 'pm'
  | 'sm'
  | 'marketing'
  | 'data_sources'
  | 'devops'
  | 'app_team'

export type VehicleType = 'car' | 'electric' | 'motorcycle'

export type UserRole = 'admin' | 'user'

export type SpotPriority = 'ev' | 'motorcycle' | 'general'

// ============================================
// ROW TYPES (use `type` for index-signature compat)
// ============================================

export type Profile = {
  id: string
  full_name: string | null
  email: string | null
  team: Team | null
  vehicle_type: VehicleType | null
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
}

export type ParkingSpot = {
  id: number
  label: string
  priority: SpotPriority
  is_active: boolean
  fixed_user_id: string | null
  reserved_name: string | null
}

export type WeeklyRequest = {
  id: string
  user_id: string
  week_start: string
  mon: boolean
  tue: boolean
  wed: boolean
  thu: boolean
  fri: boolean
  created_at: string
}

export type WeeklyAllocation = {
  id: string
  user_id: string
  spot_id: number
  date: string
  pass_number: number
  created_at: string
}

export type Waitlist = {
  id: string
  user_id: string
  date: string
  created_at: string
}

export type SpotRelease = {
  id: string
  user_id: string
  spot_id: number
  week_start: string
  created_at: string
}

// ============================================
// INSERT TYPES
// ============================================

export type ProfileInsert = {
  id: string
  full_name?: string | null
  email?: string | null
  team?: Team | null
  vehicle_type?: VehicleType | null
  role?: UserRole
}

export type WeeklyRequestInsert = {
  id?: string
  user_id: string
  week_start: string
  mon?: boolean
  tue?: boolean
  wed?: boolean
  thu?: boolean
  fri?: boolean
}

export type WeeklyAllocationInsert = {
  id?: string
  user_id: string
  spot_id: number
  date: string
  pass_number?: number
}

export type WaitlistInsert = {
  id?: string
  user_id: string
  date: string
}

export type SpotReleaseInsert = {
  id?: string
  user_id: string
  spot_id: number
  week_start: string
}

// ============================================
// UPDATE TYPES
// ============================================

export type ProfileUpdate = {
  full_name?: string | null
  email?: string | null
  team?: Team | null
  vehicle_type?: VehicleType | null
  role?: UserRole
  is_active?: boolean
}

export type WeeklyRequestUpdate = {
  mon?: boolean
  tue?: boolean
  wed?: boolean
  thu?: boolean
  fri?: boolean
}

// ============================================
// JOINED / EXPANDED TYPES
// ============================================

export type AllocationWithDetails = WeeklyAllocation & {
  spot: ParkingSpot
  user: Profile
}

export type WaitlistWithUser = Waitlist & {
  user: Profile
}

export type SpotWithFixedUser = ParkingSpot & {
  fixed_user: Profile | null
}

// ============================================
// SUPABASE DATABASE TYPE
// ============================================

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: ProfileInsert
        Update: ProfileUpdate
        Relationships: []
      }
      parking_spots: {
        Row: ParkingSpot
        Insert: {
          id?: number
          label: string
          priority?: SpotPriority
          is_active?: boolean
          fixed_user_id?: string | null
          reserved_name?: string | null
        }
        Update: {
          label?: string
          priority?: SpotPriority
          is_active?: boolean
          fixed_user_id?: string | null
          reserved_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'parking_spots_fixed_user_id_fkey'
            columns: ['fixed_user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      weekly_requests: {
        Row: WeeklyRequest
        Insert: WeeklyRequestInsert
        Update: WeeklyRequestUpdate
        Relationships: [
          {
            foreignKeyName: 'weekly_requests_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      weekly_allocations: {
        Row: WeeklyAllocation
        Insert: WeeklyAllocationInsert
        Update: Partial<WeeklyAllocation>
        Relationships: [
          {
            foreignKeyName: 'weekly_allocations_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'weekly_allocations_spot_id_fkey'
            columns: ['spot_id']
            isOneToOne: false
            referencedRelation: 'parking_spots'
            referencedColumns: ['id']
          }
        ]
      }
      waitlist: {
        Row: Waitlist
        Insert: WaitlistInsert
        Update: Partial<Waitlist>
        Relationships: [
          {
            foreignKeyName: 'waitlist_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      spot_releases: {
        Row: SpotRelease
        Insert: SpotReleaseInsert
        Update: Partial<SpotRelease>
        Relationships: [
          {
            foreignKeyName: 'spot_releases_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'spot_releases_spot_id_fkey'
            columns: ['spot_id']
            isOneToOne: false
            referencedRelation: 'parking_spots'
            referencedColumns: ['id']
          }
        ]
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      team_enum: Team
      vehicle_type_enum: VehicleType
      user_role: UserRole
      spot_priority_enum: SpotPriority
    }
  }
}
