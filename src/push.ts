import { PullsListResponseItem, PullsListResponse, Response } from '@octokit/rest'
import { Context } from '@binarymuse/probot'

import { Config, DEFAULT_CONFIG } from './config'
import { HandlerWithConfig } from './lib/handler'
import { LockOps } from './lib/lock-ops'
import { Ref, GitOps } from './lib/git-ops'
import generateChangelog, { Changelog } from './lib/commit-parser'

export default class PushHandler extends HandlerWithConfig<Config> {
  private git: GitOps
  private lock: LockOps

  static async build(context: Context): Promise<PushHandler> {
    const config = await context.config('my-fun-probot.yaml', DEFAULT_CONFIG) as Config
    return new this(context, config)
  }

  constructor(context: Context, config: Config) {
    super(context, config)
    this.git = new GitOps(context)
    this.lock = new LockOps(context)
  }

  public async handle() {
    this.context.log(`Got a push! It was on ${this.context.payload.ref}`)
    if (!this.isDefaultBranchPush() && !this.isReleaseBranchPush()) {
      return
    } else if (this.isReleaseBranchPush()) {
      this.handleReleaseBranchPush()
    } else {
      this.handleDefaultBranchPush()
    }
  }

  public async regenerateChangelog() {
    const { owner, repo, number } = this.context.issue()
    this.context.log(`Regenerating changelog for PR #${number} due to the /regenerate command`)
    const pr = await this.context.github.pulls.get({ owner, repo, pull_number: number })
    await this.updateChangelogForPr(pr.data)
  }

  async handleReleaseBranchPush() {
    // A branch we're managing has been updated!
    // Maybe we're waiting for merge conflict resolution,
    // or maybe someone pushed up something to be included
    // in the release. Check the merge conflict stuff and
    // regenerate the release notes.
  }

  async handleDefaultBranchPush() {
    const pushedRef = new Ref(this.context.payload.ref, this.context.payload.after)
    this.context.log(`Received push on ${pushedRef.branch} with sha ${pushedRef.sha}`)
    let pr = await this.findReleasePr(this.config.baseBranch, this.config.botName)
    if (pr) {
      this.updateExistingPr(pr, pushedRef)
    } else {
      this.context.log(`No release PR found, creating...`)
      pr = await this.createReleasePr(this.config.baseBranch)
    }
  }

  async updateExistingPr(pr: PullsListResponseItem, pushedRef: Ref) {
    const { context } = this
    const releasePrRef = new Ref(pr.head.ref, pr.head.sha)
    context.log(`Updating existing release PR #${pr.number} with branch ${releasePrRef.branch} and head ${releasePrRef.shortSha}`)

    const isLocked = await this.lock.isPrLocked(pr.number)
    if (isLocked) {
      context.log(`Aborting updating PR #${pr.number} because it is locked due to a detected merge conflict`)
      return
    }

    const needsBranchUpdate = releasePrRef.sha !== pushedRef.sha
    if (!needsBranchUpdate) {
      return
    }

    try {
      await this.updateBranch(releasePrRef, pushedRef)
      context.log(`Branch ${releasePrRef.branch} (from PR #${pr.number}) has been updated to ${pushedRef.shortSha}`)
    } catch (err) {
      if (err.message === 'Merge conflict') {
        context.log(`Unable to update branch ${releasePrRef.branch} (from PR #${pr.number}) to ${pushedRef.shortSha}. Will comment to report...`)
        const comment = await context.github.issues.createComment(context.repo({
          number: pr.number,
          body: `There is a merge conflict between this branch and ${pushedRef.branch}. This PR will not be updated automatically from ${pushedRef.branch} until the merge conflict is resolved manually.`
        }))
        context.log(`Created comment on PR #${pr.number}: ${comment.data.url}`)
        context.log(`Locking PR #${pr.number}...`)
        await this.lock.lockPr(pr.number)
        context.log(`Locked #${pr.number}`)
        return
      } else {
        throw err
      }
    }

    await this.updateChangelogForPr(pr)
  }

