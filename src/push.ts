import { PullRequestsListResponseItem } from '@octokit/rest'
import { Maybe } from '@binarymuse/tsmonad'
import metadata from 'probot-metadata'

import { Config, DEFAULT_CONFIG } from './config'
import { Handler } from './lib/handler'


class PushHandler extends Handler {
  private getConfig(): Promise<Config> {
    return this.context.config('my-fun-probot.yaml', DEFAULT_CONFIG)
  }

  public async handle() {
    const context = this.context
    const config = await this.getConfig()
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
    const { created, pr } = await this.findOrCreateReleasePr(config)
    const releasePrRef = new Ref(pr.head.ref, pr.head.sha)
    context.log(`${created ? 'Created' : 'Found'} release PR #${pr.number} with branch ${releasePrRef.branch} and head ${releasePrRef.branch}`)

    if (created) {
      const locked = await this.isPrAutoUpdateLocked(pr.number)
      if (locked) {
        context.log(`Aborting updating PR ${pr.number} because there is still a merge conflict`)
        // We've had a merge conflict in the past and we're waiting for the user to deal with it
        return
      }
    }

    const needsBranchUpdate = releasePrRef.sha !== pushedRef.sha
    if (needsBranchUpdate) {
      try {
        await this.updateBranch(releasePrRef, pushedRef)
      } catch (err) {
        if (err.message === 'Merge conflict') {
          await context.github.issues.createComment(context.repo({
            number: pr.number,
            body: `There is a merge conflict between this branch and ${pushedRef.branch}. This PR will not be updated automatically from ${pushedRef.branch} until the merge conflict is resolved manually.`
          }))
          await this.lockPrAutoUpdates(pr.number)
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

  async isPrAutoUpdateLocked(prNumber: number): Promise<boolean> {
    const issue = this.context.repo({ number: prNumber })
    const value = await metadata<boolean>(this.context, issue).get('awaiting_merge_conflict_resolution')
    return value === true
  }

  async lockPrAutoUpdates (prNumber: number): Promise<void> {
    const issue = this.context.repo({ number: prNumber })
    await metadata<boolean>(this.context, issue).set('awaiting_merge_conflict_resolution', true)
  }

  async updateBranch (baseRef: Ref, headRef: Ref): Promise<void> {
    try {
      this.context.log(`Updating release PR branch ${baseRef.branch} from ${baseRef.shortSha} to ${headRef.shortSha}`)
      await this.fastForwardBranch(baseRef, headRef.sha)
    } catch (err) {
      this.context.log(`Fast fowarding branch ${baseRef.branch} failed; attempting a merge instead`)
      await this.mergeBranch(baseRef, headRef)
      this.context.log(`Merge successful`)
    }
  }

  async fastForwardBranch (refToUpdate: Ref, newHeadSha: string): Promise<void> {
    await this.context.github.gitdata.updateRef(this.context.repo({
      ref: `heads/${refToUpdate.branch}`, // note: do not include 'refs/` or the API call will fail
      sha: newHeadSha
    }))
  }

  async mergeBranch (baseRef: Ref, headRef: Ref): Promise<void> {
    await this.context.github.repos.merge(this.context.repo({
      base: baseRef.branch,
      head: headRef.branch,
      commit_message: `Auto-merging ${headRef.branch} into ${baseRef.branch}`
    }))
  }

  async findOrCreateReleasePr (config: Config): Promise<{ created: boolean, pr: PullRequestsListResponseItem }> {
    const existingPr = await this.findExistingReleasePr(config.baseBranch, config.botName)
    const created = existingPr.caseOf({
      just: () => false,
      nothing: () => true
    })
    const pr = await existingPr.valueOrComputeAsync(() => this.createReleasePr(config.baseBranch))

    return { created, pr }
  }

  async findExistingReleasePr (baseBranch: string, botName: string): Promise<Maybe<PullRequestsListResponseItem>> {
    const prSearch = this.context.repo({
      state: 'open',
      base: baseBranch,
      sort: 'created'
    })
    const pulls = await this.context.github.paginate(
      this.context.github.pullRequests.list(prSearch),
      (response, done) => {
        for (const pr of response.data) {
          if (pr.user.login === botName) {
            done!()
            break
          }
        }
        return response.data
      }
    )

    const pull = pulls.find(pull => pull.user.login === botName)
    return pull ? Maybe.just(pull) : Maybe.nothing()
  }

  async createReleasePr(baseBranch: string): Promise<PullRequestsListResponseItem> {
    const branchName = `release/${Math.floor(Math.random() * 1000000000)}`
    const newRef = this.context.repo({
      ref: `refs/heads/${branchName}`,
      sha: this.context.payload.after
    })
    await this.context.github.gitdata.createRef(newRef)

    const newPr = this.context.repo({
      title: 'release branch!',
      head: `refs/heads/${branchName}`,
      base: baseBranch
    })
    const pr = await this.context.github.pullRequests.create(newPr)
    await this.context.github.issues.addLabels(this.context.repo({
      number: pr.data.number,
      labels: ['release-candidate', 'semver-pending']
    }))
    return pr.data
  }
}



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

export = PushHandler
