import * as React from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Welcome</h1>
      <p className="text-muted-foreground">Manage sessions and workflows.</p>
      <div className="flex gap-3">
        <Link to="/onboarding" className="underline">Start Onboarding</Link>
        <Link to="/admin" className="underline">Admin Tools</Link>
      </div>
    </div>
  )
}
