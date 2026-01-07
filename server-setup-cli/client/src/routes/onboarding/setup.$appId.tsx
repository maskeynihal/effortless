import * as React from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useGetApplication } from '../../lib/queries/useOnboarding'
import {
  useGetDatabaseConfig,
  useSaveDatabaseConfig,
  useStepLogs,
  useListReposFromBackend,
  useSelectRepo,
} from '../../lib/queries/useOnboarding'
import { apiService } from '../../lib/api-service'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'

export const Route = createFileRoute('/onboarding/setup/$appId')({
  component: SetupPage,
})

interface StepConfig {
  id: string
  name: string
  label: string
  description: string
  executed: boolean
  status: 'idle' | 'running' | 'success' | 'error'
  error?: string
  executedAt?: string
}

const STEPS: StepConfig[] = [
  {
    id: 'connection-verify',
    name: 'Connection Verification',
    label: 'Verify SSH & GitHub connection',
    description: 'Test SSH connection and GitHub authentication',
    executed: false,
    status: 'idle',
  },
  {
    id: 'repo-selection',
    name: 'Repository Selection',
    label: 'Select GitHub repository',
    description: 'Choose the repository to deploy',
    executed: false,
    status: 'idle',
  },
  {
    id: 'server-stack-setup',
    name: 'Server Stack Setup',
    label: 'Setup server stack (PHP/Nginx/Database)',
    description: 'Install PHP, Nginx, Database and all dependencies',
    executed: false,
    status: 'idle',
  },
  {
    id: 'database-create',
    name: 'Database Creation',
    label: 'Create database',
    description: 'Create database with user credentials',
    executed: false,
    status: 'idle',
  },
  {
    id: 'folder-setup',
    name: 'Folder Setup',
    label: 'Setup application folder',
    description: 'Create and configure application folder',
    executed: false,
    status: 'idle',
  },
  {
    id: 'env-setup',
    name: 'Env Setup',
    label: 'Setup environment (.env)',
    description: 'Create .env from repository template',
    executed: false,
    status: 'idle',
  },
  {
    id: 'env-update',
    name: 'Env Update',
    label: 'Update .env with database config',
    description: 'Add database credentials to .env',
    executed: false,
    status: 'idle',
  },
  {
    id: 'deploy-key-generation',
    name: 'Deploy Key',
    label: 'Generate & register deploy key',
    description: 'Create SSH deploy key for GitHub',
    executed: false,
    status: 'idle',
  },
  {
    id: 'ssh-key-setup',
    name: 'SSH Key for Actions',
    label: 'Setup SSH key for GitHub Actions',
    description: 'Generate key for CI/CD pipeline',
    executed: false,
    status: 'idle',
  },
  {
    id: 'node-nvm-setup',
    name: 'Node.js Setup',
    label: 'Install Node.js using NVM',
    description: 'Install Node.js and npm',
    executed: false,
    status: 'idle',
  },
  {
    id: 'https-nginx-setup',
    name: 'HTTPS Setup',
    label: 'Setup HTTPS + Nginx',
    description: 'Configure HTTPS and SSL certificates',
    executed: false,
    status: 'idle',
  },
  {
    id: 'deploy-workflow-update',
    name: 'Deploy Workflow',
    label: 'Create GitHub Actions workflow',
    description: 'Setup CI/CD workflow and open PR',
    executed: false,
    status: 'idle',
  },
]

