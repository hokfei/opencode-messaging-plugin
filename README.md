# opencode-messaging-plugin

An [OpenCode](https://opencode.ai) v2 plugin that lets sessions message each other.

A session's agent gets two tools:

| Tool | Purpose |
| --- | --- |
| `message_sessions` | List other known sessions (id, title, project, last activity). |
| `message_send` | Send `text` to a session id. Optional `delivery` (`steer` \| `queue`) and `wake` (boolean). |

The recipient sees the message as a synthetic message framed as coming from a peer agent, **not the user**, and is told to treat it as untrusted. It replies with `message_send`.

## Install

```sh
opencode plugin add github:hokfei/opencode-messaging-plugin
```

Options (all optional):

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Turn the plugin off. |
| `maxMessageChars` | `4000` | Max message length (50-50000). |
| `rateLimit` | `10` | Max sends per sender per window. |
| `rateWindowMs` | `60000` | Rate-limit window. |
| `sameProjectOnly` | `false` | Only allow messages within one project. |
| `registryTtlHours` | `24` | How long an idle session stays listed. |
| `wake` | `true` | Wake an idle target by default. |

## How it works

- A `context` hook runs on every model call and records the session (title, project, agent) in plugin storage. That is the discovery registry.
- `message_send` calls `ctx.session.synthetic({ sessionID, text, delivery, resume })`.
  `steer` redirects the target at its next opportunity; `queue` waits behind its current work.
  `wake` resumes an idle target (skipped by OpenCode if the target has a pending revert).

## Limitations

- The plugin API has no `session.list`, so only sessions that have made a model call since install (and within the TTL) are listed. Sending to a valid session id that is not listed still works.
- Messages steer and wake the target by default. Use `delivery: "queue"` / `wake: false`, or `sameProjectOnly`, to be gentler.
- Peer messages are untrusted input; a message can ask the target to do things, so only run sessions you trust together.
- **Live loading in OpenCode is unverified.** Verified so far: type-check against `@opencode/plugin@2.0.28`, unit tests with a fake session API, and the entry point loads under Node.

## Development

```sh
npm install
npm run typecheck
npm test
```

Requires Node 22.6+ (type stripping); tests use Node's built-in runner.

## License

MIT
