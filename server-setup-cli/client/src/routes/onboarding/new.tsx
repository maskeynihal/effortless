import * as React from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  useCheckGithubToken,
  useFetchReposFromBackend,
  useSelectRepo,
  useVerifyConnection,
} from '../../lib/queries/useOnboarding'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog'
import type { SessionConfig } from '../../lib/storage'

export const Route = createFileRoute('/onboarding/new')({
  component: NewApplication,
})

export default function NewApplication() {
  const nav = useNavigate()
  const [step, setStep] = React.useState<'config' | 'verify'>('config')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [connections, setConnections] = React.useState<any>(null)
  const [applicationId, setApplicationId] = React.useState<number | null>(null)
  const [repos, setRepos] = React.useState<Array<any>>([])
  const [selectedRepo, setSelectedRepo] = React.useState<string>('')
  const verifyConnection = useVerifyConnection()
  const checkGithubToken = useCheckGithubToken()
  const fetchRepos = useFetchReposFromBackend()
  const selectRepoMutation = useSelectRepo()

  const [config, setConfig] = React.useState<SessionConfig>({
    host: '',
    username: 'root',
    port: 22,
    privateKeyContent: '',
    applicationName: '',
    domain: '',
    pathname: '',
    githubToken: '',
    selectedRepo: '',
  })

  const handleConfigChange = (
    field: keyof SessionConfig,
    value: string | number,
  ) => {
    setConfig((prev) => ({ ...prev, [field]: value }))
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      if (
        !config.host ||
        !config.username ||
        !config.privateKeyContent ||
        !config.applicationName
      ) {
        throw new Error('Please fill in all required fields')
      }

      // Verify SSH and optionally GitHub connections via backend
      const response = await verifyConnection.mutateAsync({
        host: config.host,
        username: config.username,
        port: config.port,
        privateKeyContent: config.privateKeyContent,
        applicationName: config.applicationName,
        githubToken: config.githubToken,
      })

      setConnections(response.connections)
      if ((response as any).applicationId) {
        setApplicationId((response as any).applicationId)
      }
      setStep('verify')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = () => {
    if (applicationId) {
      nav({
        to: '/onboarding/setup/$appId',
        params: { appId: String(applicationId) },
      })
    } else {
      nav({ to: '/onboarding' })
    }
  }

  const handleGithubVerifyAndListRepos = async () => {
    try {
      setLoading(true)
      setError(null)
      // Verify token and save to DB
      await checkGithubToken.mutateAsync({
        githubToken: config.githubToken || '',
        host: config.host,
        username: config.username,
        applicationName: config.applicationName,
      })

      // Fetch repos via backend (uses saved token)
      const list = await fetchRepos.mutateAsync({
        host: config.host,
        username: config.username,
        applicationName: config.applicationName,
      })
      setRepos(list)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSelectRepo = async (fullName: string) => {
    if (applicationId === null) return
    try {
      setSelectedRepo(fullName)
      await selectRepoMutation.mutateAsync({
        applicationId,
        selectedRepo: fullName,
      })
    } catch (e: any) {
      setError(e.message)
    }
  }

  if (step === 'verify' && connections) {
    return (
      <div className="space-y-6 max-w-2xl">
        <div>
          <h2 className="text-2xl font-bold">Connection Verified</h2>
          <p className="text-muted-foreground mt-2">
            Verify your connections below
          </p>
        </div>

        <div className="grid gap-4">
          <Card className="p-4 border-green-200 bg-green-50">
            <h3 className="font-semibold flex items-center gap-2">
              <span className="text-green-600">✓</span> SSH Connection
            </h3>
            <p className="text-sm text-muted-foreground mt-2">
              {config.username}@{config.host}:{config.port}
            </p>
            {connections.ssh?.error && (
              <p className="text-sm text-red-600 mt-2">
                Error: {connections.ssh.error}
              </p>
            )}
          </Card>

          {config.githubToken && (
            <Card
              className={`p-4 ${connections.github?.connected ? 'border-green-200 bg-green-50' : 'border-yellow-200 bg-yellow-50'}`}
            >
              <h3 className="font-semibold flex items-center gap-2">
                <span
                  className={
                    connections.github?.connected
                      ? 'text-green-600'
                      : 'text-yellow-600'
                  }
                >
                  {connections.github?.connected ? '✓' : '⚠'}
                </span>
                GitHub Connection
              </h3>
              {connections.github?.username && (
                <p className="text-sm text-muted-foreground mt-2">
                  Logged in as: {connections.github.username}
                </p>
              )}
              {connections.github?.error && (
                <p className="text-sm text-yellow-600 mt-2">
                  Warning: {connections.github.error}
                </p>
              )}
            </Card>
          )}
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setStep('config')}>
            Back
          </Button>
          <Button onClick={handleSave} className="flex-1">
            Continue to Setup
          </Button>
        </div>

        <div className="pt-6 space-y-3">
          <h3 className="font-semibold">GitHub Repositories</h3>
          <p className="text-sm text-muted-foreground">
            Optionally verify your GitHub token to list repositories.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleGithubVerifyAndListRepos}
              disabled={!config.githubToken}
            >
              Verify Token & Fetch Repos
            </Button>
          </div>
          {repos.length > 0 && (
            <div className="grid gap-2">
              {repos.slice(0, 10).map((r) => (
                <Card
                  key={r.id}
                  className={`p-3 flex items-center justify-between cursor-pointer ${selectedRepo === r.full_name ? 'border-primary' : ''}`}
                  onClick={() => handleSelectRepo(r.full_name)}
                >
                  <div>
                    <div className="text-sm font-medium">{r.full_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.private ? 'Private' : 'Public'}
                    </div>
                  </div>
                </Card>
              ))}
              <p className="text-xs text-muted-foreground">
                Showing first 10. Full list will be available in setup step.
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleVerify} className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold">New Application</h2>
        <p className="text-muted-foreground mt-2">
          Configure your server connection
        </p>
      </div>

      {error && (
        <AlertDialog open={true}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Error</AlertDialogTitle>
              <AlertDialogDescription>{error}</AlertDialogDescription>
            </AlertDialogHeader>
            <Button onClick={() => setError(null)}>Close</Button>
          </AlertDialogContent>
        </AlertDialog>
      )}

      <Card className="p-6 space-y-4">
        <div>
          <Label>Application Name *</Label>
          <Input
            placeholder="my-app"
            value={config.applicationName}
            onChange={(e) =>
              handleConfigChange('applicationName', e.target.value)
            }
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Server Host *</Label>
            <Input
              placeholder="192.168.1.1 or example.com"
              value={config.host}
              onChange={(e) => handleConfigChange('host', e.target.value)}
              required
            />
          </div>
          <div>
            <Label>SSH Username *</Label>
            <Input
              placeholder="root"
              value={config.username}
              onChange={(e) => handleConfigChange('username', e.target.value)}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>SSH Port</Label>
            <Input
              type="number"
              placeholder="22"
              value={config.port}
              onChange={(e) =>
                handleConfigChange('port', parseInt(e.target.value) || 22)
              }
            />
          </div>
          <div>
            <Label>Domain</Label>
            <Input
              placeholder={`${config.applicationName}.local`}
              value={config.domain}
              onChange={(e) => handleConfigChange('domain', e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label>Application Path</Label>
          <Input
            placeholder={`/var/www/${config.applicationName}`}
            value={config.pathname}
            onChange={(e) => handleConfigChange('pathname', e.target.value)}
          />
        </div>

        <div>
          <Label>SSH Private Key *</Label>
          <Textarea
            placeholder="Paste your SSH private key here..."
            value={config.privateKeyContent}
            onChange={(e) =>
              handleConfigChange('privateKeyContent', e.target.value)
            }
            rows={8}
            required
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Your private key is stored locally in your browser and never sent to
            the server
          </p>
        </div>

        <div>
          <Label>GitHub PAT (Optional)</Label>
          <Input
            type="password"
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            value={config.githubToken}
            onChange={(e) => handleConfigChange('githubToken', e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Required for private GitHub repositories
          </p>
        </div>
      </Card>

      <div className="flex gap-3">
        <Button variant="outline" onClick={() => nav({ to: '/onboarding' })}>
          Back
        </Button>
        <Button type="submit" disabled={loading} className="flex-1">
          {loading ? 'Verifying...' : 'Verify Connections'}
        </Button>
      </div>
    </form>
  )
}
