import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { useListApplications } from '@/lib/queries/useOnboarding'
import { Button } from '@/components/ui/button'
import ApplicationCard from '@/routes/onboarding/-components/ApplicationCard'

export const Route = createFileRoute('/onboarding/')({
  component: Onboarding,
})

export default function Onboarding() {
  const nav = useNavigate()
  const { data: apps = [], isLoading: loading, error } = useListApplications()

  console.log({ apps, loading, error })

  const handleNewApp = () => {
    nav({ to: '/onboarding/new' })
  }

  const handleSelectApp = (id: number) => {
    nav({ to: '/onboarding/setup/$appId', params: { appId: String(id) } })
  }

  const handleDeleteApp = (_id: number) => {
    alert('Coming soon: Delete Application functionality')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Application Management</h2>
          <p className="text-muted-foreground mt-2">
            Manage and configure your server applications
          </p>
        </div>
        <Button onClick={handleNewApp} className="shrink-0 cursor-pointer">
          {apps.length === 0
            ? '➕ Create New Application'
            : '➕ Add Another Application'}
        </Button>
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
    </div>
  )
}
