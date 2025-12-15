import * as React from 'react'
import { Outlet, createRootRoute, Link } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="border-b">
        <div className="container flex h-14 items-center justify-between">
          <Link to="/" className="font-semibold">Effortless</Link>
          <nav className="flex gap-4 text-sm">
            <Link to="/" activeProps={{ className: 'text-primary' }}>Dashboard</Link>
            <Link to="/onboarding" activeProps={{ className: 'text-primary' }}>Onboarding</Link>
            <Link to="/admin" activeProps={{ className: 'text-primary' }}>Admin</Link>
          </nav>
        </div>
      </header>
      <main className="container py-6">
        <Outlet />
      </main>
    </div>
  )
}
