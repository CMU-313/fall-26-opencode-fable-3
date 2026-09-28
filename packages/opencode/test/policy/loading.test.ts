import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { loadAIPolicy } from "../../src/policy/policy"
import type { AIPolicy } from "../../src/policy/policy"
import { tmpdir } from "../fixture/fixture"

const fixturePath = `${import.meta.dir}/fixtures/ai-policy.json`

async function writePolicy(directory: string, content: string) {
  const policyDirectory = path.join(directory, ".opencode")
  await fs.mkdir(policyDirectory, { recursive: true })
  await Bun.write(path.join(policyDirectory, "ai-policy.json"), content)
}

describe("loadAIPolicy", () => {
  test("returns not-found when no policy file exists", async () => {
    await using temp = await tmpdir()

    await expect(loadAIPolicy(temp.path)).resolves.toEqual({ status: "not-found" })
  })

  test("loads a valid policy fixture", async () => {
    await using temp = await tmpdir()
    await writePolicy(temp.path, await Bun.file(fixturePath).text())
    const fixture = JSON.parse(await Bun.file(fixturePath).text()) as AIPolicy

    await expect(loadAIPolicy(temp.path)).resolves.toEqual({ status: "loaded", policy: fixture })
  })

  test("returns invalid for malformed JSON", async () => {
    await using temp = await tmpdir()
    await writePolicy(temp.path, "{")

    const result = await loadAIPolicy(temp.path)

    expect(result.status).toBe("invalid")
    if (result.status === "invalid") expect(result.error.message).toContain("not valid JSON")
  })

  test("reports each missing required field", async () => {
    await using temp = await tmpdir()
    const policy: Record<string, unknown> = {
      courseName: "Introduction to Software Engineering",
      assignmentName: "OpenCode Feature Project",
      summary: "Use AI tools responsibly.",
      allowedUses: ["Brainstorming"],
      prohibitedUses: ["Submitting unreviewed work"],
    }

    for (const field of ["courseName", "assignmentName", "summary", "allowedUses", "prohibitedUses"]) {
      delete policy[field]
      await writePolicy(temp.path, JSON.stringify(policy))

      const result = await loadAIPolicy(temp.path)

      expect(result.status).toBe("invalid")
      if (result.status === "invalid") {
        expect(result.error.message).toContain(field)
        expect(result.error.message).toMatch(field === "courseName" ? /string/i : /array|list/i)
      }
      policy[field] = field.endsWith("Uses") ? ["Example"] : "Example"
    }
  })

  test("reports wrong field types", async () => {
    await using temp = await tmpdir()

    for (const [field, value] of [
      ["courseName", 42],
      ["allowedUses", "Brainstorming"],
    ] as const) {
      await writePolicy(
        temp.path,
        JSON.stringify({
          courseName: "Introduction to Software Engineering",
          assignmentName: "OpenCode Feature Project",
          summary: "Use AI tools responsibly.",
          allowedUses: ["Brainstorming"],
          prohibitedUses: ["Submitting unreviewed work"],
          [field]: value,
        }),
      )

      const result = await loadAIPolicy(temp.path)

      expect(result.status).toBe("invalid")
      if (result.status === "invalid") expect(result.error.message).toContain(field)
    }
  })

  test("rejects an empty required field", async () => {
    await using temp = await tmpdir()
    await writePolicy(
      temp.path,
      JSON.stringify({
        courseName: "   ",
        assignmentName: "OpenCode Feature Project",
        summary: "Use AI tools responsibly.",
        allowedUses: ["Brainstorming"],
        prohibitedUses: ["Submitting unreviewed work"],
      }),
    )

    const result = await loadAIPolicy(temp.path)

    expect(result.status).toBe("invalid")
    if (result.status === "invalid") expect(result.error.message).toContain("courseName")
  })

  test("rejects empty, whitespace-only, and empty-object files", async () => {
    await using temp = await tmpdir()

    for (const content of ["", "   ", "{}"]) {
      await writePolicy(temp.path, content)

      const result = await loadAIPolicy(temp.path)

      expect(result.status).toBe("invalid")
      if (result.status === "invalid") expect(result.error.message).toContain("Invalid AI policy")
    }
  })

  test("rejects unknown fields", async () => {
    await using temp = await tmpdir()
    await writePolicy(
      temp.path,
      JSON.stringify({
        courseName: "Introduction to Software Engineering",
        assignmentName: "OpenCode Feature Project",
        summary: "Use AI tools responsibly.",
        allowedUse: ["Brainstorming"],
        allowedUses: ["Brainstorming"],
        prohibitedUses: ["Submitting unreviewed work"],
      }),
    )

    const result = await loadAIPolicy(temp.path)

    expect(result.status).toBe("invalid")
    if (result.status === "invalid") expect(result.error.message).toContain('unknown field "allowedUse"')
  })
})