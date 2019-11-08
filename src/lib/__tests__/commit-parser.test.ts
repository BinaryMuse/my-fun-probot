import assert from 'assert'
import dedent from 'dedent'

import { Commit } from "../git-ops"
import generateChangelog, { parseCommit } from '../commit-parser'

describe('Commit parser', () => {
  test('parses a commit', async () => {
    const commit = 'Merge pull request #123 from probot/mkt/typescript\n\nfeat(typescript): Introduce typings'
    const parsed = parseCommit(commit)
    assert.equal(parsed.type, 'feat')
    assert.equal(parsed.scope, 'typescript')
    assert.equal(parsed.subject, 'Introduce typings')
    assert.equal(parsed.pullNumber, '123')
    assert.equal(parsed.pullBranch, 'mkt/typescript')
    assert.equal(parsed.pullForkOwner, 'probot')
  })

  test('parses a commit with notes', async () => {
    const commit = 'Merge pull request #123 from probot/mkt/typescript\n\nfeat(typescript): Introduce typings\n\nbreaking change: stuff broke'
    const parsed = parseCommit(commit)
    assert.equal(parsed.type, 'feat')
    assert.equal(parsed.scope, 'typescript')
    assert.equal(parsed.subject, 'Introduce typings')
    assert.equal(parsed.pullNumber, '123')
    assert.equal(parsed.pullBranch, 'mkt/typescript')
    assert.equal(parsed.pullForkOwner, 'probot')
    assert.deepEqual(parsed.notes, [{text: 'stuff broke', title: 'breaking change'}])
  })

  test('parses a commit with a breaking change', async () => {
    const commit = 'Merge pull request #123 from probot/mkt/typescript\n\nbreaking change: Modify typings'
    const parsed = parseCommit(commit)
    assert.equal(parsed.type, 'breaking change')
    assert.equal(parsed.scope, null)
    assert.equal(parsed.subject, 'Modify typings')
    assert.equal(parsed.pullNumber, '123')
    assert.equal(parsed.pullBranch, 'mkt/typescript')
    assert.equal(parsed.pullForkOwner, 'probot')
  })

  test('generates a changelog', async () => {
    const commits: Commit[] = [
      { message: 'fix(typescript): Fix bad typings\n\nbreaking change: TypeScript typings have changed', sha: 'asdf' },
      { message: 'Merge pull request #123 from probot/mkt/typescript\n\nfeat(typescript): Introduce typescript typings', sha: 'asdf' },
      { message: 'Merge pull request #456 from probot/mkt/fix-release\n\nchore(release): Fix release script', sha: 'asdf' },
      { message: 'chore(release): Fix release script', sha: 'asdf' },
      { message: 'feat(typescript): Introduce typescript typings', sha: 'asdf' },
      { message: 'BREAKING CHANGE: Update exports', sha: 'asdf' },
      { message: 'Merge pull request #234 from probot/mkt/fixing-things\n\nfix: fix a bug', sha: 'asdf' },
      { message: 'a commit with a non-semantic message', sha: 'asdf' },
    ]

    const changelog = await generateChangelog(commits)
    const expected = dedent`
    ## Breaking Changes

    * Update exports

    ## Features

    ### Typescript

    * Introduce typescript typings (#123)

    ## Bug Fixes

    * fix a bug (#234)

    ### Typescript

    * Fix bad typings
      **Breaking Change**: TypeScript typings have changed

    ## Internals

    ### Release

    * Fix release script (#456)
    `
    assert.equal(changelog.changelog, expected)
    assert.equal(changelog.bumpType, 'major')
  })
})
