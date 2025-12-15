import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/')({
  component: Admin,
})

function Admin() {
  return (
    <div>
      <h2 className="text-xl font-semibold">Admin</h2>
      <p className="text-muted-foreground">Manage admin users and checks.</p>
    </div>
  )
}
