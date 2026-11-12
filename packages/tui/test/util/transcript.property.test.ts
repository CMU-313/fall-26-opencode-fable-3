import { describe, expect, setSystemTime, test } from "bun:test"
import fc from "fast-check"
import type { Part } from "@opencode-ai/sdk/v2"
import { formatTranscript, type MessageWithParts } from "../../src/util/transcript"

// Fixed for Stryker mutation runs: a mutant must be killed or survive the same
// way on every run, which a re-randomized seed can't guarantee.
fc.configureGlobal({ seed: 42 })

// Generators
//
// Message text mixes ordinary random strings with text that looks like transcript structure (role headers,
// "---" separators, code fences, the thinking label). That is the content most likely to confuse a check
// that reads the copied transcript, and the content users actually paste into prompts. Text never contains
// "[[" so the per-message markers below stay unique.
const content = fc
  .oneof(
    fc.constantFrom("", "## User", "## Assistant", "---", "```", "_Thinking:_", "**Tool: bash**", "one\ntwo"),
    fc.string(),
  )
  .filter((text) => !text.includes("[["))

// Every tool status is generated, with and without input and output, so tool-details settings have
// something to show or hide in each state.
const toolState = fc.oneof(
  fc.record({ status: fc.constant("pending" as const), input: fc.record({ command: content }), raw: content }),
  fc.record({
    status: fc.constant("running" as const),
    input: fc.record({ command: content }),
    time: fc.record({ start: fc.nat() }),
  }),
  fc.record({
    status: fc.constant("completed" as const),
    input: fc.record({ command: content }),
    output: content,
    title: content,
    metadata: fc.constant({}),
    time: fc.record({ start: fc.nat(), end: fc.nat() }),
  }),
  fc.record({
    status: fc.constant("error" as const),
    input: fc.record({ command: content }),
    error: content,
    time: fc.record({ start: fc.nat(), end: fc.nat() }),
  }),
)

// The part kinds a copy has to handle: visible text, synthetic text, thinking, and tool calls.
const part = fc.oneof(
  fc.record({ type: fc.constant("text" as const), text: content, synthetic: fc.boolean() }),
  fc.record({ type: fc.constant("reasoning" as const), text: content, time: fc.record({ start: fc.nat() }) }),
  fc.record({
    type: fc.constant("tool" as const),
    callID: fc.constant("call"),
    tool: fc.constantFrom("bash", "read", "edit"),
    state: toolState,
  }),
)

// Creation times come from a range of 6 values, so most sessions have messages created at the same moment
// (a boundary for ordering), and messages are generated out of order so the copy has to sort them.
// `completed` controls whether assistant responses may be unfinished.
const messages = (completed: fc.Arbitrary<boolean>) =>
  fc
    .array(
      fc.record({
        role: fc.constantFrom("user" as const, "assistant" as const),
        created: fc.integer({ min: 0, max: 5 }),
        completed,
        parts: fc.array(part, { maxLength: 4 }),
      }),
      { maxLength: 12 },
    )
    .map((specs) => specs.map(build))

// Display settings are generated independently, so each property holds whatever the other settings are.
const settings = fc.record({ thinking: fc.boolean(), toolDetails: fc.boolean(), assistantMetadata: fc.boolean() })

const session = fc.record({
  id: fc.constant("ses_test"),
  title: content,
  time: fc.record({ created: fc.nat(), updated: fc.nat() }),
})

