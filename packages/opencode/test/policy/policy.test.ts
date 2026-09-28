import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { AIPolicy } from "../../src/policy/policy"

const fixturePath = `${import.meta.dir}/fixtures/ai-policy.json`

describe("AIPolicy", () => {
  test("parses the example policy fixture", async () => {
    const fixture: unknown = JSON.parse(await Bun.file(fixturePath).text())

    expect(() => Schema.decodeUnknownSync(AIPolicy)(fixture)).not.toThrow()
  })

  test("rejects a policy missing a required field", () => {
    const policy = {
      assignmentName: "OpenCode Feature Project",
      summary: "Use AI tools responsibly.",
      allowedUses: ["Brainstorming"],
      prohibitedUses: ["Submitting unreviewed work"],
    }

    expect(() => Schema.decodeUnknownSync(AIPolicy)(policy)).toThrow()
  })

  test("accepts a policy without contact information", () => {
    const policy = {
      courseName: "Introduction to Software Engineering",
      assignmentName: "OpenCode Feature Project",
      summary: "Use AI tools responsibly.",
      allowedUses: ["Brainstorming"],
      prohibitedUses: ["Submitting unreviewed work"],
    }

    expect(() => Schema.decodeUnknownSync(AIPolicy)(policy)).not.toThrow()
  })
})