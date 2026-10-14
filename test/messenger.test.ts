import { test } from "node:test"
import assert from "node:assert/strict"
import { Messenger } from "../src/messenger.ts"
import { RateLimiter } from "../src/limiter.ts"
import { Registry } from "../src/registry.ts"
import { parseOptions } from "../src/options.ts"
import { buildTools } from "../src/tools.ts"
import { fakeKV, fakeSessions } from "./helpers.ts"

function setup(raw: Record<string, unknown> = {}, known?: Parameters<typeof fakeSessions>[0]) {
  const sessions = fakeSessions(known ?? { A: { title: "alpha" }, B: { title: "beta" }, C: { projectID: "p2" } })
  const options = parseOptions(raw)
  let t = 1_000_000
  const registry = new Registry(fakeKV(), options.registryTtlHours, () => t)
  const m = new Messenger(sessions, registry, new RateLimiter(options.rateLimit, options.rateWindowMs, () => t), options, () => t)
  return { sessions, m, registry, options, advance: (ms: number) => (t += ms) }
}

test("send delivers a synthetic message with sender metadata, steer and wake by default", async () => {
  const { m, sessions } = setup()
  const out = await m.send("A", { to: "B", text: "  hi there  " })
  assert.match(out, /delivered to B/)
  const s = sessions.sent[0]!
  assert.equal(s.sessionID, "B")
  assert.equal(s.delivery, "steer")
  assert.equal(s.resume, true)
  assert.deepEqual(s.metadata, { kind: "session-message", from: "A", fromTitle: "alpha" })
  assert.match(s.text, /hi there/)
  assert.match(s.text, /not by the user/)
})

test("send honours delivery and wake arguments", async () => {
  const { m, sessions } = setup()
  await m.send("A", { to: "B", text: "x", delivery: "queue", wake: false })
  assert.equal(sessions.sent[0]!.delivery, "queue")
  assert.equal(sessions.sent[0]!.resume, false)
})

test("send respects the wake option default", async () => {
  const { m, sessions } = setup({ wake: false })
  await m.send("A", { to: "B", text: "x" })
  assert.equal(sessions.sent[0]!.resume, false)
})

test("send validates input", async () => {
  const { m, sessions } = setup()
  await assert.rejects(m.send("A", { to: "", text: "x" }), /session id/)
  await assert.rejects(m.send("A", { to: "A", text: "x" }), /current session/)
  await assert.rejects(m.send("A", { to: "B", text: "   " }), /non-empty/)
  await assert.rejects(m.send("A", { to: "B", text: "x", delivery: "now" }), /steer/)
  await assert.rejects(m.send("A", { to: "B", text: "x", wake: "yes" }), /boolean/)
  await assert.rejects(m.send("A", { to: "B", text: "x".repeat(5000) }), /limit is 4000/)
  await assert.rejects(m.send("A", { to: "nope", text: "x" }), /not found/)
  assert.equal(sessions.sent.length, 0)
})

test("send is rate limited per sender", async () => {
  const { m, sessions, advance } = setup({ rateLimit: 2, rateWindowMs: 5000 })
  await m.send("A", { to: "B", text: "1" })
  await m.send("A", { to: "B", text: "2" })
  await assert.rejects(m.send("A", { to: "B", text: "3" }), /Rate limit/)
  await m.send("B", { to: "A", text: "other sender ok" })
  advance(5000)
  await m.send("A", { to: "B", text: "4" })
  assert.equal(sessions.sent.length, 4)
})

test("sameProjectOnly blocks cross-project sends", async () => {
  const { m, sessions } = setup({ sameProjectOnly: true })
  await assert.rejects(m.send("A", { to: "C", text: "x" }), /same project/)
  await m.send("A", { to: "B", text: "x" })
  assert.equal(sessions.sent.length, 1)
})

test("sameProjectOnly refuses when the sender cannot be resolved", async () => {
  const { m } = setup({ sameProjectOnly: true }, { B: {} })
  await assert.rejects(m.send("ghost", { to: "B", text: "x" }), /same project/)
})

test("touch is throttled and swallows lookup failures", async () => {
  const { m, sessions, registry, advance } = setup()
  await m.touch("A")
  await m.touch("A")
  assert.equal(sessions.gets, 1)
  advance(31_000)
  await m.touch("A")
  assert.equal(sessions.gets, 2)
  await m.touch("ghost")
  assert.equal(await registry.get("ghost"), undefined)
  await m.touch("ghost")
  assert.equal(sessions.gets, 4)
})

test("list excludes the caller and respects sameProjectOnly", async () => {
  const open = setup()
  for (const id of ["A", "B", "C"]) await open.m.touch(id)
  const all = await open.m.list("A")
  assert.match(all, /^B \|/m)
  assert.match(all, /^C \|/m)
  assert.doesNotMatch(all, /^A \|/m)

  const scoped = setup({ sameProjectOnly: true })
  for (const id of ["A", "B", "C"]) await scoped.m.touch(id)
  const same = await scoped.m.list("A")
  assert.match(same, /^B \|/m)
  assert.doesNotMatch(same, /^C \|/m)
})

test("list explains an empty registry", async () => {
  const { m } = setup()
  assert.match(await m.list("A"), /No other sessions/)
})

test("tools return domain errors as content and register the caller", async () => {
  const { m, options, registry } = setup()
  const tools = buildTools(m, options)
  assert.deepEqual(tools.map((t) => t.name), ["send", "sessions"])
  const send = tools.find((t) => t.name === "send")!
  const bad = await send.execute({ to: "nope", text: "x" }, { sessionID: "A" })
  assert.match(bad.content, /^Error: /)
  assert.ok(await registry.get("A"))
  const ok = await send.execute({ to: "B", text: "x" }, { sessionID: "A" })
  assert.match(ok.content, /delivered/)
  const none = await send.execute("garbage", { sessionID: "A" })
  assert.match(none.content, /^Error: /)
})
