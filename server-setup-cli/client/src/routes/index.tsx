import { createFileRoute, Link } from '@tanstack/react-router'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold">Effortless</h1>
        <p className="text-xl text-muted-foreground">
          Automated server setup and deployment orchestration
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-6 space-y-4">
          <h2 className="text-2xl font-bold">Application Setup</h2>
          <p className="text-muted-foreground">
            Configure and deploy applications to your servers with automated
            setup steps.
          </p>
          <Link to="/onboarding">
            <Button className="w-full">Manage Applications</Button>
          </Link>
        </Card>
      </div>

      <div className="space-y-3">
        <h3 className="text-lg font-semibold">Available Setup Steps</h3>
        <ul className="grid gap-2 text-sm">
          <li className="flex gap-2">
            <span>✓</span>
            <span>Server Stack Setup (PHP/Nginx/Database)</span>
          </li>
          <li className="flex gap-2">
            <span>✓</span>
            <span>Database Creation & Management</span>
          </li>
          <li className="flex gap-2">
            <span>✓</span>
            <span>Application Folder Setup</span>
          </li>
          <li className="flex gap-2">
            <span>✓</span>
            <span>Environment Configuration (.env)</span>
          </li>
          <li className="flex gap-2">
            <span>✓</span>
            <span>SSH & GitHub Integration</span>
          </li>
          <li className="flex gap-2">
            <span>✓</span>
            <span>HTTPS & SSL Configuration</span>
          </li>
          <li className="flex gap-2">
            <span>✓</span>
            <span>Node.js Setup via NVM</span>
          </li>
          <li className="flex gap-2">
            <span>✓</span>
            <span>GitHub Actions Workflow Creation</span>
          </li>
        </ul>
      </div>
    </div>
  )
}