function SetupPage() {
  const { appId } = Route.useParams()
  const nav = useNavigate()
  const [steps, setSteps] = React.useState<Array<StepConfig>>(STEPS)
  const { data: config } = useGetApplication(Number(appId))
  const { data: dbConfig } = useGetDatabaseConfig(Number(appId))
  const { data: stepLogs = [] } = useStepLogs(
    config?.host || '',
    config?.username || '',
    config?.applicationName || '',
  )
  const { data: repos = [], isLoading: loadingRepos } = useListReposFromBackend(
    {
      host: config?.host || '',
      username: config?.username || '',
      applicationName: config?.applicationName || '',
    },
  )

  const selectRepoMutation = useSelectRepo()
  const saveDatabaseConfig = useSaveDatabaseConfig()
  const [expandedStep, setExpandedStep] = React.useState<string | null>(null)
  const [stepConfigs, setStepConfigs] = React.useState<Record<string, any>>({})
  const [showPasswords, setShowPasswords] = React.useState<
    Record<string, boolean>
  >({})
  const [selectedRepoLocal, setSelectedRepoLocal] = React.useState<string>(
    config?.selectedRepo || '',
  )

  // Helper callback to update step configuration
  const updateStepConfig = React.useCallback(
    (stepId: string, updates: Record<string, any>) => {
      setStepConfigs((prev) => ({
        ...prev,
        [stepId]: {
          ...prev[stepId],
          ...updates,
        },
      }))
    },
    [],
  )

  // Prepopulate database config when loaded
  React.useEffect(() => {
    if (dbConfig) {
      setStepConfigs((prev) => ({
        ...prev,
        'database-create': {
          dbType: dbConfig.dbType,
          dbName: dbConfig.dbName,
          dbUsername: dbConfig.dbUsername,
          dbPassword: dbConfig.dbPassword,
          dbPort: dbConfig.dbPort || 3306,
        },
        'env-update': {
          dbType: dbConfig.dbType,
          dbName: dbConfig.dbName,
          dbUsername: dbConfig.dbUsername,
          dbPassword: dbConfig.dbPassword,
          dbPort: dbConfig.dbPort || 3306,
        },
      }))
    }
  }, [dbConfig])

  // Prepopulate server stack config when loaded
  React.useEffect(() => {
    if (config?.phpVersion || config?.dbType) {
      setStepConfigs((prev) => ({
        ...prev,
        'server-stack-setup': {
          ...prev['server-stack-setup'],
          phpVersion: config.phpVersion || '8.3',
          database:
            config.dbType === 'MySQL'
              ? 'mysql'
              : config.dbType === 'PostgreSQL'
                ? 'pgsql'
                : 'mysql',
        },
      }))
    }
  }, [config?.phpVersion, config?.dbType])

  // Update steps with execution status from backend
  React.useEffect(() => {
    if (stepLogs.length > 0) {
      setSteps((prevSteps) =>
        prevSteps.map((step) => {
          const log = stepLogs.find((l) => l.step === step.id)
          if (log) {
            return {
              ...step,
              executed: log.status === 'success',
              status:
                log.status === 'success'
                  ? 'success'
                  : log.status === 'failed'
                    ? 'error'
                    : step.status,
              error:
                log.status === 'failed' ? log.message || undefined : undefined,
              executedAt: log.createdAt,
            }
          }
          return step
        }),
      )
    }
  }, [stepLogs])

  // Check if a step's required fields are filled
  const isStepConfigured = (stepId: string): boolean => {
    const conf = stepConfigs[stepId]
    switch (stepId) {
      case 'repo-selection':
        return !!selectedRepoLocal
      case 'database-create':
        return !!(
          conf?.dbPassword &&
          conf?.dbName &&
          conf?.dbUsername &&
          conf?.dbType
        )
      case 'env-update':
        return !!(
          conf?.dbPassword &&
          conf?.dbName &&
          conf?.dbUsername &&
          conf?.dbType
        )
      case 'server-stack-setup':
        return !!(conf?.phpVersion && conf?.database)
      case 'node-nvm-setup':
        return !!conf?.nodeVersion
      case 'https-nginx-setup':
        return !!(conf?.domain && conf?.email)
      case 'deploy-workflow-update':
        return !!config.githubToken
      default:
        return true
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      // Brief visual feedback (you could add a toast here)
    })
  }

  if (!config) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-4">Loading application…</p>
        <Button onClick={() => nav({ to: '/onboarding' })}>
          Back to Applications
        </Button>
      </div>
    )
  }

  const executeStep = async (stepId: string) => {
    // Guard: ensure config is loaded before executing
    if (
      !config ||
      !config.host ||
      !config.username ||
      !config.applicationName
    ) {
      alert('Application configuration is loading. Please wait...')
      return
    }

    const step = steps.find((s) => s.id === stepId)
    if (!step) return

    const index = steps.indexOf(step)
    const newSteps = [...steps]
    newSteps[index] = { ...step, status: 'running' }
    setSteps(newSteps)

    try {
      let response: any
      const baseParams = {
        host: config.host,
        username: config.username,
        applicationName: config.applicationName,
      }

      switch (stepId) {
        case 'repo-selection': {
          if (!selectedRepoLocal) {
            throw new Error('Please select a repository')
          }
          try {
            await selectRepoMutation.mutateAsync({
              applicationId: Number(appId),
              selectedRepo: selectedRepoLocal,
            })
          } catch (e: any) {
            throw new Error(e.message || 'Failed to save repository selection')
          }
          response = { success: true, message: 'Repository selected' }
          break
        }
        case 'server-stack-setup': {
          const params = stepConfigs['server-stack-setup'] || {
            phpVersion: '8.3',
            database: 'mysql',
          }
          response = await apiService.serverStackSetup({
            ...baseParams,
            ...params,
          })
          break
        }
        case 'database-create': {
          const dbConfig = stepConfigs['database-create'] || {}
          const params = {
            dbType: dbConfig.dbType || 'MySQL',
            dbName: dbConfig.dbName || config.applicationName,
            dbUsername: dbConfig.dbUsername || `${config.applicationName}_user`,
            dbPassword: dbConfig.dbPassword || '',
            dbPort: dbConfig.dbPort || 3306,
          }
          response = await apiService.databaseCreate({
            ...baseParams,
            ...params,
          })
          break
        }
        case 'folder-setup': {
          response = await apiService.folderSetup({
            ...baseParams,
            pathname: config.pathname || `/var/www/${config.applicationName}`,
          })
          break
        }
        case 'env-setup': {
          const params = {
            selectedRepo: selectedRepoLocal || config.selectedRepo || '',
          }
          response = await apiService.envSetup({
            ...baseParams,
            pathname: config.pathname || `/var/www/${config.applicationName}`,
            ...params,
          })
          break
        }
        case 'env-update': {
          const params = stepConfigs['env-update'] || {
            dbType: 'MySQL',
            dbPort: 3306,
            dbName: config.applicationName,
            dbUsername: `${config.applicationName}_user`,
            dbPassword: '',
          }
          response = await apiService.envUpdate({
            ...baseParams,
            pathname: config.pathname || `/var/www/${config.applicationName}`,
            ...params,
          })
          break
        }
        case 'deploy-key-generation': {
          const params = {
            selectedRepo: selectedRepoLocal || config.selectedRepo || '',
          }
          response = await apiService.deployKey({
            ...baseParams,
            ...params,
          })
          break
        }
        case 'ssh-key-setup': {
          const params = {
            selectedRepo: selectedRepoLocal || config.selectedRepo || '',
          }
          response = await apiService.sshKeySetup({
            ...baseParams,
            ...params,
          })
          break
        }
        case 'node-nvm-setup': {
          const params = stepConfigs['node-nvm-setup'] || { nodeVersion: '20' }
          response = await apiService.nodeNvmSetup({
            ...baseParams,
            ...params,
          })
          break
        }
        case 'https-nginx-setup': {
          const params = stepConfigs['https-nginx-setup'] || {
            domain: config.domain || `${config.applicationName}.local`,
            email: 'admin@example.com',
          }
          response = await apiService.httpsNginxSetup({
            ...baseParams,
            ...params,
          })
          break
        }
        case 'deploy-workflow-update': {
          const params = stepConfigs['deploy-workflow-update'] || {}
          const selectedRepo =
            params.selectedRepo ||
            selectedRepoLocal ||
            config.selectedRepo ||
            ''
          if (!selectedRepo) {
            throw new Error(
              'Repository must be selected before deploying workflow',
            )
          }
          const token = params.githubToken || config.githubToken || ''
          if (!token) {
            throw new Error('GitHub token required for this step')
          }
          const sshPath =
            params.sshPath ||
            config.pathname ||
            `/var/www/${config.applicationName}`
          if (!sshPath) {
            throw new Error('Application pathname required for this step')
          }
          response = await apiService.deployWorkflowUpdate({
            ...baseParams,
            selectedRepo,
            baseBranch: params.baseBranch || 'main',
            githubToken: token,
            sshPath,
          })
          break
        }
        default:
          throw new Error('Unknown step')
      }

      if (!response.success) {
        throw new Error(response.error?.toString() || 'Step failed')
      }

      newSteps[index] = {
        ...step,
        status: 'success',
        executed: true,
      }
      setSteps(newSteps)
      setExpandedStep(null)

      // After database step succeeds, save config to backend
      if (stepId === 'database-create') {
        const params = stepConfigs['database-create']
        try {
          await saveDatabaseConfig.mutateAsync({
            applicationId: Number(appId),
            dbType: params.dbType,
            dbName: params.dbName,
            dbUsername: params.dbUsername,
            dbPassword: params.dbPassword,
            dbPort: params.dbPort,
          })
        } catch (e: any) {
          console.warn('Failed to save database config to backend:', e.message)
        }
      }

      // Sync dbType from server-stack to database steps
      if (
        stepId === 'server-stack-setup' &&
        stepConfigs['server-stack-setup']?.database
      ) {
        setStepConfigs((prev) => ({
          ...prev,
          'database-create': {
            ...prev['database-create'],
            dbType:
              stepConfigs['server-stack-setup'].database === 'mysql'
                ? 'MySQL'
                : 'PostgreSQL',
          },
          'env-update': {
            ...prev['env-update'],
            dbType:
              stepConfigs['server-stack-setup'].database === 'mysql'
                ? 'MySQL'
                : 'PostgreSQL',
          },
        }))
      }
    } catch (error: any) {
      newSteps[index] = {
        ...step,
        status: 'error',
        error: error.message,
      }
      setSteps(newSteps)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold">Setup Steps</h2>
        <p className="text-muted-foreground mt-2">
          {config
            ? `${config.applicationName} on ${config.username}@${config.host}`
            : ''}
        </p>
      </div>

      <div className="grid gap-3">
        {steps.map((step) => (
          <Card
            key={step.id}
            className={`p-4 cursor-pointer transition ${
              step.status === 'success'
                ? 'border-green-200 bg-green-50'
                : step.status === 'error'
                  ? 'border-red-200 bg-red-50'
                  : 'hover:bg-accent'
            }`}
            onClick={() =>
              setExpandedStep(expandedStep === step.id ? null : step.id)
            }
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1">
                <div className="text-xl">
                  {step.status === 'success' && '✓'}
                  {step.status === 'error' && '✗'}
                  {step.status === 'running' && '⟳'}
                  {step.status === 'idle' && '○'}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">{step.label}</h3>
                  <p className="text-xs text-muted-foreground">
                    {step.description}
                  </p>
                  {step.executed && step.executedAt && (
                    <p className="text-xs text-green-600 mt-1">
                      ✓ Executed on {new Date(step.executedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {[
                  'repo-selection',
                  'database-create',
                  'env-update',
                  'server-stack-setup',
                  'node-nvm-setup',
                  'https-nginx-setup',
                  'deploy-workflow-update',
                ].includes(step.id) && (
                  <div className="text-xs">
                    {expandedStep === step.id ? (
                      <span className="text-blue-600">▼ Configure</span>
                    ) : (
                      <span className="text-muted-foreground">
                        {isStepConfigured(step.id) ? '✓ Ready' : '⚙ Configure'}
                      </span>
                    )}
                  </div>
                )}
                <Button
                  size="sm"
                  variant={step.status === 'success' ? 'outline' : 'default'}
                  onClick={(e) => {
                    e.stopPropagation()
                    executeStep(step.id)
                  }}
                  disabled={
                    step.status === 'running' ||
                    (!isStepConfigured(step.id) &&
                      [
                        'repo-selection',
                        'database-create',
                        'env-update',
                        'server-stack-setup',
                        'node-nvm-setup',
                        'https-nginx-setup',
                        'deploy-workflow-update',
                      ].includes(step.id))
                  }
                >
                  {step.status === 'running'
                    ? 'Running...'
                    : step.status === 'success'
                      ? 'Re-run'
                      : 'Execute'}
                </Button>
              </div>
            </div>

            {expandedStep === step.id && (
              <div
                className="mt-4 space-y-3 pt-4 border-t"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Repository Selection step config */}
                {step.id === 'repo-selection' && (
                  <div className="space-y-2">
                    <div>
                      <Label className="text-xs">GitHub Repository *</Label>
                      {loadingRepos ? (
                        <div className="p-2 text-sm text-muted-foreground">
                          Loading repositories...
                        </div>
                      ) : repos.length === 0 ? (
                        <div className="p-2 text-sm text-red-600">
                          No repositories found. Make sure GitHub token is
                          valid.
                        </div>
                      ) : (
                        <Select
                          value={selectedRepoLocal}
                          onValueChange={setSelectedRepoLocal}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select a repository" />
                          </SelectTrigger>
                          <SelectContent>
                            {repos.map((repo: any) => (
                              <SelectItem key={repo.id} value={repo.full_name}>
                                {repo.full_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                )}

                {/* Database step config */}
                {step.id === 'database-create' && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Database Type</Label>
                        <Select
                          value={
                            stepConfigs['database-create']?.dbType || 'MySQL'
                          }
                          onValueChange={(val) => {
                            const defaultPort =
                              val === 'PostgreSQL' ? 5432 : 3306
                            updateStepConfig('database-create', {
                              dbType: val,
                              dbPort: defaultPort,
                            })
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="MySQL">MySQL</SelectItem>
                            <SelectItem value="PostgreSQL">
                              PostgreSQL
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Database Port</Label>
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            placeholder={
                              stepConfigs['database-create']?.dbType ===
                              'PostgreSQL'
                                ? '5432'
                                : '3306'
                            }
                            value={
                              stepConfigs['database-create']?.dbPort ||
                              (stepConfigs['database-create']?.dbType ===
                              'PostgreSQL'
                                ? 5432
                                : 3306)
                            }
                            onChange={(e) =>
                              updateStepConfig('database-create', {
                                dbPort:
                                  parseInt(e.target.value) ||
                                  (stepConfigs['database-create']?.dbType ===
                                  'PostgreSQL'
                                    ? 5432
                                    : 3306),
                              })
                            }
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              copyToClipboard(
                                String(
                                  stepConfigs['database-create']?.dbPort ||
                                    (stepConfigs['database-create']?.dbType ===
                                    'PostgreSQL'
                                      ? 5432
                                      : 3306),
                                ),
                              )
                            }
                          >
                            📋
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Database Name</Label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Database name"
                          value={
                            stepConfigs['database-create']?.dbName ||
                            config?.applicationName
                          }
                          onChange={(e) =>
                            updateStepConfig('database-create', {
                              dbName: e.target.value,
                            })
                          }
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            copyToClipboard(
                              stepConfigs['database-create']?.dbName ||
                                config?.applicationName ||
                                '',
                            )
                          }
                        >
                          📋
                        </Button>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Database Username</Label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Database user"
                          value={
                            stepConfigs['database-create']?.dbUsername ||
                            `${config?.applicationName}_user`
                          }
                          onChange={(e) =>
                            updateStepConfig('database-create', {
                              dbUsername: e.target.value,
                            })
                          }
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            copyToClipboard(
                              stepConfigs['database-create']?.dbUsername ||
                                `${config?.applicationName}_user` ||
                                '',
                            )
                          }
                        >
                          📋
                        </Button>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Database Password *</Label>
                      <div className="flex gap-2">
                        <Input
                          type={
                            showPasswords['database-create-pwd']
                              ? 'text'
                              : 'password'
                          }
                          placeholder="Enter a secure password"
                          value={
                            stepConfigs['database-create']?.dbPassword || ''
                          }
                          onChange={(e) =>
                            updateStepConfig('database-create', {
                              dbPassword: e.target.value,
                            })
                          }
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setShowPasswords((prev) => ({
                              ...prev,
                              'database-create-pwd':
                                !prev['database-create-pwd'],
                            }))
                          }
                        >
                          {showPasswords['database-create-pwd'] ? '🙈' : '👁'}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            copyToClipboard(
                              stepConfigs['database-create']?.dbPassword || '',
                            )
                          }
                        >
                          📋
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Env Update step config */}
                {step.id === 'env-update' && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Database Type</Label>
                        <Select
                          value={stepConfigs['env-update']?.dbType || 'MySQL'}
                          onValueChange={(val) => {
                            const defaultPort =
                              val === 'PostgreSQL' ? 5432 : 3306
                            updateStepConfig('env-update', {
                              dbType: val,
                              dbPort: defaultPort,
                            })
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="MySQL">MySQL</SelectItem>
                            <SelectItem value="PostgreSQL">
                              PostgreSQL
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Database Port</Label>
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            placeholder={
                              stepConfigs['env-update']?.dbType === 'PostgreSQL'
                                ? '5432'
                                : '3306'
                            }
                            value={
                              stepConfigs['env-update']?.dbPort ||
                              (stepConfigs['env-update']?.dbType ===
                              'PostgreSQL'
                                ? 5432
                                : 3306)
                            }
                            onChange={(e) =>
                              updateStepConfig('env-update', {
                                dbPort:
                                  parseInt(e.target.value) ||
                                  (stepConfigs['env-update']?.dbType ===
                                  'PostgreSQL'
                                    ? 5432
                                    : 3306),
                              })
                            }
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              copyToClipboard(
                                String(
                                  stepConfigs['env-update']?.dbPort ||
                                    (stepConfigs['env-update']?.dbType ===
                                    'PostgreSQL'
                                      ? 5432
                                      : 3306),
                                ),
                              )
                            }
                          >
                            📋
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Database Name</Label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Database name"
                          value={
                            stepConfigs['env-update']?.dbName ||
                            config?.applicationName
                          }
                          onChange={(e) =>
                            updateStepConfig('env-update', {
                              dbName: e.target.value,
                            })
                          }
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            copyToClipboard(
                              stepConfigs['env-update']?.dbName ||
                                config?.applicationName ||
                                '',
                            )
                          }
                        >
                          📋
                        </Button>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Database Username</Label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Database user"
                          value={
                            stepConfigs['env-update']?.dbUsername ||
                            `${config?.applicationName}_user`
                          }
                          onChange={(e) =>
                            updateStepConfig('env-update', {
                              dbUsername: e.target.value,
                            })
                          }
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            copyToClipboard(
                              stepConfigs['env-update']?.dbUsername ||
                                `${config?.applicationName}_user` ||
                                '',
                            )
                          }
                        >
                          📋
                        </Button>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Database Password *</Label>
                      <div className="flex gap-2">
                        <Input
                          type={showPasswords['env-pwd'] ? 'text' : 'password'}
                          placeholder="Enter database password"
                          value={stepConfigs['env-update']?.dbPassword || ''}
                          onChange={(e) =>
                            updateStepConfig('env-update', {
                              dbPassword: e.target.value,
                            })
                          }
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setShowPasswords((prev) => ({
                              ...prev,
                              'env-pwd': !prev['env-pwd'],
                            }))
                          }
                        >
                          {showPasswords['env-pwd'] ? '🙈' : '👁'}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            copyToClipboard(
                              stepConfigs['env-update']?.dbPassword || '',
                            )
                          }
                        >
                          📋
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Server Stack step config */}
                {step.id === 'server-stack-setup' && (
                  <div className="space-y-2">
                    <div>
                      <Label className="text-xs">PHP Version</Label>
                      <Input
                        placeholder="8.3"
                        value={
                          stepConfigs['server-stack-setup']?.phpVersion || '8.3'
                        }
                        onChange={(e) =>
                          updateStepConfig('server-stack-setup', {
                            phpVersion: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Database Type</Label>
                      <Select
                        value={
                          stepConfigs['server-stack-setup']?.database || 'mysql'
                        }
                        onValueChange={(val) => {
                          updateStepConfig('server-stack-setup', {
                            database: val,
                          })
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="mysql">MySQL</SelectItem>
                          <SelectItem value="pgsql">PostgreSQL</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* Node NVM step config */}
                {step.id === 'node-nvm-setup' && (
                  <div className="space-y-2">
                    <div>
                      <Label className="text-xs">Node.js Version</Label>
                      <Input
                        placeholder="20"
                        value={
                          stepConfigs['node-nvm-setup']?.nodeVersion || '20'
                        }
                        onChange={(e) =>
                          updateStepConfig('node-nvm-setup', {
                            nodeVersion: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                )}

                {/* HTTPS Nginx step config */}
                {step.id === 'https-nginx-setup' && (
                  <div className="space-y-2">
                    <div>
                      <Label className="text-xs">Domain</Label>
                      <Input
                        placeholder="example.com"
                        value={
                          stepConfigs['https-nginx-setup']?.domain ||
                          config?.domain ||
                          `${config?.applicationName}.local`
                        }
                        onChange={(e) =>
                          updateStepConfig('https-nginx-setup', {
                            domain: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Email (for SSL)</Label>
                      <Input
                        type="email"
                        placeholder="admin@example.com"
                        value={
                          stepConfigs['https-nginx-setup']?.email ||
                          'admin@example.com'
                        }
                        onChange={(e) =>
                          updateStepConfig('https-nginx-setup', {
                            email: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                )}

                {/* Deploy Workflow step config */}
                {step.id === 'deploy-workflow-update' && (
                  <div className="space-y-2">
                    <div>
                      <Label className="text-xs">Selected Repository</Label>
                      <Input
                        placeholder="owner/repo"
                        value={
                          stepConfigs['deploy-workflow-update']?.selectedRepo ||
                          selectedRepoLocal ||
                          config?.selectedRepo ||
                          ''
                        }
                        onChange={(e) =>
                          updateStepConfig('deploy-workflow-update', {
                            selectedRepo: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-xs">
                        Deployment Path (SSH Path)
                      </Label>
                      <Input
                        placeholder="/var/www/myapp"
                        value={
                          stepConfigs['deploy-workflow-update']?.sshPath ||
                          config?.pathname ||
                          `/var/www/${config?.applicationName || 'app'}`
                        }
                        onChange={(e) =>
                          updateStepConfig('deploy-workflow-update', {
                            sshPath: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-xs">GitHub Token</Label>
                      <Input
                        type="password"
                        placeholder="ghp_xxxxxxxxxxxx"
                        value={
                          stepConfigs['deploy-workflow-update']?.githubToken ||
                          config?.githubToken ||
                          ''
                        }
                        onChange={(e) =>
                          updateStepConfig('deploy-workflow-update', {
                            githubToken: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Base Branch</Label>
                      <Input
                        placeholder="main"
                        value={
                          stepConfigs['deploy-workflow-update']?.baseBranch ||
                          ''
                        }
                        onChange={(e) =>
                          updateStepConfig('deploy-workflow-update', {
                            baseBranch: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                )}

                {step.status === 'error' && (
                  <div className="p-3 bg-red-100 text-red-800 rounded text-sm">
                    Error: {step.error}
                  </div>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={() => nav({ to: '/onboarding' })}>
          Back
        </Button>
      </div>
    </div>
  )
}
