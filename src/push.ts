import { PullRequestsListResponseItem } from '@octokit/rest'
import { Maybe } from '@binarymuse/tsmonad'
import { Context } from 'probot' // eslint-disable-line no-unused-vars
import metadata from 'probot-metadata'

import { Config } from './config'

class Ref {
  public readonly branch: string
  public readonly sha: string

  constructor (branch: string, sha: string = '') {
    this.sha = sha
    if (branch.startsWith('refs/heads/')) {
      this.branch = branch.substr(11)
    } else if (branch.startsWith('heads/')) {
      this.branch = branch.substr(6)
    } else {
      this.branch = branch
    }
  }

  get ref () { return `refs/heads/${this.branch}` }
  get shortSha() { return this.sha.substr(0, 8) }
}

async function handlePush (context: Context, config: Config): Promise<void> {
  // TODO: make this configurable, perhaps even a glob?
  if (context.payload.ref.startsWith('/refs/heads/release/')) {
    // this is one of our PRs! We'll ignore it, unless we're waiting
    // for the user to push up a resolution to a merge conflict
    // in which case we'll update the PR

    // 1. Find PR based on the ref
    // 2. See if the PR is locked
    // 3. If it is, see if the merge works now
    // 4. If so, remove the lock!
  } else if (context.payload.ref !== `refs/heads/${config.defaultBranch}`) {
    return
  }

  const pushedRef = new Ref(context.payload.ref, context.payload.after)

  context.log(`Received push on ${pushedRef.branch} with sha ${pushedRef.sha}`)
  const { created, pr } = await findOrCreateReleasePr(context, config)
  const releasePrRef = new Ref(pr.head.ref, pr.head.sha)
  context.log(`${created ? 'Created' : 'Found'} release PR #${pr.number} with branch ${releasePrRef.branch} and head ${releasePrRef.branch}`)

  if (created) {
    const locked = await isPrAutoUpdateLocked(context, pr.number)
    if (locked) {
      context.log(`Aborting updating PR ${pr.number} because there is still a merge conflict`)
      // We've had a merge conflict in the past and we're waiting for the user to deal with it
      return
    }
  }

  const needsBranchUpdate = releasePrRef.sha !== pushedRef.sha
  if (needsBranchUpdate) {
    try {
      await updateBranch(context, releasePrRef, pushedRef)
    } catch (err) {
      if (err.message === 'Merge conflict') {
        await context.github.issues.createComment(context.repo({
          number: pr.number,
          body: `There is a merge conflict between this branch and ${pushedRef.branch}. This PR will not be updated automatically from ${pushedRef.branch} until the merge conflict is resolved manually.`
        }))
        await lockPrAutoUpdates(context, pr.number)
        return
      } else {
        throw err
      }
    }
  }

  if (created || needsBranchUpdate) {
    // update the PR description with semver stuff
    // TODO: if we created the PR, it should have this stuff in it already
  }
}

async function isPrAutoUpdateLocked(context: Context, prNumber: number): Promise<boolean> {
  const issue = context.repo({ number: prNumber })
  const value = await metadata<boolean>(context, issue).get('awaiting_merge_conflict_resolution')
  return value === true
}

async function lockPrAutoUpdates (context: Context, prNumber: number): Promise<void> {
  const issue = context.repo({ number: prNumber })
  await metadata<boolean>(context, issue).set('awaiting_merge_conflict_resolution', true)
}

async function updateBranch (context: Context, baseRef: Ref, headRef: Ref): Promise<void> {
  try {
    context.log(`Updating release PR branch ${baseRef.branch} from ${baseRef.shortSha} to ${headRef.shortSha}`)
    await fastForwardBranch(context, baseRef, headRef.sha)
  } catch (err) {
    context.log(`Fast fowarding branch ${baseRef.branch} failed; attempting a merge instead`)
    await mergeBranch(context, baseRef, headRef)
    context.log(`Merge successful`)
  }
}

async function fastForwardBranch (context: Context, refToUpdate: Ref, newHeadSha: string): Promise<void> {
  await context.github.gitdata.updateRef(context.repo({
    ref: `heads/${refToUpdate.branch}`, // note: do not include 'refs/` or the API call will fail
    sha: newHeadSha
  }))
}

async function mergeBranch (context: Context, refToUpdate: Ref, refToCopy: Ref): Promise<void> {
  await context.github.repos.merge(context.repo({
    base: refToUpdate.branch,
    head: refToCopy.branch,
    commit_message: `Auto-merging ${refToCopy.branch} into ${refToUpdate.branch}`
  }))
}

async function findOrCreateReleasePr (context: Context, config: Config): Promise<{ created: boolean, pr: PullRequestsListResponseItem }> {
  const existingPr = await findExistingReleasePr(context, config)
  const created = existingPr.caseOf({
    just: val => false,
    nothing: () => true
  })
  const pr = await existingPr.valueOrComputeAsync(() => createReleasePr(context, config))

  return { created, pr }
}

async function findExistingReleasePr (context: Context, config: Config): Promise<Maybe<PullRequestsListResponseItem>> {
  const prSearch = context.repo({
    state: 'open',
    base: config.baseBranch,
    sort: 'created'
  })
  const pulls = await context.github.paginate(
    context.github.pullRequests.list(prSearch),
    (response, done) => {
      for (const pr of response.data) {
        if (pr.user.login === config.botName) {
          done!()
          break
        }
      }
      return response.data
    }
  )

  const pull = pulls.find(pull => pull.user.login === config.botName)
  return pull ? Maybe.just(pull) : Maybe.nothing()
}

async function createReleasePr(context: Context, config: Config): Promise<PullRequestsListResponseItem> {
  const branchName = `release/${Math.floor(Math.random() * 1000000000)}`
  const newRef = context.repo({
    ref: `refs/heads/${branchName}`,
    sha: context.payload.after
  })
  await context.github.gitdata.createRef(newRef)

  const newPr = context.repo({
    title: 'release branch!',
    head: `refs/heads/${branchName}`,
    base: config.baseBranch
  })
  const pr = await context.github.pullRequests.create(newPr)
  await context.github.issues.addLabels(context.repo({
    number: pr.data.number,
    labels: ['release-candidate', 'semver-pending']
  }))
  return pr.data
}

export = handlePush
