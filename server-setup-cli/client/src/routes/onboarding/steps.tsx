import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/onboarding/steps')({
  component: Steps,
})

function Steps() {
  const sessionId = React.useMemo(()=>localStorage.getItem('sessionId')||'', [])
  const [status, setStatus] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [inputs, setInputs] = React.useState<any>({ githubToken: '', selectedRepo: '' })

  async function refresh() {
    const res = await fetch(`/api/workflow/${sessionId}/status`)
    const json = await res.json(); setStatus(json)
  }
  React.useEffect(()=>{ refresh() }, [])

  async function runCurrent() {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/workflow/${sessionId}/execute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputs)
      })
      const json = await res.json(); if (!res.ok) throw new Error(json.error||'Failed')
      await refresh()
    } catch (e:any) { setError(e.message) } finally { setLoading(false) }
  }

  if (!sessionId) return <div>No session. Start at init.</div>
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Steps</h3>
      {error && <div className="text-red-600">{error}</div>}
      <div className="rounded-md border p-4">
        <div className="flex items-center justify-between">
          <div>Current: <strong>{status?.currentStep||'—'}</strong></div>
          <button onClick={runCurrent} disabled={loading}
            className="rounded-md bg-primary text-primary-foreground px-3 py-1">Run</button>
        </div>
        <div className="mt-3 grid gap-2">
          <input placeholder="GitHub Token" value={inputs.githubToken}
            onChange={(e)=>setInputs((p:any)=>({ ...p, githubToken: e.target.value }))}
            className="rounded-md border px-3 py-2" />
          <input placeholder="Selected Repo (owner/name)" value={inputs.selectedRepo}
            onChange={(e)=>setInputs((p:any)=>({ ...p, selectedRepo: e.target.value }))}
            className="rounded-md border px-3 py-2" />
        </div>
      </div>

      <div className="rounded-md border p-4">
        <h4 className="font-medium">All Steps</h4>
        <ul className="list-disc pl-6">
          {status?.steps?.map((s:string)=> <li key={s}>{s}</li>)}
        </ul>
      </div>

      <div className="rounded-md border p-4">
        <h4 className="font-medium">History</h4>
        <ul className="list-disc pl-6">
          {status?.history?.map((h:any, i:number)=> <li key={i}>{h.timestamp}: {h.event}</li>)}
        </ul>
      </div>
    </div>
  )
}
