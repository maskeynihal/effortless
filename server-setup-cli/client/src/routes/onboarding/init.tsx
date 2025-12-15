import * as React from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

export const Route = createFileRoute('/onboarding/init')({
  component: Init,
})

function Init() {
  const nav = useNavigate()
  const [form, setForm] = React.useState({
    host: '', username: '', port: 22,
    sshKeyName: '', sshPrivateKey: '', applicationName: '',
  })
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/workflow/init', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed')
      localStorage.setItem('sessionId', json.sessionId)
      nav({ to: '/onboarding/steps' })
    } catch (err: any) {
      setError(err.message)
    } finally { setLoading(false) }
  }
  return (
    <form onSubmit={submit} className="space-y-4 max-w-xl">
      <h3 className="text-lg font-semibold">Initialize Session</h3>
      {error && <div className="text-red-600">{error}</div>}
      {['host','username','sshKeyName','applicationName'].map((k) => (
        <input key={k} placeholder={k} value={(form as any)[k]}
          onChange={(e)=>setForm(prev=>({ ...prev, [k]: e.target.value }))}
          className="w-full rounded-md border px-3 py-2" />
      ))}
      <textarea placeholder="sshPrivateKey" value={form.sshPrivateKey}
        onChange={(e)=>setForm(prev=>({ ...prev, sshPrivateKey: e.target.value }))}
        className="w-full h-40 rounded-md border px-3 py-2" />
      <button disabled={loading} className="rounded-md bg-primary text-primary-foreground px-4 py-2">
        {loading ? 'Starting…' : 'Start'}
      </button>
    </form>
  )
}
