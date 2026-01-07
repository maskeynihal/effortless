import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/applications')({
  component: ApplicationsPage,
})

function ApplicationsPage() {
  const [applications, setApplications] = React.useState<Array<any>>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedApp, setSelectedApp] = React.useState<any | null>(null)
  const [appSteps, setAppSteps] = React.useState<Array<any>>([])

  React.useEffect(() => {
    // In a real implementation, this would fetch from the API
    // For now, we'll use localStorage to demonstrate
    loadApplications()
  }, [])

  const loadApplications = async () => {
    setLoading(true)
    setError(null)
    try {
      // Load from localStorage
      const config = localStorage.getItem('appConfig')
      if (config) {
        const parsed = JSON.parse(config)
        setApplications([
          {
            id: 1,
            ...parsed,
            status: 'initializing',
            createdAt: new Date().toISOString(),
          },
        ])
      } else {
        setApplications([])
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const selectApplication = (app: any) => {
    setSelectedApp(app)
    // Load steps for this application
    setAppSteps([])
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Applications</h2>
        <p className="text-muted-foreground text-sm mt-1">
          View and manage all deployed applications
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Applications List */}
        <div className="lg:col-span-1">
          <div className="rounded-lg border p-4">
            <h3 className="font-semibold mb-4">
              Applications ({applications.length})
            </h3>
            {loading ? (
              <div className="text-center py-4 text-muted-foreground">
                Loading...
              </div>
            ) : applications.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground text-sm">
                <p>No applications found</p>
                <Link
                  to="/onboarding/init"
                  className="text-primary hover:underline text-xs mt-2 inline-block"
                >
                  Create one →
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {applications.map((app) => (
                  <button
                    key={app.id}
                    onClick={() => selectApplication(app)}
                    className={`w-full text-left rounded-md p-3 border transition-colors ${
                      selectedApp?.id === app.id
                        ? 'bg-primary/10 border-primary'
                        : 'hover:bg-accent'
                    }`}
                  >
                    <div className="font-medium text-sm">
                      {app.applicationName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {app.host}
                    </div>
                    <div className="text-xs mt-1">
                      <span className="inline-block px-2 py-1 rounded bg-blue-100 text-blue-700">
                        {app.status}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Application Details */}
        <div className="lg:col-span-2">
          {selectedApp ? (
            <div className="space-y-4">
              {/* Header */}
              <div className="rounded-lg border p-6 bg-primary/5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold">
                      {selectedApp.applicationName}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {selectedApp.username}@{selectedApp.host}:
                      {selectedApp.port}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Status</div>
                    <div className="font-semibold capitalize">
                      {selectedApp.status}
                    </div>
                  </div>
                </div>
              </div>

              {/* Configuration */}
              <div className="rounded-lg border p-6">
                <h4 className="font-semibold mb-4">Configuration</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">Host</div>
                    <div className="font-medium">{selectedApp.host}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Port</div>
                    <div className="font-medium">{selectedApp.port}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">User</div>
                    <div className="font-medium">{selectedApp.username}</div>
                  </div>
                  {selectedApp.domain && (
                    <div>
                      <div className="text-muted-foreground">Domain</div>
                      <div className="font-medium">{selectedApp.domain}</div>
                    </div>
                  )}
                  {selectedApp.pathname && (
                    <div className="col-span-2">
                      <div className="text-muted-foreground">Path</div>
                      <div className="font-medium text-xs">
                        {selectedApp.pathname}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Setup Steps */}
              <div className="rounded-lg border p-6">
                <h4 className="font-semibold mb-4">Setup Progress</h4>
                {appSteps.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    <p>No steps executed yet</p>
                    <Link
                      to="/onboarding/setup"
                      className="text-primary hover:underline text-xs mt-2 inline-block"
                    >
                      Execute setup workflow →
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {appSteps.map((step, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 text-sm"
                      >
                        {step.status === 'success' ? (
                          <span className="w-5 h-5 rounded-full bg-green-600 text-white flex items-center justify-center text-xs">
                            ✓
                          </span>
                        ) : step.status === 'failed' ? (
                          <span className="w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center text-xs">
                            ✕
                          </span>
                        ) : (
                          <span className="w-5 h-5 rounded-full bg-gray-300"></span>
                        )}
                        <span className="flex-1">{step.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(step.executedAt).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <Link
                  to="/onboarding/setup"
                  className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
                >
                  Run Setup
                </Link>
                <button
                  onClick={() => setSelectedApp(null)}
                  className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
                >
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border p-6 text-center">
              <p className="text-muted-foreground">
                Select an application to view details
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
