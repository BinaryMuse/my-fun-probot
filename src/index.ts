import { Application, Context } from 'probot' // eslint-disable-line no-unused-vars

import PushHandler from './push'
import { Handler } from './lib/handler'

export = (app: Application) => {
  app.on('issue_comment.created', handleIssueComment)
  app.on('push', Handler.generate(PushHandler))
}

async function handleIssueComment (context: Context): Promise<void> {
  // check to see if is a command? or should we just use the plugin?
}
