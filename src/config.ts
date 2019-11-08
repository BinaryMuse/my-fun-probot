export interface Config {
  defaultBranch: string
  baseBranch: string
  botName: string
}

export const DEFAULT_CONFIG: Config = {
  defaultBranch: 'develop',
  baseBranch: 'master',
  botName: 'semantic-pr[bot]'
}
