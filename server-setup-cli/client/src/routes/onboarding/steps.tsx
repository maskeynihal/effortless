import * as React from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/onboarding/steps')({
  component: LegacySteps,
})

function LegacySteps() {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold">This route moved</h3>
      <p className="text-muted-foreground">
        Use the redesigned onboarding experience.
      </p>
      <Link
        to="/onboarding"
        className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
      >
        Go to onboarding
      </Link>
    </div>
  )
}
