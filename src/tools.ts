import { MessagingError, type Messenger } from "./messenger.ts"
import type { MessagingOptions } from "./options.ts"

export interface ToolCtx {
  readonly sessionID: string
}

export interface MessageTool {
  name: string
  description: string
  input: Record<string, unknown>
  execute: (input: unknown, ctx: ToolCtx) => Promise<{ content: string }>
}

function obj(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}
}

export function buildTools(messenger: Messenger, options: MessagingOptions): MessageTool[] {
  const guard = (fn: MessageTool["execute"]): MessageTool["execute"] => async (input, ctx) => {
    try {
      return await fn(input, ctx)
    } catch (error) {
      if (error instanceof MessagingError) return { content: `Error: ${error.message}` }
      throw error
    }
  }

  return [
    {
      name: "send",
      description:
        "Send a message to another OpenCode session by its session id. The other session's agent receives it " +
        "as a message from a peer agent (not from the user). Use message_sessions to find session ids. " +
        "By default an idle target is woken so it can act on the message.",
      input: {
        type: "object",
        properties: {
          to: { type: "string", description: "Target session id." },
          text: { type: "string", description: `The message, at most ${options.maxMessageChars} characters.` },
          delivery: {
            type: "string",
            enum: ["steer", "queue"],
            description: '"steer" redirects the target at its next opportunity (default); "queue" waits behind its current work.',
          },
          wake: { type: "boolean", description: `Wake the target if idle. Defaults to ${options.wake}.` },
        },
        required: ["to", "text"],
        additionalProperties: false,
      },
      execute: guard(async (input, ctx) => {
        const i = obj(input)
        await messenger.touch(ctx.sessionID)
        const content = await messenger.send(ctx.sessionID, {
          to: i.to,
          text: i.text,
          delivery: i.delivery,
          wake: i.wake,
        })
        return { content }
      }),
    },
    {
      name: "sessions",
      description:
        "List other known OpenCode sessions you can message, newest activity first. " +
        "Only sessions that have recently made a model call are listed.",
      input: { type: "object", properties: {}, additionalProperties: false },
      execute: guard(async (_input, ctx) => {
        await messenger.touch(ctx.sessionID)
        return { content: await messenger.list(ctx.sessionID) }
      }),
    },
  ]
}
