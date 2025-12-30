// Local storage helpers for persisting application configuration
interface AppConfig {
  host: string
  username: string
  port: number
  applicationName: string
  domain?: string
  pathname?: string
  githubToken?: string
  selectedRepo?: string
  privateKeyContent?: string
  createdAt?: string
}

const STORAGE_KEY_PREFIX = 'effortless_app_'
const STORAGE_ACTIVE_KEY = 'effortless_active_app'
const STORAGE_APPS_KEY = 'effortless_apps_list'

export const storage = {
  // Save application config
  saveApp(config: AppConfig) {
    const key = `${STORAGE_KEY_PREFIX}${config.host}_${config.username}_${config.applicationName}`
    const data = {
      ...config,
      createdAt: config.createdAt || new Date().toISOString(),
    }
    localStorage.setItem(key, JSON.stringify(data))

    // Add to apps list if not already there
    const appsList = this.getAppsList()
    if (!appsList.find((a) => a.key === key)) {
      appsList.push({
        key,
        label: `${config.applicationName} — ${config.username}@${config.host}:${config.port}`,
        host: config.host,
        username: config.username,
        applicationName: config.applicationName,
      })
      localStorage.setItem(STORAGE_APPS_KEY, JSON.stringify(appsList))
    }

    // Set as active
    this.setActiveApp(key)
  },

  // Get application config
  getApp(key: string): AppConfig | null {
    const data = localStorage.getItem(key)
    return data ? JSON.parse(data) : null
  },

  // Get all saved apps
  getAppsList(): Array<{
    key: string
    label: string
    host: string
    username: string
    applicationName: string
  }> {
    const data = localStorage.getItem(STORAGE_APPS_KEY)
    return data ? JSON.parse(data) : []
  },

  // Set active app
  setActiveApp(key: string) {
    localStorage.setItem(STORAGE_ACTIVE_KEY, key)
  },

  // Get active app
  getActiveApp(): AppConfig | null {
    const key = localStorage.getItem(STORAGE_ACTIVE_KEY)
    return key ? this.getApp(key) : null
  },

  // Get active app key
  getActiveAppKey(): string | null {
    return localStorage.getItem(STORAGE_ACTIVE_KEY)
  },

  // Delete app
  deleteApp(key: string) {
    localStorage.removeItem(key)
    const appsList = this.getAppsList().filter((a) => a.key !== key)
    localStorage.setItem(STORAGE_APPS_KEY, JSON.stringify(appsList))
    if (this.getActiveAppKey() === key) {
      localStorage.removeItem(STORAGE_ACTIVE_KEY)
    }
  },

  // Clear all
  clear() {
    const keys = Object.keys(localStorage).filter((k) =>
      k.startsWith(STORAGE_KEY_PREFIX),
    )
    keys.forEach((k) => localStorage.removeItem(k))
    localStorage.removeItem(STORAGE_APPS_KEY)
    localStorage.removeItem(STORAGE_ACTIVE_KEY)
  },
}

// Session configuration state
export interface SessionConfig {
  host: string
  username: string
  port: number
  privateKeyContent: string
  applicationName: string
  githubToken?: string
  selectedRepo?: string
  domain?: string
  pathname?: string
}

// Application step status
export interface StepStatus {
  name: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  message?: string
  duration?: number
  data?: any
}

// Helper function to format step names for display
export function formatStepName(step: string): string {
  return step.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}
