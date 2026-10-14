export interface MessagingOptions {
  enabled: boolean
  /** Maximum characters in one message body; longer messages are rejected. */
  maxMessageChars: number
  /** Messages one session may send within `rateWindowMs`. */
  rateLimit: number
  rateWindowMs: number
  /** Only allow messages between sessions of the same project. */
  sameProjectOnly: boolean
  /** Registry entries not seen within this many hours are hidden and pruned. */
  registryTtlHours: number
  /** Wake an idle target session so it acts on the message. */
  wake: boolean
}

export const DEFAULTS: MessagingOptions = {
  enabled: true,
  maxMessageChars: 4000,
  rateLimit: 10,
  rateWindowMs: 60_000,
  sameProjectOnly: false,
  registryTtlHours: 24,
  wake: true,
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

export function parseOptions(raw: Readonly<Record<string, unknown>> | undefined): MessagingOptions {
  const o = raw ?? {}
  return {
    enabled: bool(o.enabled, DEFAULTS.enabled),
    maxMessageChars: int(o.maxMessageChars, DEFAULTS.maxMessageChars, 50, 50_000),
    rateLimit: int(o.rateLimit, DEFAULTS.rateLimit, 1, 1_000),
    rateWindowMs: int(o.rateWindowMs, DEFAULTS.rateWindowMs, 1_000, 3_600_000),
    sameProjectOnly: bool(o.sameProjectOnly, DEFAULTS.sameProjectOnly),
    registryTtlHours: int(o.registryTtlHours, DEFAULTS.registryTtlHours, 1, 24 * 90),
    wake: bool(o.wake, DEFAULTS.wake),
  }
}
