import { describe, expect, test } from "bun:test"
import { buildPolicyDisplay, type PolicyLoadResult } from "../src/policy"

const policy = {
  courseName: "Introduction to Software Engineering",
  assignmentName: "OpenCode Feature Project",
  summary: "Use AI tools to support learning while remaining responsible for submitted work.",
  allowedUses: ["Brainstorming implementation approaches", "Reviewing code for clarity"],
  prohibitedUses: ["Submitting AI-generated work without review"],
  contact: {
    name: "Course Staff",
    email: "course-staff@example.edu",
  },
}

describe("buildPolicyDisplay", () => {
  test("renders all policy fields", () => {
    const result = buildPolicyDisplay({ status: "loaded", policy })

    expect(result).toEqual({
      status: "loaded",
      courseName: policy.courseName,
      assignmentName: policy.assignmentName,
      summary: policy.summary,
      allowedUses: policy.allowedUses,
      prohibitedUses: policy.prohibitedUses,
      contact: [policy.contact.name, policy.contact.email],
    })
  })

  test("omits the contact section when contact is absent", () => {
    const result = buildPolicyDisplay({ status: "loaded", policy: { ...policy, contact: undefined } })

    expect(result.status).toBe("loaded")
    if (result.status === "loaded") expect(result.contact).toEqual([])
  })

  test("builds the no-policy empty state", () => {
    const result = buildPolicyDisplay({ status: "not-found" })

    expect(result).toEqual({
      status: "empty",
      message: "No AI-use policy found for this project. Instructors can add one at .opencode/ai-policy.json.",
    })
  })

  test("preserves invalid policy messages", () => {
    const result = buildPolicyDisplay({
      status: "invalid",
      errors: ["Invalid AI policy in .opencode/ai-policy.json:", "- courseName: Missing key"],
    })

    expect(result).toEqual({
      status: "invalid",
      errors: ["Invalid AI policy in .opencode/ai-policy.json:", "- courseName: Missing key"],
    })
  })

  test("preserves long content for the dialog to wrap and scroll", () => {
    const longSummary = "This policy explains responsible AI use. ".repeat(40)
    const input: PolicyLoadResult = {
      status: "loaded",
      policy: { ...policy, summary: longSummary },
    }

    const result = buildPolicyDisplay(input)

    expect(result.status).toBe("loaded")
    if (result.status === "loaded") expect(result.summary).toBe(longSummary)
  })
})