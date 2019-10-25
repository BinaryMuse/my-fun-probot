import { Application, Context } from 'probot' // eslint-disable-line no-unused-vars

import { withConfig } from './config'
import handlePush from './push'

export = (app: Application) => {
  app.on('issue_comment.created', withConfig(handleIssueComment))
  app.on('push', withConfig(handlePush))
}

async function handleIssueComment (context: Context): Promise<void> {
  // check to see if is a command? or should we just use the plugin?
}
