import { Context } from 'probot'

type HandlerConstructor = new(ctx: Context) => Handler

export abstract class Handler {
  public readonly context: Context

  public static generate(ctor: HandlerConstructor) {
    return (context: Context) => {
      const instance = new ctor(context)
      return instance.handle()
    }
  }

  constructor(context: Context) {
    this.context = context
  }

  abstract handle(): Promise<void>
}
