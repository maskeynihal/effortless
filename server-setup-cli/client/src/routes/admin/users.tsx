import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/users')({
  component: Users,
})

function Users() {
  const [host, setHost] = React.useState('')
  const [users, setUsers] = React.useState<any[]>([])
  async function load() {
    const res = await fetch(`/api/admin/users?host=${encodeURIComponent(host)}`)
    const json = await res.json(); setUsers(json.users||[])
  }
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Admin Users</h3>
      <div className="flex gap-2">
        <input value={host} onChange={(e)=>setHost(e.target.value)} placeholder="Host"
          className="rounded-md border px-3 py-2" />
        <button onClick={load} className="rounded-md bg-primary text-primary-foreground px-3 py-2">Load</button>
      </div>
      <ul className="list-disc pl-6">
        {users.map((u)=> <li key={u.username}>{u.username} ({u.host})</li>)}
      </ul>
    </div>
  )
}
