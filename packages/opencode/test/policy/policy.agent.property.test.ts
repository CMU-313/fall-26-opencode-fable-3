import { expect, test } from "bun:test"
import fc from "fast-check"
import path from "path"
import { loadAIPolicy } from "../../src/policy/policy"
import { tmpdir } from "../fixture/fixture"

fc.configureGlobal({ seed: 42 })

// Originally written by opencode (gpt-5.6-terra-fast) for R3, see the Agent
// failure case in traceability/truannec.md. That version held the policy fixed,
// only varied the *value* of instructorNotes, and checked the warning list with
// toContain, so mutants H3 and Stryker's L72-74 and L81 survived.
// Strengthened: vary the policy, the unknown key names (including names
// inherited from Object.prototype), and unknown fields inside contact, and
// require exactly one warning per unknown field and none for a clean policy.

const text = fc.string({ minLength: 1, maxLength: 12 }).filter((value) => value.trim().length > 0)
const validPolicy = fc.record({
  courseName: text,
  assignmentName: text,
  summary: text,
  allowedUses: fc.array(text, { maxLength: 2 }),
  prohibitedUses: fc.array(text, { maxLength: 2 }),
  contact: fc.option(fc.record({ name: text }, { requiredKeys: [] }), { nil: undefined }),
})
const prototypeNames = ["constructor", "toString", "valueOf", "hasOwnProperty"] as const
const unknownFields = fc
  .tuple(
    fc.jsonValue(),
    fc.dictionary(fc.constantFrom("course_name", "gradingRubric", "x-policy", ...prototypeNames), fc.jsonValue(), {
      maxKeys: 3,
    }),
  )
  .map(([instructorNotes, others]) => ({ instructorNotes, ...others }))
const unknownContactFields = fc.dictionary(fc.constantFrom("phone", "officeHours", ...prototypeNames), fc.jsonValue(), {
  maxKeys: 2,
})

test("R3: unknown fields keep the policy loaded with exactly one warning per field (strengthened from opencode)", async () => {
  await fc.assert(
    fc.asyncProperty(validPolicy, unknownFields, unknownContactFields, async (policy, fields, contactFields) => {
      await using temp = await tmpdir()
      const file = path.join(temp.path, ".opencode", "ai-policy.json")

      await Bun.write(file, JSON.stringify(policy))
      const clean = await loadAIPolicy(temp.path)
      expect(clean.status).toBe("loaded")
      expect(clean).not.toHaveProperty("warnings")
      if (clean.status !== "loaded") throw new Error("Expected the generated policy to be valid")

      const withContact = Object.keys(contactFields).length > 0
      await Bun.write(
        file,
        JSON.stringify({
          ...policy,
          ...fields,
          ...(withContact ? { contact: { ...policy.contact, ...contactFields } } : {}),
        }),
      )
      const result = await loadAIPolicy(temp.path)
      expect(result.status).toBe("loaded")
      expect(result).not.toHaveProperty("error")
      if (result.status !== "loaded") throw new Error("Expected unknown fields to keep the policy loaded")
      expect(result.policy.courseName).toBe(clean.policy.courseName)
      expect(result.policy.allowedUses).toEqual(clean.policy.allowedUses)

      const expected = [...Object.keys(fields), ...Object.keys(contactFields).map((key) => `contact.${key}`)]
      expect(result.warnings ?? []).toHaveLength(expected.length)
      for (const name of expected) {
        expect((result.warnings ?? []).filter((warning) => warning.includes(`"${name}"`))).toHaveLength(1)
      }
    }),
    { numRuns: 100 },
  )
})
