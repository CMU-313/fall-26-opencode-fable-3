import { describe, expect, test } from "bun:test"
import { SessionHint } from "../../src/session/hint"

describe("SessionHint.isAnotherHintRequest", () => {
  test("recognizes requests for another hint", () => {
    expect(
      [
        "Can I get another hint?",
        "next hint please",
        "Give me one more hint",
        "I need a bigger hint",
        "I'm still stuck",
        "still don't get it",
        "It's still not working",
        "Can you be more specific?",
        "I need more help with this",
        "more detail please",
        "hint",
        "Another one!",
        "more",
      ].filter((text) => !SessionHint.isAnotherHintRequest(text)),
    ).toEqual([])
  })

  test("does not treat new questions as hint requests", () => {
    expect(
      [
        "My binary search loops forever. Can you fix it?",
        "Write a function that reverses a linked list.",
        "Why does my recursive fibonacci exceed the max recursion depth?",
        "How do I run the tests?",
        "What does this hint about the error mean for my loop?",
        "I need more memory for this program",
      ].filter((text) => SessionHint.isAnotherHintRequest(text)),
    ).toEqual([])
  })
})

describe("SessionHint.level", () => {
  const question = { hint: true, text: "My binary search loops forever. Can you fix it?" }
  const another = { hint: true, text: "another hint please" }

  test("starts a new Hint Mode question at level 1", () => {
    expect(SessionHint.level([question])).toBe(1)
  })

  test("raises the level by one for each request in a row", () => {
    expect(SessionHint.level([question, another])).toBe(2)
    expect(SessionHint.level([question, another, { hint: true, text: "I'm still stuck" }])).toBe(3)
    expect(SessionHint.level([question, another, another, another])).toBe(4)
  })

  test("stops at the most detailed level", () => {
    expect(SessionHint.level([question, another, another, another, another, another])).toBe(SessionHint.levels.length)
  })

  test("starts over for a new question", () => {
    expect(SessionHint.level([question, another, another, { hint: true, text: "How do I reverse a list?" }])).toBe(1)
    expect(
      SessionHint.level([
        question,
        another,
        another,
        { hint: true, text: "How do I reverse a list?" },
        another,
      ]),
    ).toBe(2)
  })

  test("starts over when Hint Mode was off in between", () => {
    expect(SessionHint.level([question, another, { hint: false, text: "Just fix it." }, another])).toBe(1)
  })

  test("counts a first request with no earlier question as level 1", () => {
    expect(SessionHint.level([another])).toBe(1)
  })
})
