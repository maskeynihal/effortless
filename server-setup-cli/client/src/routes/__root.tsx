import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Effortless - Server Setup & Deployment',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),

  shellComponent: RootDocument,
  component: RootApp,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        {children}
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}

const queryClient = new QueryClient()

function RootApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen flex flex-col bg-background">
        {/* Header */}
        <header className="border-b bg-card">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-8">
              <Link
                to="/"
                className="font-bold text-xl hover:opacity-80 transition"
              >
                Effortless
              </Link>
              <nav className="flex gap-6">
                <Link
                  to="/onboarding"
                  className="text-sm text-muted-foreground hover:text-foreground transition"
                  activeProps={{
                    className:
                      'text-sm font-medium transition underline underline-offset-4 font-extrabold',
                  }}
                  activeOptions={{ exact: false }}
                >
                  Applications
                </Link>
              </nav>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8">
          <Outlet />
        </main>

        {/* Footer */}
        <footer className="border-t bg-card">
          <div className="max-w-7xl mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
            <p>Effortless © 2025 • Automated Server Setup & Deployment</p>
          </div>
        </footer>
      </div>
    </QueryClientProvider>
  )
}
