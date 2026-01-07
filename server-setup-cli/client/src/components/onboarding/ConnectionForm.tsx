import * as React from 'react'
import type { useForm } from '@tanstack/react-form'
import type { FormValues } from '@/lib/types/onboarding'
import type {Connections} from '@/lib/queries/useOnboarding';
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { TextField } from '@/components/inputs/TextField'
import {
  
  useVerifyConnection
} from '@/lib/queries/useOnboarding'

interface ConnectionFormProps {
  form: ReturnType<typeof useForm<FormValues>>
  onVerified?: (result: {
    message: string
    sessionId: string
    connections: Connections
  }) => void
}

export function ConnectionForm({ form, onVerified }: ConnectionFormProps) {
  const verify = useVerifyConnection()
  const values = form.useStore((state) => state.values)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connection & Identity</CardTitle>
        <CardDescription>
          Required once; persists in local storage.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <TextField
            form={form}
            name="host"
            label="Host"
            placeholder="server.example.com"
          />
          <TextField
            form={form}
            name="username"
            label="SSH user"
            placeholder="ubuntu"
          />
          <TextField form={form} name="port" label="Port" type="number" />
          <TextField
            form={form}
            name="applicationName"
            label="Application"
            placeholder="my-app"
          />
        </div>
        <TextField
          form={form}
          name="privateKeyContent"
          label="SSH private key"
          textarea
          placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
        />
      </CardContent>
      <CardFooter className="flex justify-end gap-3">
        <Button
          type="button"
          disabled={verify.isPending}
          onClick={async () => {
            const v = values
            if (
              !v.host ||
              !v.username ||
              !v.applicationName ||
              !v.privateKeyContent
            )
              return
            const result = await verify.mutateAsync({
              host: v.host,
              username: v.username,
              port: v.port,
              privateKeyContent: v.privateKeyContent,
              githubToken: v.githubToken || undefined,
              applicationName: v.applicationName,
            })
            if (result?.sessionId) {
              form.setFieldValue('sessionId', result.sessionId)
            }
            onVerified?.(result)
          }}
        >
          {verify.isPending ? 'Verifying…' : 'Verify connection'}
        </Button>
      </CardFooter>
    </Card>
  )
}
