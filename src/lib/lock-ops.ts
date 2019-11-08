import metadata from 'probot-metadata'
import { HasContext } from './handler'

export class LockOps extends HasContext {
  async isPrLocked(prNumber: number): Promise<boolean> {
    const issue = this.context.repo({ issue_number: prNumber })
    const value = await metadata<boolean>(this.context, issue).get('locked_bc_merge_conflict')
    return value === true
  }

  async lockPr (prNumber: number): Promise<void> {
    return this.setPrLocked(prNumber, true)
  }

  async unlockPr (prNumber: number): Promise<void> {
    return this.setPrLocked(prNumber, false)
  }

  protected async setPrLocked(prNumber: number, locked: boolean): Promise<void> {
    const issue = this.context.repo({ issue_number: prNumber })
    await metadata<boolean>(this.context, issue).set('locked_bc_merge_conflict', locked)
  }
}
