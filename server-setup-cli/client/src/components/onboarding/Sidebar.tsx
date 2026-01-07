import { AlertCircle, CheckCircle2, Circle, Loader2 } from 'lucide-react'
import type React from 'react'
import { Card } from '@/components/ui/card'

interface SidebarProps {
  overallStatus: string
  stepStatus: Record<string, string>
  currentStep?: string
}

const stepNames: Record<string, string> = {
  connection: 'Connection',
  deployKey: 'Register Deploy Key',
  database: 'Create Database',
  folder: 'Setup Folder',
  env: 'Folder & .env',
  sshKey: 'Actions SSH Key',
  deployWorkflow: 'Deploy Workflow PR',
}

const StatusIcon: React.FC<{ status: string; isCurrentStep: boolean }> = ({
  status,
  isCurrentStep,
}) => {
  if (status === 'success') {
    return <CheckCircle2 className="w-5 h-5 text-green-600" />
  }
  if (status === 'running') {
    return <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
  }
  if (status === 'failed') {
    return <AlertCircle className="w-5 h-5 text-red-600" />
  }
  if (isCurrentStep) {
    return <Circle className="w-5 h-5 text-blue-600 fill-blue-600" />
  }
  return <Circle className="w-5 h-5 text-gray-400" />
}

export function Sidebar({
  overallStatus,
  stepStatus,
  currentStep,
}: SidebarProps) {
  return (
    <aside className="w-full lg:w-80 pt-8 px-4 lg:px-0 lg:pr-8">
      {/* Summary Card */}
      <Card className="p-6 mb-8 border border-gray-200 rounded-lg shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">
          Overall Status
        </h3>
        <div className="flex items-center gap-3">
          {overallStatus === 'connected' && (
            <>
              <CheckCircle2 className="w-6 h-6 text-green-600" />
              <span className="text-sm font-medium text-green-700">Ready</span>
            </>
          )}
          {overallStatus === 'running' && (
            <>
              <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
              <span className="text-sm font-medium text-blue-700">
                In Progress
              </span>
            </>
          )}
          {overallStatus === 'failed' && (
            <>
              <AlertCircle className="w-6 h-6 text-red-600" />
              <span className="text-sm font-medium text-red-700">Error</span>
            </>
          )}
        </div>
      </Card>

      {/* Steps Card */}
      <Card className="p-6 border border-gray-200 rounded-lg shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">
          Setup Steps
        </h3>
        <div className="space-y-3">
          {Object.entries(stepNames).map(([key, name]) => (
            <div key={key} className="flex items-center gap-3">
              <StatusIcon
                status={stepStatus[key] || 'pending'}
                isCurrentStep={currentStep === key}
              />
              <span className="text-sm text-gray-700">{name}</span>
            </div>
          ))}
        </div>
      </Card>
    </aside>
  )
}
