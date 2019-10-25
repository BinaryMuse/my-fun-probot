import { Context } from "probot"

export interface Config {
  defaultBranch: string
  baseBranch: string
  botName: string
}

export const DEFAULT_CONFIG: Config = {
  defaultBranch: 'develop',
  baseBranch: 'master',
  botName: 'my-fun-probot[bot]'
}

export function withConfig(handler: (ctx: Context, config: Config) => Promise<void>) {
  return async (ctx: Context) => {
    const config = await ctx.config('my-fun-probot.yaml', DEFAULT_CONFIG)
    handler(ctx, config)
  }
}
