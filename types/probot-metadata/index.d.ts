declare module 'probot-metadata' {
  import { Context } from 'probot'
  import { IssuesGetParams } from '@octokit/rest';

  function metadata<T = any>(context: Context, issue: IssuesGetParams | null): {
    set: (key: string, value: T) => Promise<void>,
    get: (key: string) => Promise<T | undefined>
  }

  export = metadata
}
