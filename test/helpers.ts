import type { KV } from "../src/registry.ts"
import type { SessionApi, SessionSnapshot, SyntheticInput } from "../src/messenger.ts"

export function fakeKV(pageSize = 2): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    async get(key) {
      return data.get(key) as never
    },
    async set(key, value) {
      data.set(key, value)
    },
    async remove(key) {
      data.delete(key)
    },
    async scan({ prefix, after, limit }) {
      const keys = [...data.keys()].filter((k) => k.startsWith(prefix) && (after === undefined || k > after)).sort()
      const size = Math.min(limit ?? pageSize, pageSize)
      const page = keys.slice(0, size)
      return {
        entries: page.map((key) => ({ key, value: data.get(key) as never })),
        ...(keys.length > size ? { next: page[page.length - 1]! } : {}),
      }
    },
  }
}

export function fakeSessions(known: Record<string, Partial<SessionSnapshot>>): SessionApi & {
  sent: SyntheticInput[]
  gets: number
} {
  const sent: SyntheticInput[] = []
  const api = {
    sent,
    gets: 0,
    async get(id: string): Promise<SessionSnapshot> {
      api.gets++
      const s = known[id]
      if (!s) throw new Error("not found")
      return { id, projectID: "p1", ...s }
    },
    async synthetic(input: SyntheticInput) {
      sent.push(input)
      return {}
    },
  }
  return api
}
