import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import type { Part } from "@opencode-ai/sdk/v2"
import { formatTranscript, type MessageWithParts } from "../../src/util/transcript"

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
      }),
    )
  })

  // R2: When thinking is hidden, /copy excludes thinking content without changing the remaining transcript.
  // Kind: metamorphic. Hiding thinking must give exactly the copy of the same session with its thinking
  // parts removed, so nothing else in the transcript may change.
  test("R2: hiding thinking removes thinking parts and nothing else", () => {
    fc.assert(
      fc.property(session, messages(fc.boolean()), settings, (info, history, options) => {
        const withoutThinking = history.map((message) => ({
          ...message,
          parts: message.parts.filter((item) => item.type !== "reasoning"),
        }))
        expect(formatTranscript(info, history, { ...options, thinking: false })).toBe(
          formatTranscript(info, withoutThinking, { ...options, thinking: true }),
        )
      }),
    )
  })

  // R5: Restoring tool visibility must restore the original copied transcript.
  // Kind: round-trip. Copy with tool details on, copy with them off, then turn them back on: the last copy
  // must equal the first. This would catch a copy that changed the session's messages while hiding details.
  test("R5: turning tool details off and back on restores the original copy", () => {
    fc.assert(
      fc.property(session, messages(fc.boolean()), settings, (info, history, options) => {
        const before = formatTranscript(info, history, { ...options, toolDetails: true })
        const hidden = formatTranscript(info, history, { ...options, toolDetails: false })
        expect(hidden).not.toContain("**Input:**")
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
    parts: DistributiveOmit<Part, "id" | "sessionID" | "messageID">[]
  },
  index: number,
): MessageWithParts {
  const id = `msg_${String(index).padStart(3, "0")}`
  const parts = [{ type: "text" as const, text: marker(index) }, ...spec.parts].map((item, n) => ({
    ...item,
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

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
