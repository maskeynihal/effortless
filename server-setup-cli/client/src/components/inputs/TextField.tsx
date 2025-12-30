import * as React from 'react'
import { useForm } from '@tanstack/react-form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { FormValues } from '@/lib/types/onboarding'

export type TextFieldProps = {
  form: ReturnType<typeof useForm<FormValues>>
  name: keyof FormValues
  label: string
  placeholder?: string
  textarea?: boolean
  type?: React.InputHTMLAttributes<HTMLInputElement>['type']
  listId?: string
}

export function TextField({
  form,
  name,
  label,
  placeholder,
  textarea,
  type = 'text',
  listId,
}: TextFieldProps) {
  const Comp = textarea ? Textarea : Input
  return (
    <form.Field name={name as any}>
      {(field) => (
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">
            {label}
          </label>
          <Comp
            {...(textarea ? {} : { type })}
            list={listId}
            value={field.state.value ?? (type === 'number' ? 0 : '')}
            onChange={(
              e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
            ) =>
              field.handleChange(
                type === 'number'
                  ? Number(e.target.value || 0)
                  : e.target.value,
              )
            }
            placeholder={placeholder}
          />
        </div>
      )}
    </form.Field>
  )
}
