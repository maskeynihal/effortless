import axios from 'axios'
import type { AxiosError, AxiosInstance } from 'axios'

const API_URL = import.meta.env.VITE_API_URL ?? '/api'

interface ApiResponse<T = any> {
  success: boolean
  message?: string
  error?: string | object
  data?: T
  sessionId?: string
  steps?: Array<any>
  duration?: number
}

class ApiService {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: API_URL,
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000,
    })
  }

  // Connection verification
  async verifyConnection(params: {
    host: string
    username: string
    port: number
    privateKeyContent: string
    applicationName: string
    githubToken?: string
    domain?: string
    pathname?: string
  }): Promise<ApiResponse> {
    return this.client
      .post('/connection/verify', params)
      .then((res) => res.data)
      .catch(this.handleError)
  }

  // GitHub token verification
  async checkGitHubToken(params: {
    githubToken: string
    host: string
    username: string
    applicationName: string
  }): Promise<ApiResponse> {
    return this.client
      .post('/step/check-github-token', params)
      .then((res) => res.data)
      .catch(this.handleError)
  }

  // List GitHub repos for application
  async getGithubRepos(params: {
    host: string
    username: string
    applicationName: string
  }): Promise<ApiResponse> {
    return this.client
      .get('/github/repos', { params })
      .then((res) => res.data)
      .catch(this.handleError)
  }

  // Step: Deploy Key
  async deployKey(params: {
    host: string
    username: string
    applicationName: string
    selectedRepo: string
  }): Promise<ApiResponse> {
    return this.client
      .post('/step/deploy-key', params)
      .then((res) => res.data)
      .catch(this.handleError)
  }

  // Step: Database Create
  async databaseCreate(params: {
    host: string
    username: string
    applicationName: string
    dbType: 'MySQL' | 'PostgreSQL'
    dbName: string
    dbUsername: string
    dbPassword: string
    dbPort?: number
  }): Promise<ApiResponse> {
    return this.client
      .post('/step/database-create', params)
      .then((res) => res.data)
      .catch(this.handleError)
  }

  // Step: Folder Setup
  async folderSetup(params: {
    host: string
    username: string
    applicationName: string
    pathname: string
  }): Promise<ApiResponse> {
    return this.client
      .post('/step/folder-setup', params)
      .then((res) => res.data)
      .catch(this.handleError)
  }

  // Step: Env Setup
  async envSetup(params: {
    host: string
    username: string
    applicationName: string
    pathname: string
    selectedRepo: string
  }): Promise<ApiResponse> {
    return this.client
      .post('/step/env-setup', params)
      .then((res) => res.data)
      .catch(this.handleError)
  }

  // Step: Env Update
  async envUpdate(params: {
    host: string
    username: string
    applicationName: string
    pathname: string
    dbType: 'MySQL' | 'PostgreSQL'
    dbPort: number
    dbName: string
    dbUsername: string
    dbPassword: string
  }): Promise<ApiResponse> {
    return this.client
      .post('/step/env-update', params)
      .then((res) => res.data)
      .catch(this.handleError)
  }

  // Step: SSH Key Setup
  async sshKeySetup(params: {
    host: string
    username: string
    applicationName: string
    selectedRepo: string
  }): Promise<ApiResponse> {
    return this.client
      .post('/step/ssh-key-setup', params)
      .then((res) => res.data)
      .catch(this.handleError)
  }

  // Step: Server Stack Setup
  async serverStackSetup(params: {
    host: string
    username: string
    applicationName: string
    phpVersion: string
    database: 'mysql' | 'pgsql'
  }): Promise<ApiResponse> {
    return this.client
      .post('/step/server-stack-setup', params)
      .then((res) => res.data)
      .catch(this.handleError)
  }

  // Step: HTTPS Nginx Setup
  async httpsNginxSetup(params: {
    host: string
    username: string
    applicationName: string
    domain: string
    email: string
  }): Promise<ApiResponse> {
    return this.client
      .post('/step/https-nginx-setup', params)
      .then((res) => res.data)
      .catch(this.handleError)
  }

  // Step: Node NVM Setup
  async nodeNvmSetup(params: {
    host: string
    username: string
    applicationName: string
    nodeVersion: string
  }): Promise<ApiResponse> {
    return this.client
      .post('/step/node-nvm-setup', params)
      .then((res) => res.data)
      .catch(this.handleError)
  }

  // Step: Deploy Workflow Update
  async deployWorkflowUpdate(params: {
    host: string
    username: string
    applicationName: string
    selectedRepo: string
    baseBranch: string
    sshPath: string
    githubToken: string
  }): Promise<ApiResponse> {
    return this.client
      .post('/step/deploy-workflow-update', params)
      .then((res) => res.data)
      .catch(this.handleError)
  }

  // Get step logs
  async getStepLogs(
    host: string,
    username: string,
    applicationName: string,
  ): Promise<ApiResponse> {
    return this.client
      .get(`/steps/${host}/${username}/${applicationName}`)
      .then((res) => res.data)
      .catch(this.handleError)
  }

  // Create application record
  async createApplication(params: {
    host: string
    username: string
    port: number
    applicationName: string
  }): Promise<ApiResponse> {
    return this.client
      .post('/applications', params)
      .then((res) => res.data)
      .catch(this.handleError)
  }

  // List all applications
  async getApplications(): Promise<ApiResponse> {
    return this.client
      .get('/applications')
      .then((res) => res.data)
      .catch(this.handleError)
  }

  // Get application by ID
  async getApplicationById(id: number): Promise<ApiResponse> {
    return this.client
      .get(`/applications/${id}`)
      .then((res) => res.data)
      .catch(this.handleError)
  }

  // Persist selected repository for an application
  async selectRepository(params: {
    applicationId: number
    selectedRepo: string
  }): Promise<ApiResponse> {
    const { applicationId, selectedRepo } = params
    return this.client
      .post(`/applications/${applicationId}/select-repo`, { selectedRepo })
      .then((res) => res.data)
      .catch(this.handleError)
  }

  // Save database configuration
  async saveDatabaseConfig(params: {
    applicationId: number
    dbType: string
    dbName: string
    dbUsername: string
    dbPassword: string
    dbPort?: number
  }): Promise<ApiResponse> {
    const { applicationId, dbType, dbName, dbUsername, dbPassword, dbPort } =
      params
    return this.client
      .post(`/applications/${applicationId}/database-config`, {
        dbType,
        dbName,
        dbUsername,
        dbPassword,
        dbPort,
      })
      .then((res) => res.data)
      .catch(this.handleError)
  }

  // Get database configuration
  async getDatabaseConfig(applicationId: number): Promise<ApiResponse> {
    return this.client
      .get(`/applications/${applicationId}/database-config`)
      .then((res) => res.data)
      .catch(this.handleError)
  }

  private handleError(error: AxiosError<any>) {
    const data = error.response?.data
    return {
      success: false,
      error: data?.error || error.message,
      message: data?.message,
    }
  }
}

export const apiService = new ApiService()
