import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { apiService } from '../lib/api-service'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'

export const Route = createFileRoute('/admin')({
  component: AdminPage,
})

export default function AdminPage() {
  const [host, setHost] = React.useState('')
  const [username, setUsername] = React.useState('')
  const [applicationName, setApplicationName] = React.useState('')
  const [logs, setLogs] = React.useState<Array<any>>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const handleFetchLogs = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      if (!host || !username || !applicationName) {
        throw new Error('Please fill in all fields')
      }

      const response = await apiService.getStepLogs(
        host,
        username,
        applicationName,
      )

      if (!response.success) {
        throw new Error(response.error?.toString() || 'Failed to fetch logs')
      }

      setLogs(response.steps || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold">Admin Tools</h1>
        <p className="text-muted-foreground mt-2">
          Manage applications and view step execution logs
        </p>
      </div>

      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">View Step Logs</h2>

        <form onSubmit={handleFetchLogs} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-100 text-red-800 rounded">{error}</div>
          )}

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Host</Label>
              <Input
                placeholder="192.168.1.1"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Username</Label>
              <Input
                placeholder="root"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Application Name</Label>
              <Input
                placeholder="my-app"
                value={applicationName}
                onChange={(e) => setApplicationName(e.target.value)}
                required
              />
            </div>
          </div>

          <Button type="submit" disabled={loading}>
            {loading ? 'Loading...' : 'Fetch Logs'}
          </Button>
        </form>
      </Card>

      {logs.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xl font-semibold">Execution History</h2>
          <div className="grid gap-3">
            {logs.map((log, idx) => (
              <Card key={idx} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold">
                      {log.stepName || log.step || 'Unknown Step'}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {new Date(
                        log.executedAt || log.createdAt,
                      ).toLocaleString()}
                    </p>
                    {log.message && (
                      <p className="text-sm mt-2">{log.message}</p>
                    )}
                  </div>
                  <div
                    className={`text-lg font-semibold ${
                      log.status === 'success'
                        ? 'text-green-600'
                        : log.status === 'failed'
                          ? 'text-red-600'
                          : 'text-blue-600'
                    }`}
                  >
                    {log.status === 'success' && '✓'}
                    {log.status === 'failed' && '✗'}
                    {log.status === 'running' && '⟳'}
                  </div>
                </div>

                {log.data && (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer font-mono">
                      Details
                    </summary>
                    <pre className="bg-gray-100 p-2 rounded mt-2 overflow-auto max-h-40">
                      {JSON.stringify(log.data, null, 2)}
                    </pre>
                  </details>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {logs.length === 0 &&
        !loading &&
        (host || username || applicationName) && (
          <Card className="p-6 text-center text-muted-foreground">
            No logs found for this application
          </Card>
        )}
    </div>
  )
}
