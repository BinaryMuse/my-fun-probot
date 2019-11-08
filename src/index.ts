import { Application, Context } from '@binarymuse/probot' // eslint-disable-line no-unused-vars
import commands from 'probot-commands'

import PushHandler from './push'
import { getHandler } from './lib/handler'

export = (app: Application) => {
  // app.on('issue_comment.created', handleIssueComment)
  app.on('push', getHandler(PushHandler))
  commands(app, 'regenerate', async (context, command) => {
    // hacky: calling a public method on the push handler
    // as the code is shared
    const handler = await PushHandler.build(context)
    handler.regenerateChangelog()
  })
}

async function handleIssueComment (context: Context): Promise<void> {
  // check to see if is a command? or should we just use the plugin?
}
