export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** The subset of ctx.storage the registry needs. */
export interface KV {
  get(key: string): Promise<Json | undefined>
  set(key: string, value: Json): Promise<void>
  remove(key: string): Promise<void>
  scan(options: { prefix: string; after?: string; limit?: number }): Promise<{
    entries: readonly { key: string; value: Json }[]
    next?: string
  }>
}

export interface SessionRecord {
  id: string
  title: string
  projectID: string
  agent: string
  directory: string
  lastSeen: number
}

const PREFIX = "msg/session/"

function isRecord(value: unknown): value is SessionRecord {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.projectID === "string" &&
    typeof v.agent === "string" &&
    typeof v.directory === "string" &&
    typeof v.lastSeen === "number"
  )
}

/**
 * Plugins have no session.list, so the plugin records the sessions it sees
 * (on every model call) and uses that registry as the recipient directory.
 */
export class Registry {
  private readonly kv: KV
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(kv: KV, ttlHours: number, now: () => number = Date.now) {
    this.kv = kv
    this.ttlMs = ttlHours * 3_600_000
    this.now = now
  }

  async touch(record: Omit<SessionRecord, "lastSeen">): Promise<void> {
    await this.kv.set(PREFIX + encodeURIComponent(record.id), { ...record, lastSeen: this.now() })
  }

  async get(id: string): Promise<SessionRecord | undefined> {
    const value = await this.kv.get(PREFIX + encodeURIComponent(id))
    return isRecord(value) ? value : undefined
  }

  /** Live entries, most recently seen first. Expired entries are removed. */
  async list(): Promise<SessionRecord[]> {
    const out: SessionRecord[] = []
    const stale: string[] = []
    let after: string | undefined
    const cutoff = this.now() - this.ttlMs
    do {
      const page = await this.kv.scan({ prefix: PREFIX, limit: 100, ...(after === undefined ? {} : { after }) })
      for (const entry of page.entries) {
        if (!isRecord(entry.value)) continue
        if (entry.value.lastSeen < cutoff) stale.push(entry.key)
        else out.push(entry.value)
      }
      after = page.next
    } while (after !== undefined)
    await Promise.all(stale.map((key) => this.kv.remove(key)))
    return out.sort((a, b) => b.lastSeen - a.lastSeen)
  }
}