describe("formatTranscript properties", () => {
  // R1: The copied transcript includes all user prompts and completed assistant responses in chronological order.
  // Kind: invariant
  test("R1: every prompt and completed response is copied once, in chronological order", () => {
    fc.assert(
      fc.property(session, messages(fc.constant(true)), settings, (info, history, options) => {
        const transcript = formatTranscript(info, history, options)
        history.forEach((_, index) => expect(transcript.split(marker(index)).length).toBe(2))
        const position = (index: number) => transcript.indexOf(marker(index))
        history.forEach((a, i) =>
          history.forEach((b, j) => {
            if (a.info.time.created < b.info.time.created) expect(position(i)).toBeLessThan(position(j))
          }),
        )
        // A prompt copied under the assistant's heading (or the reverse) is not the prompt the user sent, so
        // each message must sit directly under its own role's heading, on a line of its own.
        history.forEach((message, index) =>
          expect(transcript.slice(0, position(index))).toMatch(
            message.info.role === "user" ? /(^|\n)## User\n\n$/ : /(^|\n)## Assistant( \(.*\))?\n\n$/,
          ),
        )
      }),
    )
  })

  // R2: When thinking is hidden, /copy excludes thinking content without changing the remaining transcript.
  // Kind: metamorphic. Hiding thinking must give exactly the copy of the same session with its thinking
  // parts removed, so nothing else in the transcript may change. Comparing two copies alone would pass if
  // thinking were never copied at all, so the property also checks the session's own thinking parts: every
  // one appears once when thinking is shown, and none when it is hidden.
  test("R2: hiding thinking removes thinking parts and nothing else", () => {
    fc.assert(
      fc.property(session, messages(fc.boolean()), settings, (info, history, options) => {
        const withoutThinking = history.map((message) => ({
          ...message,
          parts: message.parts.filter((item) => item.type !== "reasoning"),
        }))
        const hidden = formatTranscript(info, history, { ...options, thinking: false })
        expect(hidden).toBe(formatTranscript(info, withoutThinking, { ...options, thinking: true }))
        expect(markers(hidden, "r")).toEqual([])
        const shown = formatTranscript(info, history, { ...options, thinking: true })
        markers(JSON.stringify(history), "r").forEach((item) => expect(shown.split(item).length).toBe(2))
      }),
    )
  })

  // R5: Restoring tool visibility must restore the original copied transcript.
  // Kind: round-trip. Copy with tool details on, copy with them off, then turn them back on: the last copy
  // must equal the first. This would catch a copy that changed the session's messages while hiding details.
  // The original copy is also checked against the session: it shows every tool input, output and error once,
  // the details-off copy shows none of them, and both still name every tool that ran.
  test("R5: turning tool details off and back on restores the original copy", () => {
    fc.assert(
      fc.property(session, messages(fc.boolean()), settings, (info, history, options) => {
        const before = formatTranscript(info, history, { ...options, toolDetails: true })
        const hidden = formatTranscript(info, history, { ...options, toolDetails: false })
        const details = ["i", "o", "e"].flatMap((kind) => markers(JSON.stringify(history), kind))
        details.forEach((item) => expect(before.split(item).length).toBe(2))
        expect(["i", "o", "e"].flatMap((kind) => markers(hidden, kind))).toEqual([])
        const tools = history.flatMap((message) => message.parts.filter((item) => item.type === "tool"))
        expect(hidden.split("**Tool: ").length - 1).toBeGreaterThanOrEqual(tools.length)
        expect(formatTranscript(info, history, { ...options, toolDetails: true })).toBe(before)
      }),
    )
  })

  // R7: Copying an unchanged session twice with the same settings must produce identical output.
  // Kind: invariant. The second copy reads a deep clone, the way /copy rereads the session from the store,
  // so the output can't depend on object identity.
  test("R7: copying an unchanged session twice gives identical output", () => {
    fc.assert(
      fc.property(session, messages(fc.boolean()), settings, (info, history, options) => {
        expect(formatTranscript(structuredClone(info), structuredClone(history), options)).toBe(
          formatTranscript(info, history, options),
        )
      }),
    )
  })

  // R7: Copying an unchanged session twice with the same settings must produce identical output.
  // Kind: metamorphic. Real users copy seconds to days apart, so moving the clock forward between two copies
  // of the same session must not change the copy. Two copies made back to back can't catch a copy that
  // depends on the current time, since both run within the same second.
  test("R7: copying the same session later gives identical output", () => {
    fc.assert(
      fc.property(
        session,
        messages(fc.boolean()),
        settings,
        fc.integer({ min: 1_000, max: 10 * 365 * 24 * 60 * 60 * 1_000 }),
        (info, history, options, later) => {
          const first = formatTranscript(info, history, options)
          setSystemTime(new Date(Date.now() + later))
          const second = formatTranscript(info, history, options)
          setSystemTime()
          expect(second).toBe(first)
        },
      ),
    )
  })
})

// Each message starts with a visible text part holding a unique marker, so a property can find exactly where
// that message landed in the transcript.
function marker(index: number) {
  return `[[m${index}]]`
}

function build(
  spec: {
    role: "user" | "assistant"
    created: number
    completed: boolean
    parts: PartSpec[]
  },
  index: number,
): MessageWithParts {
  const id = `msg_${String(index).padStart(3, "0")}`
  const parts = [{ type: "text" as const, text: marker(index) }, ...spec.parts].map((item, n) => ({
    ...tag(item, `${index}.${n}`),
    id: `prt_${n}`,
    sessionID: "ses_test",
    messageID: id,
  }))
  if (spec.role === "user")
    return {
      info: {
        id,
        sessionID: "ses_test",
        role: "user",
        agent: "build",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
        time: { created: spec.created },
      },
      parts,
    }
  return {
    info: {
      id,
      sessionID: "ses_test",
      role: "assistant",
      agent: "build",
      modelID: "claude-sonnet-4",
      providerID: "anthropic",
      mode: "",
      parentID: "msg_parent",
      path: { cwd: "/test", root: "/test" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: spec.completed ? { created: spec.created, completed: spec.created + 1 } : { created: spec.created },
    },
    parts,
  }
}

// Thinking text ([[r…]]) and tool input ([[i…]]), output ([[o…]]) and error ([[e…]]) each end with a unique marker,
// so a property can check exactly which of them a copy shows instead of only comparing two copies.
function tag(item: PartSpec, key: string): PartSpec {
  if (item.type === "reasoning") return { ...item, text: `${item.text}[[r${key}]]` }
  if (item.type !== "tool") return item
  const input = { ...item.state.input, command: `${String(item.state.input.command)}[[i${key}]]` }
  if (item.state.status === "completed")
    return { ...item, state: { ...item.state, input, output: `${item.state.output}[[o${key}]]` } }
  if (item.state.status === "error")
    return { ...item, state: { ...item.state, input, error: `${item.state.error}[[e${key}]]` } }
  return { ...item, state: { ...item.state, input } }
}

// Every marker of one kind (m, r, i, o, e) found in a string, such as a copy or the serialized session.
function markers(value: string, kind: string) {
  return value.match(new RegExp(`\\[\\[${kind}[0-9.]+\\]\\]`, "g")) ?? []
}

type PartSpec = DistributiveOmit<Part, "id" | "sessionID" | "messageID">
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
