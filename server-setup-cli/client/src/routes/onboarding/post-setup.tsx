import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/onboarding/post-setup')({
  component: PostSetup,
})

function PostSetup() {
  const sessionId = React.useMemo(
    () => localStorage.getItem('sessionId') || '',
    [],
  )
  const [db, setDb] = React.useState({
    name: '',
    user: '',
    password: '',
    port: 5432,
  })
  const [app, setApp] = React.useState({
    domain: '',
    owner: '',
    group: '',
    path: '',
  })
  const [env, setEnv] = React.useState({ repoUrl: '', dbUrl: '' })
  const [msg, setMsg] = React.useState('')

  async function createDb() {
    const res = await fetch('/api/database/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, ...db }),
    })
    const j = await res.json()
    setMsg(j.message || j.error || 'Done')
  }
  async function setupApp() {
    const res = await fetch('/api/application/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, ...app }),
    })
    const j = await res.json()
    setMsg(j.message || j.error || 'Done')
  }
  async function setupEnv() {
    const res = await fetch('/api/environment/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, ...env }),
    })
    const j = await res.json()
    setMsg(j.message || j.error || 'Done')
  }

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="space-y-2">
        <h4 className="font-medium">Create Database</h4>
        {['name', 'user', 'password', 'port'].map((k) => (
          <input
            key={k}
            placeholder={k}
            value={(db as any)[k]}
            onChange={(e) => setDb((p: any) => ({ ...p, [k]: e.target.value }))}
            className="w-full rounded-md border px-3 py-2"
          />
        ))}
        <button
          onClick={createDb}
          className="rounded-md bg-primary text-primary-foreground px-3 py-2"
        >
          Create
        </button>
      </div>
      <div className="space-y-2">
        <h4 className="font-medium">Setup Application</h4>
        {['domain', 'owner', 'group', 'path'].map((k) => (
          <input
            key={k}
            placeholder={k}
            value={(app as any)[k]}
            onChange={(e) =>
              setApp((p: any) => ({ ...p, [k]: e.target.value }))
            }
            className="w-full rounded-md border px-3 py-2"
          />
        ))}
        <button
          onClick={setupApp}
          className="rounded-md bg-primary text-primary-foreground px-3 py-2"
        >
          Setup
        </button>
      </div>
      <div className="space-y-2">
        <h4 className="font-medium">Setup .env</h4>
        {['repoUrl', 'dbUrl'].map((k) => (
          <input
            key={k}
            placeholder={k}
            value={(env as any)[k]}
            onChange={(e) =>
              setEnv((p: any) => ({ ...p, [k]: e.target.value }))
            }
            className="w-full rounded-md border px-3 py-2"
          />
        ))}
        <button
          onClick={setupEnv}
          className="rounded-md bg-primary text-primary-foreground px-3 py-2"
        >
          Setup
        </button>
      </div>
      {msg && (
        <div className="md:col-span-3 text-sm text-muted-foreground">{msg}</div>
      )}
    </div>
  )
}