  public async updateChangelogForPr(pr: PullsListResponseItem): Promise<void> {
    const releasePrRef = new Ref(pr.head.ref, pr.head.sha)
    this.context.log(`Finding commits between ${this.config.baseBranch} and ${releasePrRef.branch}`)
    const commits = await this.git.findCommitsBetween(this.config.baseBranch, releasePrRef.branch)
    this.context.log(`Found ${commits.length} commits`)
    const changelog = await generateChangelog(commits)
    this.context.log(`Updating changelog and labels for PR #${pr.number}`)
    await this.context.github.issues.update(this.context.repo({
      issue_number: pr.number,
      body: `${changelog.changelog}\n\nVersion change: ${changelog.bumpType}`,
      labels: this.labelsPlusSemver(pr.labels.map(l => l.name), `semver-${changelog.bumpType}`)
    }))
  }

  isReleaseBranchPush(): boolean {
    return this.context.payload.ref.startsWith('refs/heads/release/')
  }

  isDefaultBranchPush(): boolean {
    return this.context.payload.ref === `refs/heads/${this.config.defaultBranch}`
  }

  labelsPlusSemver(currentLabels: string[], semverLabel: string): string[] {
    const newLabels: Set<string> = new Set()
    newLabels.add(semverLabel)
    currentLabels.forEach(label => {
      if (!label.startsWith('semver-')) {
        newLabels.add(label)
      }
    })

    return Array.from(newLabels)
  }

  // Finds the first open PR in the repo with the associated base branch
  // where the user who opened the PR is the bot user.
  async findReleasePr (baseBranch: string, botName: string): Promise<PullsListResponseItem | null> {
    const prSearch = this.context.repo({
      state: 'open',
      base: baseBranch,
      sort: 'created'
    })
    const pulls = await this.context.github.paginate(
      this.context.github.pulls.list.endpoint.merge(prSearch),
      (response: Response<PullsListResponse>, done: () => void) => {
        for (const pr of response.data) {
          if (pr.user.login === botName) {
            done()
            break
          }
        }
        return response.data
      }
    )

    const pull = pulls.find(pull => pull.user.login === botName)
    return pull || null
  }

  async createReleasePr(baseBranch: string): Promise<PullsListResponseItem> {
    const branchName = `release/${Math.floor(Math.random() * 1000000000)}`
    const newRef = this.context.repo({
      ref: `refs/heads/${branchName}`,
      sha: this.context.payload.after
    })
    await this.context.github.git.createRef(newRef)

    // TODO: we need to figure out changelog and labels
    // before we create this PR

    const commits = await this.git.findCommitsBetween(baseBranch, branchName)
    const changelog = await generateChangelog(commits)

    const existingPr = await this.findReleasePr(baseBranch, this.config.botName)
    if (existingPr) {
      this.context.log(`Aborted creating release PR because one was created while we were waiting`)
      return existingPr
    }

    const newPr = this.context.repo({
      title: 'release branch!',
      head: `refs/heads/${branchName}`,
      base: baseBranch,
      body: `${changelog.changelog}\n\nVersion change: ${changelog.bumpType}`
    })
    const pr = await this.context.github.pulls.create(newPr)
    await this.context.github.issues.addLabels(this.context.repo({
      number: pr.data.number,
      labels: ['release-candidate', `semver-${changelog.bumpType}`]
    }))
    return pr.data
  }

  async updateBranch (baseRef: Ref, headRef: Ref): Promise<void> {
    try {
      this.context.log(`Updating release PR branch ${baseRef.branch} from ${baseRef.shortSha} to ${headRef.shortSha}`)
      await this.git.fastForwardBranch(baseRef, headRef.sha)
    } catch (err) {
      this.context.log(`Fast fowarding branch ${baseRef.branch} failed; attempting a merge instead`)
      await this.git.mergeBranch(baseRef, headRef)
      this.context.log(`Merge successful`)
    }
  }
}

