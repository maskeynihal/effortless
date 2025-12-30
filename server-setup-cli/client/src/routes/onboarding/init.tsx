import * as React from 'react'
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/onboarding/init')({
  component: Init,
})

function Init() {
  const nav = useNavigate()

  React.useEffect(() => {
    // Redirect to new onboarding flow
    nav({ to: '/onboarding', replace: true })
  }, [nav])

  return (
    <div className="text-center py-12 space-y-4">
      <h3 className="text-lg font-semibold">Redirecting...</h3>
      <p className="text-muted-foreground">
        This route has been moved to the new onboarding experience.
      </p>
      <Link
        to="/onboarding"
        className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
      >
        Go to Onboarding
      </Link>
    </div>
  )
}
