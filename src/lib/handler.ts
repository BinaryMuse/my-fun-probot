import { Context } from '@binarymuse/probot'

type ProbotHandler = (ctx: Context) => any

interface HandlerFactory {
  build(context: Context): Promise<Handler>
}

export function getHandler(factory: HandlerFactory): ProbotHandler {
  return async (context: Context) => {
    const instance = await factory.build(context)
    instance.handle()
  }
}

export class HasContext {
  protected context: Context

  constructor(context: Context) {
    this.context = context
  }
}

export abstract class Handler extends HasContext {
  abstract handle(): Promise<void>
}

export abstract class HandlerWithConfig<C> extends Handler {
  public readonly config: C

  constructor(context: Context, config: C) {
    super(context)
    this.config = config
  }
}
