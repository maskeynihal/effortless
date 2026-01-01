import { useMutation, useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { api, API_URL } from '../api'

type Connections = {
  ssh?: {
    connected?: boolean
    host?: string
    username?: string
    error?: string
  }
  github?: {
    connected?: boolean
    username?: string | null
    error?: string | null
  } | null
}

type StepLog = {
  id: number
  step: string
  status: string
  message?: string | null
  createdAt: string
}

// API_URL and api are provided by the shared client in '@/lib/api'

// Verify SSH & GitHub connection
export function useVerifyConnection() {
  return useMutation({
    mutationFn: async (payload: {
      host: string
      username: string
      port: number
      privateKeyContent: string
      githubToken?: string
      applicationName: string
    }) => {
      const { data } = await api.post('/connection/verify', payload)
      if (data?.success === false) {
        throw new Error(data.error || data.message || 'Request failed')
      }
      return data as {
        message: string
        sessionId: string
        connections: Connections
      }
    },
  })
}

// Check GitHub token validity via backend
export function useCheckGithubToken() {
  return useMutation({
    mutationFn: async (payload: {
      githubToken: string
      host: string
      username: string
      applicationName: string
    }) => {
      const { data } = await api.post('/step/check-github-token', payload)
      if (data?.success === false) {
        throw new Error(data.error || 'Token is invalid')
      }
      return data.data as { login: string; name: string }
    },
  })
}

// Load GitHub repositories
export function useLoadRepositories() {
  return useMutation({
    mutationFn: async (token: string) => {
      const { data } = await axios.get(
        'https://api.github.com/user/repos?per_page=100&sort=updated',
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
          },
        },
      )
      const repos = (data as Array<{ full_name?: string }>)
        .map((r) => r.full_name)
        .filter(Boolean)
      return repos as string[]
    },
  })
}

// Register deploy key
export function useRegisterDeployKey() {
  return useMutation({
    mutationFn: async (payload: {
      host: string
      username: string
      applicationName: string
      selectedRepo: string
    }) => {
      const { data } = await api.post('/step/deploy-key', payload)
      if (data?.success === false) {
        throw new Error(data.error || data.message || 'Request failed')
      }
      return data
    },
  })
}

// Create database
export function useCreateDatabase() {
  return useMutation({
    mutationFn: async (payload: {
      host: string
      username: string
      applicationName: string
      dbType: string
      dbName: string
      dbUsername: string
      dbPassword: string
      dbPort: number
    }) => {
      const { data } = await api.post('/step/database-create', payload)
      if (data?.success === false) {
        throw new Error(data.error || data.message || 'Request failed')
      }
      return data
    },
  })
}

// Setup folder
export function useSetupFolder() {
  return useMutation({
    mutationFn: async (payload: {
      host: string
      username: string
      applicationName: string
      pathname: string
    }) => {
      const { data } = await api.post('/step/folder-setup', payload)
      if (data?.success === false) {
        throw new Error(data.error || data.message || 'Request failed')
      }
      return data
    },
  })
}

// Setup .env
export function useSetupEnv() {
  return useMutation({
    mutationFn: async (payload: {
      host: string
      username: string
      applicationName: string
      pathname: string
      selectedRepo?: string
    }) => {
      const { data } = await api.post('/step/env-setup', payload)
      if (data?.success === false) {
        throw new Error(data.error || data.message || 'Request failed')
      }
      return data
    },
  })
}

// Update .env
export function useUpdateEnv() {
  return useMutation({
    mutationFn: async (payload: {
      host: string
      username: string
      applicationName: string
      pathname: string
      dbType: string
      dbPort: number
      dbName: string
      dbUsername: string
      dbPassword: string
    }) => {
      const { data } = await api.post('/step/env-update', payload)
      if (data?.success === false) {
        throw new Error(data.error || data.message || 'Request failed')
      }
      return data
    },
  })
}

// Setup SSH key
export function useSetupSSHKey() {
  return useMutation({
    mutationFn: async (payload: {
      host: string
      username: string
      applicationName: string
      selectedRepo: string
    }) => {
      const { data } = await api.post('/step/ssh-key-setup', payload)
      if (data?.success === false) {
        throw new Error(data.error || data.message || 'Request failed')
      }
      return data
    },
  })
}

// Deploy workflow PR
export function useDeployWorkflow() {
  return useMutation({
    mutationFn: async (payload: {
      host: string
      username: string
      applicationName: string
      selectedRepo: string
      baseBranch: string
      sshPath: string
    }) => {
      const { data } = await api.post('/step/deploy-workflow-update', payload)
      if (data?.success === false) {
        throw new Error(data.error || data.message || 'Request failed')
      }
      return data
    },
  })
}

// Fetch step logs
export function useStepLogs(
  host: string,
  username: string,
  applicationName: string,
) {
  return useQuery({
    queryKey: ['steps', host, username, applicationName],
    queryFn: async () => {
      if (!host || !username || !applicationName) return []
      const { data } = await api.get(
        `/steps/${encodeURIComponent(host)}/${encodeURIComponent(username)}/${encodeURIComponent(applicationName)}`,
      )
      return (data?.success ? data.steps : []) as StepLog[]
    },
    enabled: Boolean(host && username && applicationName),
    refetchInterval: 5000,
  })
}

