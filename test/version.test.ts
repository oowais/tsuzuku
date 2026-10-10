import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { gitCommit } from '../server/lib/version'

const repo = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), 'tsuzuku-version-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, '.git', path, '..'), { recursive: true })
    writeFileSync(join(root, '.git', path), text)
  }
  return root
}

describe('running commit (#92)', () => {
  const sha = '02a48d7c0ffee0000000000000000000000000ab'

  it('follows HEAD to a branch ref, a packed ref, or takes a detached HEAD as is', () => {
    expect(gitCommit(repo({ 'HEAD': 'ref: refs/heads/main\n', 'refs/heads/main': `${sha}\n` }))).toBe('02a48d7')
    expect(gitCommit(repo({ 'HEAD': 'ref: refs/heads/main\n', 'packed-refs': `# pack-refs\n${sha} refs/heads/main\n` }))).toBe('02a48d7')
    expect(gitCommit(repo({ HEAD: `${sha}\n` }))).toBe('02a48d7')
  })

  it('is null without a repository', () => {
    expect(gitCommit(mkdtempSync(join(tmpdir(), 'tsuzuku-version-')))).toBeNull()
  })
})
