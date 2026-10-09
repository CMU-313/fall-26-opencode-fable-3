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
  })

  test("returns invalid when a required field is missing", async () => {
    await using temp = await tmpdir()
    await writePolicy(
      temp.path,
      JSON.stringify({
        assignmentName: "OpenCode Feature Project",
        summary: "Use AI tools responsibly.",
        allowedUses: ["Brainstorming"],
        prohibitedUses: ["Submitting unreviewed work"],
      }),
    )

    const result = await loadAIPolicy(temp.path)

    expect(result.status).toBe("invalid")
  })
})