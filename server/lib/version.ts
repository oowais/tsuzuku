import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Which commit is running, for the startup log line (#92). The image has no git: the Docker build writes the
// commit to the file COMMIT_FILE names, by running this file with Node; a dev server reads .git directly.

const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8').trim() : null)

// The short commit of the repository at `root`, from .git without the git binary; null when there is none.
export function gitCommit(root = process.cwd()): string | null {
  const git = join(root, '.git')
  const head = read(join(git, 'HEAD'))
  if (!head) return null
  if (!head.startsWith('ref: ')) return head.slice(0, 7)
  const ref = head.slice('ref: '.length)
  const loose = read(join(git, ref))
  if (loose) return loose.slice(0, 7)
  const packed = (read(join(git, 'packed-refs')) ?? '').split('\n').find(line => line.endsWith(` ${ref}`))
  return packed ? packed.slice(0, 7) : null
}

export function runningCommit(): string {
  const file = process.env.COMMIT_FILE
  return (file && read(file)) || gitCommit() || 'unknown'
}

// `node server/lib/version.ts` prints the commit (Node strips the types), for the Docker build.
if (import.meta.main) process.stdout.write(gitCommit() ?? 'unknown')
