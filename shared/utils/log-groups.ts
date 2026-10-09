// The Log page's grouping (#74). Writes less than SESSION_GAP_MS apart form one session; within a session, the
// writes of one confirm (same markId) are one mark. Entries logged before markId existed join a mark of the
// same show when they are a different source and within MARK_WINDOW_MS of it.

export const SESSION_GAP_MS = 3 * 60 * 60 * 1000
export const MARK_WINDOW_MS = 60 * 1000

export interface LogEntry {
  id: number
  at: string | Date
  source: string
  rowKey: string
  markId: string | null
  title: string
  episode: string
  summary: string
  listStatus: string | null
  result: 'ok' | 'error'
  error: string | null
}

export interface LogMark {
  key: string
  at: Date
  title: string
  // Trakt, Simkl, MAL order.
  entries: LogEntry[]
  ok: boolean
}

export interface LogSession {
  start: Date
  end: Date
  marks: LogMark[]
  shows: number
}

const ORDER = ['trakt', 'simkl', 'mal']
const time = (e: LogEntry) => new Date(e.at).getTime()

// Entries newest first in, sessions newest first out, marks newest first inside.
export function groupLog(entries: LogEntry[]): LogSession[] {
  const sorted = [...entries].sort((a, b) => time(b) - time(a) || b.id - a.id)
  const sessions: LogEntry[][] = []
  for (const e of sorted) {
    const current = sessions.at(-1)
    if (current && time(current.at(-1)!) - time(e) < SESSION_GAP_MS) current.push(e)
    else sessions.push([e])
  }

  return sessions.map((list) => {
    const marks: { key: string, entries: LogEntry[] }[] = []
    for (const e of list) {
      const mark = e.markId
        ? marks.find(m => m.key === e.markId)
        : marks.find(m => !m.entries[0]!.markId && m.entries[0]!.rowKey === e.rowKey
          && !m.entries.some(x => x.source === e.source) && Math.abs(time(m.entries[0]!) - time(e)) <= MARK_WINDOW_MS)
      if (mark) mark.entries.push(e)
      else marks.push({ key: e.markId ?? `entry:${e.id}`, entries: [e] })
    }
    return {
      start: new Date(time(list.at(-1)!)),
      end: new Date(time(list[0]!)),
      shows: new Set(list.map(e => e.rowKey || e.title)).size,
      marks: marks.map((m) => {
        const entries = [...m.entries].sort((a, b) => ORDER.indexOf(a.source) - ORDER.indexOf(b.source))
        return { key: m.key, at: new Date(Math.max(...m.entries.map(time))), title: entries[0]!.title, entries, ok: entries.every(e => e.result === 'ok') }
      })
    }
  })
}
