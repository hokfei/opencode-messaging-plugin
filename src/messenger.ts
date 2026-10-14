import type { MessagingOptions } from "./options.ts"
import type { RateLimiter } from "./limiter.ts"
import type { Registry } from "./registry.ts"
import { describeSession, renderIncoming } from "./format.ts"

export interface SessionSnapshot {
  id: string
  title?: string | undefined
  projectID: string
  agent?: string | undefined
  subpath?: string | undefined
}

export interface SyntheticInput {
  sessionID: string
  text: string
  description?: string
  metadata?: Record<string, string>
  delivery?: "steer" | "queue"
  resume?: boolean
}

/** What the messenger needs from ctx.session. */
export interface SessionApi {
  get(sessionID: string): Promise<SessionSnapshot>
  synthetic(input: SyntheticInput): Promise<unknown>
}

/** A user-facing failure: the message is returned to the model as tool output. */
export class MessagingError extends Error {}

export interface SendArgs {
  to: unknown
  text: unknown
  delivery?: unknown
  wake?: unknown
}

const TOUCH_INTERVAL_MS = 30_000

export class Messenger {
  private readonly sessions: SessionApi
  private readonly registry: Registry
  private readonly limiter: RateLimiter
  private readonly options: MessagingOptions
  private readonly now: () => number
  private readonly lastTouch = new Map<string, number>()

  constructor(
    sessions: SessionApi,
    registry: Registry,
    limiter: RateLimiter,
    options: MessagingOptions,
    now: () => number = Date.now,
  ) {
    this.sessions = sessions
    this.registry = registry
    this.limiter = limiter
    this.options = options
    this.now = now
  }

  /** Records a session in the registry, at most once per interval. Best effort: never throws. */
  async touch(sessionID: string): Promise<void> {
    const t = this.now()
    const last = this.lastTouch.get(sessionID)
    if (last !== undefined && t - last < TOUCH_INTERVAL_MS) return
    this.lastTouch.set(sessionID, t)
    try {
      const info = await this.sessions.get(sessionID)
      await this.registry.touch({
        id: sessionID,
        title: info.title ?? "",
        projectID: info.projectID,
        agent: info.agent ?? "",
        directory: info.subpath ?? "",
      })
    } catch {
      this.lastTouch.delete(sessionID)
    }
  }

  async send(from: string, args: SendArgs): Promise<string> {
    const to = typeof args.to === "string" ? args.to.trim() : ""
    if (!to) throw new MessagingError("`to` must be a session id. Call message_sessions to see known sessions.")
    if (to === from) throw new MessagingError("Cannot send a message to the current session.")

    const text = typeof args.text === "string" ? args.text.trim() : ""
    if (!text) throw new MessagingError("`text` must be a non-empty string.")
    if (text.length > this.options.maxMessageChars) {
      throw new MessagingError(
        `Message is ${text.length} characters; the limit is ${this.options.maxMessageChars}. Shorten it or send a summary.`,
      )
    }

    const delivery = args.delivery ?? "steer"
    if (delivery !== "steer" && delivery !== "queue") {
      throw new MessagingError('`delivery` must be "steer" or "queue".')
    }
    if (args.wake !== undefined && typeof args.wake !== "boolean") {
      throw new MessagingError("`wake` must be a boolean.")
    }
    const wake = args.wake ?? this.options.wake

    if (!this.limiter.take(from)) {
      throw new MessagingError(
        `Rate limit reached (${this.options.rateLimit} messages per ${Math.round(this.options.rateWindowMs / 1000)}s). Wait before sending more.`,
      )
    }

    let target: SessionSnapshot
    try {
      target = await this.sessions.get(to)
    } catch {
      throw new MessagingError(`Session ${to} was not found.`)
    }

    let sender: SessionSnapshot | undefined
    try {
      sender = await this.sessions.get(from)
    } catch {
      sender = undefined
    }

    if (this.options.sameProjectOnly && sender?.projectID !== target.projectID) {
      throw new MessagingError("Messaging is limited to sessions in the same project, and the target is in another one.")
    }

    const senderTitle = sender?.title
    await this.sessions.synthetic({
      sessionID: to,
      text: renderIncoming({ id: from, ...(senderTitle ? { title: senderTitle } : {}) }, text),
      description: `Message from session ${from}`,
      metadata: { kind: "session-message", from, ...(senderTitle ? { fromTitle: senderTitle } : {}) },
      delivery,
      resume: wake,
    })

    const label = target.title ? ` ("${target.title}")` : ""
    return `Message delivered to ${to}${label} (${delivery}${wake ? ", target woken if idle" : ", target not woken"}).`
  }

  async list(caller: string): Promise<string> {
    let entries = (await this.registry.list()).filter((r) => r.id !== caller)
    if (this.options.sameProjectOnly) {
      const self = await this.registry.get(caller)
      entries = self ? entries.filter((r) => r.projectID === self.projectID) : []
    }
    if (entries.length === 0) {
      return "No other sessions are known. Only sessions that have made a model call while this plugin was loaded are listed."
    }
    const now = this.now()
    return entries.map((r) => describeSession(r, now)).join("\n")
  }
}
