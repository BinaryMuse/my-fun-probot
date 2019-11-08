import { Commit } from './git-ops'
import { Writable, Transform } from 'stream'
import split2 from 'split2'
import commitParser from 'conventional-commits-parser'

type BumpType = 'major' | 'minor' | 'patch' | 'unknown' | 'none'

export interface Changelog {
  bumpType: BumpType
  changelog: string
}

interface Changeset {
  bumpType: BumpType
  categories: {
    [key: string]: ChangesetCategory
  }
}

interface ChangesetCategory {
  name: Heading
  order: number
  items: ChangesetItem[]
  subcategories: {
    [key: string]: ChangesetCategory
  }
}

interface ChangesetItem {
  message: string
  breakingChange?: string
  pullNum: number | null
}

interface ParsedCommit {
  type: string | null
  scope: string | null
  subject: string | null

  pullNumber: string | null
  pullForkOwner: string | null
  pullBranch: string | null
  notes: Array<{text: string, title: string}>
}

type Heading = 'Breaking Changes' | 'Features' | 'Bug Fixes' | 'Internals' | 'Documentation' | 'Other'

const HEADING_ORDERS: Heading[] = [
  'Breaking Changes',
  'Features',
  'Bug Fixes',
  'Internals',
  'Documentation',
  'Other'
]

const commitParserOptions = {
  // Same as default, but includes dash, underscore, and space in the change type
  headerPattern: /^([\w-_\ ]*)(?:\(([\w\$\.\-\* ]*)\))?\: (.*)$/,
  mergePattern: /^Merge pull request #(\d+) from ([^/]+)\/(.*)$/,
  mergeCorrespondence: ['pullNumber', 'pullForkOwner', 'pullBranch']
}

function typeToHeading (type: string): Heading {
  switch (type.toLowerCase()) {
    case 'breaking':
    case 'breaking change':
      return 'Breaking Changes'
    case 'feat':
      return 'Features'
    case 'fix':
      return 'Bug Fixes'
    case 'chore':
    case 'refactor':
    case 'internal':
    case 'perf':
      return 'Internals'
    case 'docs':
      return 'Documentation'
    default:
      return 'Other'
  }
}

export default async function generateChangelog (commits: ReadonlyArray<Commit>): Promise<Changelog> {
  const changeset = await makeChangesetObject(commits)
  const str = await makeChangelogString(changeset)

  return { bumpType: changeset.bumpType, changelog: str }
}

export async function makeChangelogString (changeset: Changeset): Promise<string> {
  let res = ''
  // let parts = []
  Object.keys(changeset.categories)
    .sort((a, b) => HEADING_ORDERS.indexOf(changeset.categories[a].name) - HEADING_ORDERS.indexOf(changeset.categories[b].name))
    .forEach(key => {
      const cat = changeset.categories[key]
      res += `## ${capitalize(cat.name)}\n`
      if (cat.items.length > 0) {
        res += cat.items.reduce((acc, item) => `${acc}* ${formatChangesetItem(item)}\n`, '\n')
      }
      res += '\n'

      Object.keys(cat.subcategories).forEach(subkey => {
        const subcat = cat.subcategories[subkey]
        res += `### ${capitalize(subcat.name)}\n`
        if (subcat.items.length > 0) {
          res += subcat.items.reduce((acc, item) => `${acc}* ${formatChangesetItem(item)}\n`, '\n')
        }
        res += '\n'
      })
    })

  return res.trim()
}

