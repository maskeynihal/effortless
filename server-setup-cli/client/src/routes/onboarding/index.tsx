import * as React from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  useListApplications,
  useStepLogs,
} from '../../lib/queries/useOnboarding'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'

export const Route = createFileRoute('/onboarding/')({
  component: Onboarding,
})

export default function Onboarding() {
  const nav = useNavigate()
  const { data: apps = [], isLoading: loading, error } = useListApplications()

  const handleNewApp = () => {
    nav({ to: '/onboarding/new' })
  }

  const handleSelectApp = (id: number) => {
    nav({ to: '/onboarding/setup/$appId', params: { appId: String(id) } })
  }

  const handleDeleteApp = (_id: number) => {
    alert('Delete API not implemented yet')
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Application Management</h2>
        <p className="text-muted-foreground mt-2">
          Manage and configure your server applications
        </p>
      </div>

      {loading && (
        <div className="text-muted-foreground">Loading applications...</div>
      )}
      {error && <div className="text-red-600">{error.message}</div>}
      {!loading && apps.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-lg">Saved Applications</h3>
          <div className="grid gap-3">
            {apps.map((app) => (
              <ApplicationCard
                key={app.id}
                app={app}
                onSelect={handleSelectApp}
                onDelete={handleDeleteApp}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Button onClick={handleNewApp} className="w-full md:w-auto">
          {apps.length === 0
            ? '➕ Create New Application'
            : '➕ Add Another Application'}
        </Button>
      </div>
    </div>
  )
}

function ApplicationCard({
  app,
  onSelect,
  onDelete,
}: {
  app: {
    id: number
    applicationName: string
    username: string
    host: string
  }
  onSelect: (id: number) => void
  onDelete: (id: number) => void
}) {
  const { data: stepLogs = [] } = useStepLogs(
    app.host,
    app.username,
    app.applicationName,
  )
  const completedSteps = stepLogs.filter(
    (log) => log.status === 'success',
  ).length
  const totalSteps = 12 // Total number of setup steps

  return (
    <Card className="p-4 flex items-center justify-between hover:bg-accent">
      <div className="flex-1 cursor-pointer" onClick={() => onSelect(app.id)}>
        <p className="font-medium">{app.applicationName}</p>
        <p className="text-xs text-muted-foreground">
          {app.username}@{app.host}
        </p>
        {stepLogs.length > 0 && (
          <div className="flex items-center gap-2 mt-2">
            <Badge
              variant={completedSteps === totalSteps ? 'default' : 'secondary'}
            >
              {completedSteps}/{totalSteps} steps completed
            </Badge>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="default" size="sm" onClick={() => onSelect(app.id)}>
          Configure
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => onDelete(app.id)}
        >
          Delete
        </Button>
      </div>
    </Card>
  )
}
