import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/onboarding/workflow')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/onboarding/workflow"!</div>
}
