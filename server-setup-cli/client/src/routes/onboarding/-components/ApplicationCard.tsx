import { useStepLogs } from '@/lib/queries/useOnboarding'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

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
  const totalSteps = 14 // Total number of setup steps

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
        <Button
          variant="default"
          size="sm"
          onClick={() => onSelect(app.id)}
          className="cursor-pointer"
        >
          Configure
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => onDelete(app.id)}
          className="cursor-pointer"
        >
          Delete
        </Button>
      </div>
    </Card>
  )
}

export default ApplicationCard
