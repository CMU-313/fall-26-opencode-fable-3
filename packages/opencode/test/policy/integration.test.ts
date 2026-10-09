import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { buildPolicyDisplay, buildPolicyNotification } from "@opencode-ai/tui/policy"
import { mapAIPolicyLoadResult } from "../../src/policy/tui"
import { loadAIPolicy } from "../../src/policy/policy"
import { tmpdir } from "../fixture/fixture"

const fixturePath = `${import.meta.dir}/fixtures/ai-policy.json`
const malformedFixturePath = `${import.meta.dir}/fixtures/malformed.json`

async function writePolicy(directory: string, content: string) {
  const policyDirectory = path.join(directory, ".opencode")
  await fs.mkdir(policyDirectory, { recursive: true })
  await Bun.write(path.join(policyDirectory, "ai-policy.json"), content)
}

async function loadPolicy(directory: string) {
  return mapAIPolicyLoadResult(await loadAIPolicy(directory))
}

describe("AI policy workflow", () => {
  test("loads a real policy file into display content and a startup notification", async () => {
    await using temp = await tmpdir()
    await writePolicy(temp.path, await Bun.file(fixturePath).text())

    const result = await loadPolicy(temp.path)
    const display = buildPolicyDisplay(result)
    const notification = buildPolicyNotification(result)

    expect(display).toMatchObject({
      status: "loaded",
      courseName: "Introduction to Software Engineering",
      assignmentName: "OpenCode Feature Project",
      summary: "Use AI tools to support learning while remaining responsible for submitted work.",
      allowedUses: [
        "Brainstorming implementation approaches",
        "Explaining unfamiliar error messages",
        "Reviewing code for clarity",
      ],
      prohibitedUses: ["Submitting AI-generated work without review", "Using AI to impersonate a teammate"],
      contact: ["Course Staff", "course-staff@example.edu"],
    })
    expect(notification).toEqual({
      message: "AI-use policy: Introduction to Software Engineering · OpenCode Feature Project. Run /policy to view",
      variant: "info",
    })
  })

  test("produces no contact entries when the real policy has no contact", async () => {
    await using temp = await tmpdir()
    const policy = JSON.parse(await Bun.file(fixturePath).text()) as Record<string, unknown>
    delete policy.contact
    await writePolicy(temp.path, JSON.stringify(policy))

    const result = await loadPolicy(temp.path)
    const display = buildPolicyDisplay(result)

    expect(display.status).toBe("loaded")
    if (display.status !== "loaded") throw new Error("Expected loaded policy")
    expect(display.contact).toEqual([])
    expect(buildPolicyNotification(result)).toEqual({
      message: "AI-use policy: Introduction to Software Engineering · OpenCode Feature Project. Run /policy to view",
      variant: "info",
    })
  })

  test("shows the empty state without a policy directory or file", async () => {
    for (const createFile of [false, true]) {
      await using temp = await tmpdir()
      if (createFile) await fs.mkdir(path.join(temp.path, ".opencode"), { recursive: true })

      const result = await loadPolicy(temp.path)

      expect(result).toEqual({ status: "not-found" })
      expect(buildPolicyDisplay(result)).toEqual({
        status: "empty",
        message: "No AI-use policy found for this project. Instructors can add one at .opencode/ai-policy.json.",
      })
      expect(buildPolicyNotification(result)).toBeUndefined()
    }
  })

  test("maps malformed JSON to the invalid dialog and warning notification", async () => {
    await using temp = await tmpdir()
    await writePolicy(temp.path, await Bun.file(malformedFixturePath).text())

    const result = await loadPolicy(temp.path)

    expect(result.status).toBe("invalid")
    if (result.status !== "invalid") throw new Error("Expected invalid policy")
    expect(buildPolicyDisplay(result)).toEqual(result)
    expect(buildPolicyDisplay(result)).toMatchObject({ status: "invalid" })
    expect(buildPolicyNotification(result)).toEqual({
      message: "AI-use policy file is invalid. Run /policy for details",
      variant: "warning",
    })
  })

  test("reports the field for incomplete, wrongly typed, empty, and unknown values", async () => {
    const cases: ReadonlyArray<{ content: string; field: string }> = [
      { content: JSON.stringify({ assignmentName: "Assignment" }), field: "courseName" },
      {
        content: JSON.stringify({
          courseName: 42,
          assignmentName: "Assignment",
          summary: "Summary",
          allowedUses: ["Allowed"],
          prohibitedUses: ["Prohibited"],
        }),
        field: "courseName",
      },
      {
        content: JSON.stringify({
          courseName: "Course",
          assignmentName: "Assignment",
          summary: "",
          allowedUses: ["Allowed"],
          prohibitedUses: ["Prohibited"],
        }),
        field: "summary",
      },
      {
        content: JSON.stringify({
          courseName: "Course",
          assignmentName: "Assignment",
          summary: "Summary",
          allowedUses: ["Allowed"],
          prohibitedUses: ["Prohibited"],
          extra: true,
        }),
        field: "extra",
      },
    ]

    for (const testCase of cases) {
      await using temp = await tmpdir()
      await writePolicy(temp.path, testCase.content)

      const result = await loadPolicy(temp.path)

      expect(result.status).toBe("invalid")
      if (result.status !== "invalid") throw new Error("Expected invalid policy")
      expect(buildPolicyDisplay(result)).toEqual(result)
      expect(result.errors.join("\n")).toContain(testCase.field)
    }
  })

  test("handles empty files and empty objects as invalid", async () => {
    for (const content of ["", "{}"]) {
      await using temp = await tmpdir()
      await writePolicy(temp.path, content)

      const result = await loadPolicy(temp.path)

      expect(result.status).toBe("invalid")
      if (result.status !== "invalid") throw new Error("Expected invalid policy")
      expect(buildPolicyDisplay(result)).toEqual(result)
      expect(buildPolicyNotification(result)?.variant).toBe("warning")
    }
  })

  test("preserves long policy text through the complete mapping", async () => {
    await using temp = await tmpdir()
    const longSummary = "This policy explains responsible AI use. ".repeat(100)
    await writePolicy(
      temp.path,
      JSON.stringify({
        courseName: "Course",
        assignmentName: "Assignment",
        summary: longSummary,
        allowedUses: ["Allowed"],
        prohibitedUses: ["Prohibited"],
      }),
    )

    const display = buildPolicyDisplay(await loadPolicy(temp.path))

    expect(display.status).toBe("loaded")
    if (display.status === "loaded") expect(display.summary).toBe(longSummary)
  })

  test("treats a directory at the policy path as an invalid policy without throwing", async () => {
    await using temp = await tmpdir()
    await fs.mkdir(path.join(temp.path, ".opencode", "ai-policy.json"), { recursive: true })

    const result = await loadPolicy(temp.path)

    expect(result.status).toBe("invalid")
    if (result.status !== "invalid") throw new Error("Expected invalid policy")
    expect(buildPolicyDisplay(result)).toEqual(result)
    expect(buildPolicyNotification(result)?.variant).toBe("warning")
  })
})
