import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/onboarding/')({
  component: Onboarding,
})

export default function Onboarding() {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Onboarding</h2>
      <p className="text-muted-foreground">Initialize and run workflow steps.</p>
    </div>
  )
}