// Fetch all applications
export function useListApplications() {
  return useQuery({
    queryKey: ['applications'],
    queryFn: async () => {
      const { data } = await api.get('/applications')
      if (data?.success === false) {
        throw new Error(data.error || 'Failed to load applications')
      }
      return data.data as Array<{
        id: number
        sessionId: string
        host: string
        username: string
        applicationName: string
        status: string
        createdAt: string
        githubUsername?: string | null
        selectedRepo?: string | null
        pathname?: string | null
      }>
    },
  })
}

// Fetch application by ID
export function useGetApplication(applicationId: number | null) {
  return useQuery({
    queryKey: ['application', applicationId],
    queryFn: async () => {
      if (!applicationId) return null
      const { data } = await api.get(`/applications/${applicationId}`)
      if (data?.success === false) {
        throw new Error(data.error || 'Failed to load application')
      }
      return data.data as {
        id: number
        sessionId: string
        host: string
        username: string
        port: number
        applicationName: string
        status: string
        createdAt: string
        githubUsername?: string | null
        githubToken?: string | null
        selectedRepo?: string | null
        pathname?: string | null
        domain?: string | null
        phpVersion?: string | null
        dbType?: string | null
      }
    },
    enabled: !!applicationId,
  })
}

// List GitHub repos via backend using stored token
export function useListReposFromBackend(params: {
  host: string
  username: string
  applicationName: string
}) {
  const { host, username, applicationName } = params
  return useQuery({
    queryKey: ['githubRepos', host, username, applicationName],
    queryFn: async () => {
      const { data } = await api.get('/github/repos', {
        params: { host, username, applicationName },
      })
      if (data?.success === false) {
        throw new Error(data.error || 'Failed to load repositories')
      }
      return (data.data || []) as Array<{
        id: number
        name: string
        full_name: string
        private: boolean
        html_url: string
        default_branch: string
        updated_at: string
      }>
    },
    enabled: Boolean(host && username && applicationName),
  })
}

// Fetch GitHub repos via backend on demand (mutation)
export function useFetchReposFromBackend() {
  return useMutation({
    mutationFn: async (payload: {
      host: string
      username: string
      applicationName: string
    }) => {
      const { data } = await api.get('/github/repos', { params: payload })
      if (data?.success === false) {
        throw new Error(data.error || 'Failed to load repositories')
      }
      return (data.data || []) as Array<{
        id: number
        name: string
        full_name: string
        private: boolean
        html_url: string
        default_branch: string
        updated_at: string
      }>
    },
  })
}

// Persist selected repo to application
export function useSelectRepo() {
  return useMutation({
    mutationFn: async (payload: {
      applicationId: number
      selectedRepo: string
    }) => {
      const { data } = await api.post(
        `/applications/${payload.applicationId}/select-repo`,
        {
          selectedRepo: payload.selectedRepo,
        },
      )
      if (data?.success === false) {
        throw new Error(data.error || 'Failed to save selected repo')
      }
      return data.data as { id: number; selectedRepo: string }
    },
  })
}

// Save database configuration
export function useSaveDatabaseConfig() {
  return useMutation({
    mutationFn: async (payload: {
      applicationId: number
      dbType: string
      dbName: string
      dbUsername: string
      dbPassword: string
      dbPort?: number
    }) => {
      const { data } = await api.post(
        `/applications/${payload.applicationId}/database-config`,
        {
          dbType: payload.dbType,
          dbName: payload.dbName,
          dbUsername: payload.dbUsername,
          dbPassword: payload.dbPassword,
          dbPort: payload.dbPort,
        },
      )
      if (data?.success === false) {
        throw new Error(data.error || 'Failed to save database config')
      }
      return data.data as {
        dbType: string
        dbName: string
        dbUsername: string
        dbPort?: number
      }
    },
  })
}

// Get database configuration
export function useGetDatabaseConfig(applicationId: number | null) {
  return useQuery({
    queryKey: ['databaseConfig', applicationId],
    queryFn: async () => {
      if (!applicationId) return null
      const { data } = await api.get(
        `/applications/${applicationId}/database-config`,
      )
      if (data?.success === false) {
        throw new Error(data.error || 'Failed to load database config')
      }
      return (data.data || null) as {
        dbType: string
        dbName: string
        dbUsername: string
        dbPassword: string
        dbPort?: number
      } | null
    },
    enabled: !!applicationId,
  })
}

// Create a new application
export function useCreateApplication() {
  return useMutation({
    mutationFn: async (payload: {
      host: string
      username: string
      port: number
      applicationName: string
    }) => {
      const { data } = await api.post('/applications', payload)
      if (data?.success === false) {
        throw new Error(data.error || 'Failed to create application')
      }
      return data.data as {
        id: number
        sessionId: string
        host: string
        username: string
        port: number
        applicationName: string
      }
    },
  })
}

export type { Connections, StepLog }
