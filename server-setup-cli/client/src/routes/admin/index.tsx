import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { apiService } from '../../lib/api-service'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'

export const Route = createFileRoute('/admin/')({
  component: Admin,
})

function Admin() {
  const [host, setHost] = React.useState('')
  const [username, setUsername] = React.useState('')
  const [adminUsers, setAdminUsers] = React.useState<Array<any>>([])
  const [isAdmin, setIsAdmin] = React.useState<boolean | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const handleCheckAdmin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      if (!host || !username) {
        throw new Error('Please fill in all fields')
      }

      const response = await apiService.api
        .get('/admin/check', {
          params: { host, username },
        })
        .then((res) => res.data)

      setIsAdmin(response.isAdmin)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleFetchAdminUsers = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await apiService.api
        .get('/admin/users')
        .then((res) => res.data)
      setAdminUsers(response.adminUsers || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold">Admin Management</h2>
        <p className="text-muted-foreground mt-2">
          Manage admin users and permissions
        </p>
      </div>

      <Card className="p-6">
        <h3 className="text-xl font-semibold mb-4">Check Admin Status</h3>

        <form onSubmit={handleCheckAdmin} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-100 text-red-800 rounded">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Host</Label>
              <Input
                placeholder="192.168.1.1"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Username</Label>
              <Input
                placeholder="root"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
          </div>

          <Button type="submit" disabled={loading}>
            {loading ? 'Checking...' : 'Check Status'}
          </Button>
        </form>

        {isAdmin !== null && (
          <div
            className={`mt-4 p-4 rounded ${isAdmin ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}
          >
            {isAdmin ? '✓ User is an admin' : '⚠ User is not an admin'}
          </div>
        )}
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold">Admin Users</h3>
          <Button onClick={handleFetchAdminUsers} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </Button>
        </div>

        {adminUsers.length > 0 && (
          <div className="grid gap-3">
            {adminUsers.map((admin, idx) => (
              <div key={idx} className="p-3 border rounded-md">
                <p className="font-medium">
                  {admin.username}@{admin.host}
                </p>
                {admin.promotedAt && (
                  <p className="text-xs text-muted-foreground">
                    Promoted on{' '}
                    {new Date(admin.promotedAt).toLocaleDateString()}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {adminUsers.length === 0 && !loading && (
          <p className="text-muted-foreground">No admin users found</p>
        )}
      </Card>
    </div>
  )
}
