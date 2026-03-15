import type { Team } from '@/types/db'

export const TEAM_DAY_MAP: Record<string, Team[]> = {
  monday: ['cs'],
  tuesday: ['cloudops', 'pm', 'sm'],
  wednesday: ['marketing', 'data_sources'],
  thursday: ['devops'],
  friday: ['app_team'],
}

export const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const

export const DAY_LABELS: Record<string, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
}

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const

export const TEAM_LABELS: Record<Team, string> = {
  cs: 'CS Team',
  cloudops: 'CloudOps',
  pm: 'PMs',
  sm: 'SMs',
  marketing: 'Marketing',
  data_sources: 'Data Sources',
  devops: 'DevOps',
  app_team: 'App Team',
}

export const VEHICLE_LABELS: Record<string, string> = {
  car: 'Car',
  electric: 'Electric Vehicle',
  motorcycle: 'Motorcycle',
}

export const SPOT_LABELS = ['1', '2', '37', '38', '39', '40', '41', '48', '49', '51'] as const

export const LISBON_TIMEZONE = 'Europe/Lisbon'

export const REQUEST_OPEN_DAY = 3 // Wednesday (0=Sun)
export const REQUEST_OPEN_HOUR = 19 // 19:00

export const MAX_DAYS_PER_USER = 3
