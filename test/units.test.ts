import { test } from "node:test"
import assert from "node:assert/strict"
import { parseOptions, DEFAULTS } from "../src/options.ts"
import { RateLimiter } from "../src/limiter.ts"
import { Registry } from "../src/registry.ts"
import { oneLine, renderIncoming } from "../src/format.ts"
import { fakeKV } from "./helpers.ts"

test("parseOptions applies defaults and clamps", () => {
  assert.deepEqual(parseOptions(undefined), DEFAULTS)
  const o = parseOptions({ maxMessageChars: 1, rateLimit: 99999, sameProjectOnly: true, wake: "yes", enabled: false })
  assert.equal(o.maxMessageChars, 50)
  assert.equal(o.rateLimit, 1000)
  assert.equal(o.sameProjectOnly, true)
  assert.equal(o.wake, true)
  assert.equal(o.enabled, false)
})

test("RateLimiter allows up to the limit then recovers after the window", () => {
  let t = 0
  const l = new RateLimiter(2, 1000, () => t)
  assert.equal(l.take("a"), true)
  assert.equal(l.take("a"), true)
  assert.equal(l.take("a"), false)
  assert.equal(l.take("b"), true)
  t = 1000
  assert.equal(l.take("a"), true)
})

test("Registry lists newest first, prunes expired entries, paginates", async () => {
  let t = 0
  const kv = fakeKV(2)
  const r = new Registry(kv, 1, () => t)
  const rec = (id: string) => ({ id, title: id, projectID: "p", agent: "", directory: "" })
  await r.touch(rec("old"))
  t = 3_600_000 + 10
  for (const id of ["a", "b", "c", "d"]) {
    t += 1
    await r.touch(rec(id))
  }
  const list = await r.list()
  assert.deepEqual(list.map((x) => x.id), ["d", "c", "b", "a"])
  assert.equal(await r.get("old"), undefined)
  assert.equal(kv.data.size, 4)
})

test("Registry round-trips ids with special characters", async () => {
  const r = new Registry(fakeKV(), 1)
  await r.touch({ id: "ses/with:odd id", title: "", projectID: "p", agent: "", directory: "" })
  assert.equal((await r.get("ses/with:odd id"))?.id, "ses/with:odd id")
})

test("oneLine strips control characters and truncates", () => {
  assert.equal(oneLine("a\nb\u0000c"), "a b c")
  assert.equal(oneLine("x".repeat(20), 10).length, 10)
})

test("renderIncoming frames the message as a peer message", () => {
  const out = renderIncoming({ id: "ses_1", title: 'bad"\ntitle' }, "hello")
  assert.match(out, /not by the user/)
  assert.match(out, /from="ses_1"/)
  assert.match(out, /hello/)
  assert.equal(out.includes('bad"\ntitle'), false)
})