async function makeChangesetObject (commits: ReadonlyArray<Commit>): Promise<Changeset> {
  let bumpLevel = 0
  const changelog: Changeset = {
    bumpType: 'none',
    categories: {}
  }

  const parsed = commits.map(c => parseCommit(c.message))
  parsed.forEach(commit => {
    const type = commit.type
    if (type === null) {
      return
    }
    switch (type.toLowerCase()) {
      case 'chore':
      case 'docs':
      case 'style':
      case 'refactor':
      case 'perf':
      case 'test':
      case 'fix':
      case 'internal':
        bumpLevel = Math.max(bumpLevel, 1) // patch
        break
      case 'feat':
        bumpLevel = Math.max(bumpLevel, 2) // minor
        break
      case 'breaking change':
        bumpLevel = Math.max(bumpLevel, 3) // major
        break
      default:
        bumpLevel = 4 // an invalid type
    }

    const breakingChangeNote = commit.notes.find(n => ['breaking', 'breaking change'].includes(n.title.toLowerCase()))
    if (breakingChangeNote) {
      bumpLevel = Math.max(bumpLevel, 3)
    }

    changelog.categories[type] = changelog.categories[type] || {
      name: typeToHeading(type),
      items: [],
      subcategories: {}
    }
    const category = changelog.categories[type]

    const lineItem = makeChangelogLineItem(commit, breakingChangeNote && breakingChangeNote.text)
    if (commit.scope) {
      category.subcategories[commit.scope] = category.subcategories[commit.scope] || {
        name: commit.scope,
        items: [],
        subcategories: {}
      }
      const subcat = category.subcategories[commit.scope]
      addChangesetLineItem(subcat.items, lineItem)
    } else {
      addChangesetLineItem(category.items, lineItem)
    }
  })

  switch (bumpLevel) {
    case 0:
      changelog.bumpType = 'none'
      break
    case 1:
      changelog.bumpType = 'patch'
      break
    case 2:
      changelog.bumpType = 'minor'
      break
    case 3:
      changelog.bumpType = 'major'
      break
    case 4:
      changelog.bumpType = 'unknown'
      break
  }
  return changelog
}

function addChangesetLineItem(array: ChangesetItem[], item: ChangesetItem): void {
  const duplicateMessage = array.find(i => i.message === item.message)
  if (duplicateMessage) {
    // Sometimes the PR title and a commit has the same message
    // Ignore the commit in this case
    duplicateMessage.pullNum = duplicateMessage.pullNum || item.pullNum
  } else {
    array.push(item)
  }
}

export function parseCommit (message: string): ParsedCommit {
  return commitParser.sync(message, commitParserOptions)
}

function makeChangelogLineItem (commit: ParsedCommit, breakingChange: string | undefined): ChangesetItem {
  let str = commit.subject || ''

  return {
    message: str,
    breakingChange: breakingChange,
    pullNum: commit.pullNumber ? parseInt(commit.pullNumber, 10) : null
  }
}

function formatChangesetItem(item: ChangesetItem): string {
  let str = item.message
  if (item.pullNum) {
    str += ` (#${item.pullNum})`
  }

  if (item.breakingChange) {
    str += `\n  **Breaking Change**: ${item.breakingChange}`
  }

  return str
}

async function parseCommits (commits: ReadonlyArray<Commit>): Promise<ReadonlyArray<ParsedCommit>> {
  return new Promise((resolve, reject) => {
    const parsed: any[] = []
    const stream: Writable = split2()
      .pipe(stripQuotes())
      // .pipe(fixNewlines())
      .pipe(commitParser(commitParserOptions))
      .on('data', (commit: any) => {
        parsed.push(commit)
      })
    stream.on('error', err => reject(err))
    stream.on('end', () => resolve(parsed))
    commits.forEach(commit => stream.write(commit.message))
    stream.end()
  })
}

function stripQuotes () {
  return new Transform({
    transform(chunk, encoding, callback) {
      callback(null, chunk.toString().replace(/^\"(.*)\"$/, '$1'))
    }
  })
}

function fixNewlines () {
  return new Transform({
    transform(chunk, encoding, callback) {
      callback(null, chunk.toString().replace(/\\n/g, '\n'))
    }
  })
}

function capitalize(str: string): string {
  return str[0].toUpperCase() + str.substr(1)
}
