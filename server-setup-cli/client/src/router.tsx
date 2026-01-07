import { createRouter } from '@tanstack/react-router'
import * as React from 'react'

// Import the generated route tree
import { routeTree } from './routeTree.gen'

// Create a new router instance
export const getRouter = () => {
  const NotFound: React.FC = () => (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 560 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
          Page not found
        </h1>
        <p style={{ color: '#64748b', marginBottom: 16 }}>
          The page you’re looking for doesn’t exist or may have moved.
        </p>
        <a href="/" style={{ color: '#10b981' }}>
          Go back home
        </a>
      </div>
    </div>
  )

  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: NotFound,
  })

  return router
}
