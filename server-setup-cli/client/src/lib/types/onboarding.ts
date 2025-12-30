export type FormValues = {
  host: string
  username: string
  port: number
  applicationName: string
  privateKeyContent: string
  githubToken: string
  selectedRepo: string
  pathname: string
  baseBranch: string
  sshPath: string
  dbType: 'MySQL' | 'PostgreSQL'
  dbPort: number
  dbName: string
  dbUsername: string
  dbPassword: string
  sessionId: string
}
