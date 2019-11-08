
declare module 'probot-commands' {
  import { Application, Context } from '@binarymuse/probot'

  interface Command {
    name: string
    arguments: ReadonlyArray<string>
  }
  type CommandCallback = (context: Context, command: Command) => void
  function commands(robot: Application, command: string, callback: CommandCallback)

  export = commands
}

