import * as React from 'react'
import { createFileRoute, Outlet, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/onboarding/setup')({
  component: SetupLayout,
})

function SetupLayout() {
  return (
    <div>
      <Outlet />
      {/* Fallback content when no application is selected */}
      <div className="py-12 text-center text-muted-foreground">
        <p>No application selected.</p>
        <p className="mt-2">
          <Link to="/onboarding" className="underline">Go back to Applications</Link>
        </p>
      </div>
    </div>
  )
}
