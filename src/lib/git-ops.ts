
import { HasContext } from './handler'
import { ReposListCommitsResponseItem, Response } from '@octokit/rest'

export interface Commit {
  message: string,
  sha: string
}

export class Ref {
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

export class GitOps extends HasContext {
  async fastForwardBranch (refToUpdate: Ref, newHeadSha: string): Promise<void> {
    await this.context.github.git.updateRef(this.context.repo({
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

  async findCommitsBetween(baseCommittish: string, headCommittish: string): Promise<ReadonlyArray<Commit>> {
    let commits: Commit[] = []

    try {
      let diff = await this.context.github.repos.compareCommits(this.context.repo({
        base: baseCommittish,
        head: headCommittish
      }))
      const data = diff.data as GithubReposCompareCommitsResponse
      const numCommits = data.total_commits
      if (numCommits > data.commits.length) {
        // The API only returned a subset of commits to us.
        // Fallback to an alternative strategy
        throw new Error(`Incomplete commit set returned from compare API`)
      }
      commits = data.commits.map(c => ({
        message: c.commit.message,
        sha: c.sha,
      }))
      return commits
    } catch (err) {
      // 2. Diff failed. Use the commit API and start walking
      // First, we need the sha of the baseCommittish
      const sha: string = await this.context.github.repos.getCommit(this.context.repo({
        ref: baseCommittish,
        mediaType: {
          format: 'sha'
        }
      })) as unknown as string // TODO: is this right at all??
      const commits = await this.context.github.paginate(
        this.context.github.repos.listCommits.endpoint.merge(this.context.repo({
          sha: headCommittish,
          per_page: 100
        })),
        (response: Response<ReposListCommitsResponseItem[]>, done: () => void) => {
          const commits: Commit[] = []
          for (const commit of response.data) {
            if (commit.sha === sha) {
              done()
              return commits
            } else {
              commits.push({
                sha: commit.sha,
                message: commit.commit.message
              })
            }
          }

          return commits
        }
      )
      return commits
    }
  }
}

// This doesn't seem to exist in octokit's types
interface GithubReposCompareCommitsResponse {
  total_commits: number
  commits: GithubReposCompareCommitsCommit[]
}

interface GithubReposCompareCommitsCommit {
  sha: string
  commit: {
    message: string
  }
}
