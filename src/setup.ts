import { Plugin } from "@opencode/plugin"
import { Messenger, type SessionApi } from "./messenger.ts"
import { RateLimiter } from "./limiter.ts"
import { parseOptions } from "./options.ts"
import { Registry, type KV } from "./registry.ts"
import { buildTools } from "./tools.ts"

export const PLUGIN_ID = "opencode-messaging"

export async function setup(ctx: Plugin.Context): Promise<void> {
  const options = parseOptions(ctx.options)
  if (!options.enabled) return

  const sessions: SessionApi = {
    async get(sessionID) {
      const info = await ctx.session.get({ sessionID: sessionID as never })
      return {
        id: sessionID,
        title: info.title,
        projectID: info.projectID,
        agent: info.agent,
        subpath: info.subpath,
      }
    },
    synthetic: (input) =>
      ctx.session.synthetic({
        sessionID: input.sessionID as never,
        text: input.text,
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        ...(input.delivery === undefined ? {} : { delivery: input.delivery }),
        ...(input.resume === undefined ? {} : { resume: input.resume }),
      }),
  }

  const registry = new Registry(ctx.storage as unknown as KV, options.registryTtlHours)
  const limiter = new RateLimiter(options.rateLimit, options.rateWindowMs)
  const messenger = new Messenger(sessions, registry, limiter, options)

  ctx.tool.transform((editor) => {
    editor.namespace({ name: "message", description: "Message other OpenCode sessions" })
    for (const tool of buildTools(messenger, options)) {
      editor.add({
        name: tool.name,
        description: tool.description,
        input: tool.input,
        options: { namespace: "message", codemode: false },
        execute: (input, toolCtx) => tool.execute(input, { sessionID: toolCtx.sessionID }),
      })
    }
  })

  // Every model call registers the session so peers can discover it.
  await ctx.session.hook("context", async (event) => {
    try {
      await messenger.touch(event.sessionID)
    } catch {
      // Best effort: must never break a model call.
    }
  })
}
