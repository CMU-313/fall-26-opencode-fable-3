import { expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Effect, Layer } from "effect"
import fc from "fast-check"
import fs from "fs/promises"
import path from "path"
import { buildPolicyNotification } from "../../../tui/src/policy"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { loadAIPolicy } from "../../src/policy/policy"
import { mapAIPolicyLoadResult } from "../../src/policy/tui"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Session } from "../../src/session/session"
import { provideInstance, tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { mountPolicyCommand } from "./policy-command"

// Fixed seed so mutation-testing runs are reproducible (P5): every Stryker
// mutant sees the same generated inputs. Change it to explore new inputs.
fc.configureGlobal({ seed: 42 })

const test = testEffect(
  AppNodeBuilder.build(LayerNode.group([Session.node, SessionProjector.node, InstanceStore.node]), [
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
    [InstanceStore.bootstrapNode, Layer.succeed(InstanceBootstrap.Service, { run: Effect.void })],
  ]),
).live

// Exercise absent/empty .opencode directories and near-miss filenames with even
// malformed contents: none may be mistaken for .opencode/ai-policy.json.
// Nested paths, spaces, and Unicode cover realistic student project locations.
const projectWithoutPolicy = fc.record({
  directories: fc.array(fc.constantFrom("assignment-1", "course project", "作業", ".hidden"), { maxLength: 3 }),
  policyDirectory: fc.boolean(),
  files: fc.uniqueArray(
    fc.record({
      name: fc.constantFrom("README.md", "ai-policy.json.bak", "other-policy.json"),
      content: fc.oneof(fc.constant(""), fc.constant("{"), fc.json()),
    }),
    { selector: (file) => file.name, maxLength: 3 },
  ),
})

// R1: Without a policy file, loading reports absence, sessions start without
// policy restrictions, and the startup notification says no policy was found.
// Kind: invariant
test("R1: missing policy permits session startup and reports no policy found", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const instances = yield* InstanceStore.Service

    yield* Effect.promise(() =>
      fc.assert(
        fc.asyncProperty(projectWithoutPolicy, async (project) => {
          await using temp = await tmpdir()
          const directory = path.join(temp.path, ...project.directories)
          await fs.mkdir(directory, { recursive: true })
          if (project.policyDirectory) await fs.mkdir(path.join(directory, ".opencode"))
          await Promise.all(
            project.files.map((file) =>
              Bun.write(path.join(directory, project.policyDirectory ? ".opencode" : "", file.name), file.content),
            ),
          )

          const result = await loadAIPolicy(directory)
          // "not-found" is the loader's public spelling of the missing result.
          expect(result).toEqual({ status: "not-found" })
          if (result.status !== "not-found") throw new Error("Expected a missing policy")

          await Effect.runPromise(
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() => instances.disposeDirectory(directory))
              const session = yield* Effect.acquireRelease(sessions.create({}), (session) =>
                sessions.remove(session.id).pipe(Effect.orDie),
              )
              expect(session.id).toBeTruthy()
              const stored = yield* sessions.get(session.id)
              expect(stored.directory).toBe(directory)
              expect(stored.permission ?? []).toEqual([])
            }).pipe(provideInstance(directory), Effect.provideService(InstanceStore.Service, instances), Effect.scoped),
          )

          expect(buildPolicyNotification(result)).toEqual({
            message: expect.stringMatching(/no AI-use policy found/i),
            variant: "info",
          })
        }),
        {
          numRuns: 100,
          examples: [
            [{ directories: [], policyDirectory: false, files: [] }],
            [{ directories: [], policyDirectory: true, files: [] }],
            [
              {
                directories: ["course project", "作業"],
                policyDirectory: true,
                files: [{ name: "ai-policy.json.bak", content: "{" }],
              },
            ],
          ],
        },
      ),
    )
  }))

// Keep policies valid, short enough to inspect in the dialog, and free of the
// word "updated" so policy text cannot masquerade as the indicator. Empty lists,
// optional contacts, Unicode, and JSON escapes exercise schema/display boundaries.
const policyText = fc
  .tuple(
    fc.constantFrom("A", "é", "1"),
    fc.string({ unit: fc.constantFrom("a", "B", "0", " ", "é", '"', "\\"), maxLength: 12 }),
  )
  .map((parts) => parts.join(""))
const validPolicy = fc.record({
  courseName: policyText,
  assignmentName: policyText,
  summary: policyText,
  allowedUses: fc.array(policyText, { maxLength: 2 }),
  prohibitedUses: fc.array(policyText, { maxLength: 2 }),
  contact: fc.option(
    fc.record({
      name: fc.option(policyText, { nil: undefined }),
      email: fc.option(fc.constant("staff@example.edu"), { nil: undefined }),
    }),
    { nil: undefined },
  ),
})
const policyRevision = fc
  .record({
    policy: validPolicy,
    field: fc.constantFrom(
      "courseName",
      "assignmentName",
      "summary",
      "allowedUses",
      "prohibitedUses",
      "contact",
      "contactEmail",
    ),
  })
  .map((input) => ({
    policy: input.policy,
    // Every generated revision changes exactly one field, including fields that
    // a comparison limited to the course/assignment header would miss.
    // P5 red team (J3, from jannaanl): "contactEmail" changes only the contact
    // email, so a comparison that ignores email is caught.
    changed:
      input.field === "allowedUses" || input.field === "prohibitedUses"
        ? { ...input.policy, [input.field]: [...input.policy[input.field], "Revision!"] }
        : input.field === "contact"
          ? {
              ...input.policy,
              contact: { name: `${input.policy.contact?.name ?? ""}!`, email: input.policy.contact?.email },
            }
          : input.field === "contactEmail"
            ? {
                ...input.policy,
                contact: {
                  ...input.policy.contact,
                  email: input.policy.contact?.email === "staff@example.edu" ? "ta@example.edu" : "staff@example.edu",
                },
              }
            : {
                ...input.policy,
                [input.field as "courseName" | "assignmentName" | "summary"]:
                  `${input.policy[input.field as "courseName" | "assignmentName" | "summary"]}!`,
              },
  }))

// R6: Closing /policy with Esc and reopening it without changing the file
// returns to the same rendered content, with no "updated" indicator.
// Kind: round trip
test(
  "R6: Esc and repeated /policy opens preserve the rendered policy",
  () =>
    Effect.promise(async () => {
      await using temp = await tmpdir()
      await using app = await mountPolicyCommand(temp.path)
      await fc.assert(
        // Reuse valid policies with empty lists, optional contact, and escaped or
        // Unicode text; vary repeat counts to catch state that accumulates on reopen.
        fc.asyncProperty(validPolicy, fc.integer({ min: 1, max: 6 }), async (policy, repeats) => {
          await Bun.write(path.join(temp.path, ".opencode", "ai-policy.json"), JSON.stringify(policy))
          // Establish this case's last-shown policy before measuring repeat opens.
          await app.show()
          await app.escape()
          const original = await app.show()
          expect(original).toContain("AI-use policy")
          expect(/\bupdated\b/i.test(original)).toBe(false)

          for (const _ of Array.from({ length: repeats })) {
            expect(await app.escape()).toBe(false)
            const reopened = await app.show()
            expect(reopened).toBe(original)
            expect(/\bupdated\b/i.test(reopened)).toBe(false)
          }
        }),
        { numRuns: 50 },
      )
    }),
  30_000,
)

// Always include instructorNotes, plus distinct extension and near-miss names
// that cannot overwrite known fields. Arbitrary JSON values cover null, scalars,
// arrays, and nested objects: unknown values should not undergo policy validation.
// P5: also include names inherited from Object.prototype (constructor, toString,
// ...): a lookup like `key in fields` treats them as known (killed H3).
const prototypeNames = ["constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf"] as const
const unknownPolicyFields = fc
  .tuple(
    fc.jsonValue(),
    fc.dictionary(
      fc.constantFrom("course_name", "allowedUse", "gradingRubric", "x-policy", "備考", ...prototypeNames),
      fc.jsonValue(),
      { maxKeys: 4 },
    ),
  )
  .map((values) => ({ instructorNotes: values[0], ...values[1] }))
// P5: unknown fields can also appear inside the optional contact object, where
// warnings must name the nested path (contact.<field>). Empty means "none".
const unknownContactFields = fc.dictionary(
  fc.constantFrom("phone", "officeHours", "ta", ...prototypeNames),
  fc.jsonValue(),
  { maxKeys: 3 },
)

// R3: Adding unknown fields preserves a valid policy and reports a warning
// naming every added field, instead of turning the result into an error.
// Kind: metamorphic
test("R3: unknown fields preserve a loaded policy and warn with each field name", () =>
  Effect.promise(() =>
    fc.assert(
      fc.asyncProperty(
        validPolicy,
        unknownPolicyFields,
        unknownContactFields,
        async (policy, fields, contactFields) => {
          await using temp = await tmpdir()
          const file = path.join(temp.path, ".opencode", "ai-policy.json")
          await Bun.write(file, JSON.stringify(policy))
          const original = await loadAIPolicy(temp.path)
          expect(original.status).toBe("loaded")
          if (original.status !== "loaded") throw new Error("Expected the base policy to be valid")
          // A policy with no unknown fields has nothing to warn about.
          expect(original).not.toHaveProperty("warnings")

          const hasContactFields = Object.keys(contactFields).length > 0
          await Bun.write(
            file,
            JSON.stringify({
              ...policy,
              ...fields,
              ...(hasContactFields ? { contact: { ...policy.contact, ...contactFields } } : {}),
            }),
          )
          const extended = await loadAIPolicy(temp.path)
          expect(extended.status).toBe("loaded")
          expect(extended).not.toHaveProperty("error")
          if (extended.status !== "loaded") throw new Error("Expected unknown fields to keep the policy loaded")
          expect(extended.policy).toMatchObject({
            ...original.policy,
            contact: hasContactFields ? expect.anything() : original.policy.contact,
          })

          // Exactly one warning per unknown field, each naming the field by its full
          // (dotted) path in quotes, so a wrong prefix or a dropped field is visible.
          const expected = [...Object.keys(fields), ...Object.keys(contactFields).map((key) => `contact.${key}`)]
          expect(extended.warnings ?? []).toHaveLength(expected.length)
          for (const name of expected) {
            expect((extended.warnings ?? []).filter((warning) => warning.includes(`"${name}"`))).toHaveLength(1)
          }
        },
      ),
      { numRuns: 100 },
    ),
  ))

// R5: /policy re-reads the file and displays its current content, even when a
// content change preserves mtime or restores a previously displayed policy.
// Kind: metamorphic
test("R5: /policy displays edits and reversions without relying on modification time", () =>
  Effect.promise(async () => {
    await using temp = await tmpdir()
    await using app = await mountPolicyCommand(temp.path)
    await fc.assert(
      fc.asyncProperty(policyRevision, async (revision) => {
        const file = path.join(temp.path, ".opencode", "ai-policy.json")
        for (const policy of [revision.policy, revision.changed, revision.policy]) {
          await Bun.write(file, JSON.stringify(policy))
          await fs.utimes(file, 1_000_000_000, 1_000_000_000)
          // Ignore the scrollbox's right-hand scrollbar when comparing rows.
          const lines = (await app.show()).split("\n").map((line) => line.replace(/█/g, "").trim())
          expect(lines).toContain(`Course: ${policy.courseName}`.trim())
          expect(lines).toContain(`Assignment: ${policy.assignmentName}`.trim())
          expect(lines[lines.indexOf("Summary") + 1]).toBe(policy.summary.trim())
          policy.allowedUses.forEach((use) => expect(lines).toContain(`• ${use}`.trim()))
          policy.prohibitedUses.forEach((use) => expect(lines).toContain(`• ${use}`.trim()))
          if (policy.contact?.name) expect(lines).toContain(policy.contact.name.trim())
          if (policy.contact?.email) expect(lines).toContain(policy.contact.email)
        }
      }),
      { numRuns: 50 },
    )
  }))

// R5: "updated" appears exactly when the loaded policy differs from the last
// one shown. Identical saves, formatting/key order, and mtime alone do not count.
// Kind: oracle/model
test("R5: updated indicator matches the last policy shown, not file saves", () =>
  Effect.promise(async () => {
    await using temp = await tmpdir()
    await using app = await mountPolicyCommand(temp.path)
    await fc.assert(
      fc.asyncProperty(policyRevision, async (revision) => {
        const file = path.join(temp.path, ".opencode", "ai-policy.json")
        await Bun.write(file, JSON.stringify(revision.policy))
        await app.show()

        // Anchor each case to a known last-shown policy, independent of earlier
        // generated cases. The fixed transitions guarantee both indicator states.
        const shown = [revision.policy]
        for (const step of [
          { policy: revision.policy, pretty: false, time: 1_000_000_000 },
          { policy: revision.policy, pretty: true, time: 1_000_000_001 },
          { policy: revision.changed, pretty: false, time: 1_000_000_001 },
          { policy: revision.changed, pretty: true, time: 1_000_000_002 },
          { policy: revision.policy, pretty: false, time: 1_000_000_002 },
        ]) {
          await Bun.write(
            file,
            step.pretty
              ? JSON.stringify(Object.fromEntries(Object.entries(step.policy).reverse()), null, 2)
              : JSON.stringify(step.policy),
          )
          await fs.utimes(file, step.time, step.time)
          const frame = await app.show()
          expect(/\bupdated\b/i.test(frame)).toBe(!Bun.deepEquals(step.policy, shown[shown.length - 1]))
          shown.push(step.policy)
        }

        // An edit undone before /policy runs has never been shown and must not
        // become the comparison baseline or cause an "updated" indicator.
        await Bun.write(file, JSON.stringify(revision.changed))
        await Bun.write(file, JSON.stringify(revision.policy))
        expect(/\bupdated\b/i.test(await app.show())).toBe(false)
      }),
      { numRuns: 50 },
    )
  }))

// R2 (P5): realistic broken saves of the policy file. A valid policy cut off
// mid-write, a trailing comma, a // comment, single quotes, blank files, and a
// directory where the file should be. Each text case is checked to really fail
// JSON.parse, so the generator can never accidentally produce a valid file.
const unparseablePolicyFile = fc.oneof(
  fc
    .oneof(
      fc.tuple(validPolicy, fc.nat()).map(([policy, cut]) => {
        const text = JSON.stringify(policy)
        return text.slice(0, cut % text.length)
      }),
      validPolicy.map((policy) => JSON.stringify(policy).replace(/}$/, ",}")),
      validPolicy.map((policy) => `// AI policy\n${JSON.stringify(policy)}`),
      validPolicy.map((policy) => JSON.stringify(policy).replaceAll('"', "'")),
      fc.constantFrom("", " \n", "{", "undefined", "NaN"),
    )
    .filter((text) => {
      try {
        JSON.parse(text)
        return false
      } catch {
        return true
      }
    })
    .map((text) => ({ kind: "text" as const, text })),
  fc.constant({ kind: "directory" as const, text: "" }),
)

// R2: If the policy file can't be parsed, loading doesn't crash or pretend the
// policy is missing: it is reported as invalid with an "unable to parse"
// (not valid JSON) message that includes the file path, both in the loader's
// error and in what /policy displays, and the startup notification is a warning.
// Kind: invariant
test("R2: an unparseable policy file is reported as invalid with its path, never as missing", () =>
  Effect.promise(() =>
    fc.assert(
      fc.asyncProperty(unparseablePolicyFile, async (file) => {
        await using temp = await tmpdir()
        const policyPath = path.join(temp.path, ".opencode", "ai-policy.json")
        if (file.kind === "directory") await fs.mkdir(policyPath, { recursive: true })
        else await Bun.write(policyPath, file.text)

        const result = await loadAIPolicy(temp.path)
        expect(result.status).toBe("invalid")
        if (result.status !== "invalid") throw new Error("Expected an unparseable policy to be invalid")
        expect(result.error.message).toContain(policyPath)
        expect(result.error.message).toMatch(/not valid JSON/)

        const shown = mapAIPolicyLoadResult(result)
        expect(shown.status).toBe("invalid")
        if (shown.status === "invalid") expect(shown.errors.join("\n")).toContain(policyPath)
        expect(buildPolicyNotification(shown)).toEqual({
          message: expect.stringMatching(/invalid/i),
          variant: "warning",
        })
      }),
      { numRuns: 100 },
    ),
  ))

// R4 (P5): corrupt 1-3 distinct fields of a valid policy. Each corruption
// records the dotted path its error must name (the oracle). Covers: a missing
// required field, empty and whitespace-only strings, wrong types for strings and
// lists, a bad element inside a list (allowedUses.<i>), bad optional contact
// values (contact.name), and a file whose top-level value isn't an object.
const blankString = fc.constantFrom("", " ", "\t", "\n  ")
const requiredStringField = fc.constantFrom("courseName", "assignmentName", "summary")
const useListField = fc.constantFrom("allowedUses", "prohibitedUses")
const fieldCorruption = fc.oneof(
  fc.record({ kind: fc.constant("missing" as const), field: fc.oneof(requiredStringField, useListField) }),
  fc.record({
    kind: fc.constant("value" as const),
    field: requiredStringField,
    value: fc.oneof(blankString, fc.constantFrom<unknown>(0, true, null, ["text"], {})),
  }),
  fc.record({
    kind: fc.constant("value" as const),
    field: useListField,
    value: fc.constantFrom<unknown>("Use AI for outlines", 0, null, {}),
  }),
  fc.record({
    kind: fc.constant("element" as const),
    field: useListField,
    index: fc.nat(),
    value: fc.oneof(blankString, fc.constantFrom<unknown>(0, null, ["nested"])),
  }),
  fc.record({
    kind: fc.constant("contact" as const),
    field: fc.constantFrom("name", "email"),
    value: fc.oneof(blankString, fc.constantFrom<unknown>(0, null)),
  }),
)
const invalidPolicy = fc.oneof(
  {
    weight: 9,
    arbitrary: fc
      .tuple(
        validPolicy,
        fc.uniqueArray(fieldCorruption, {
          minLength: 1,
          maxLength: 3,
          selector: (c) => `${c.kind === "contact" ? "contact." : ""}${c.field}`,
        }),
      )
      .map(([policy, corruptions]) => {
        const data: Record<string, unknown> = structuredClone(policy)
        const paths: string[] = []
        for (const c of corruptions) {
          if (c.kind === "missing") {
            delete data[c.field]
            paths.push(c.field)
          } else if (c.kind === "value") {
            data[c.field] = c.value
            paths.push(c.field)
          } else if (c.kind === "element") {
            const list = Array.isArray(data[c.field]) ? [...(data[c.field] as unknown[])] : []
            const index = list.length ? c.index % list.length : 0
            list[index] = c.value
            data[c.field] = list
            paths.push(`${c.field}.${index}`)
          } else {
            data.contact = { ...(data.contact as object | undefined), [c.field]: c.value }
            paths.push(`contact.${c.field}`)
          }
        }
        // Field deletions/replacements can overlap only on distinct keys, so every
        // recorded path is still corrupt when the file is written.
        return { text: JSON.stringify(data), paths }
      }),
  },
  {
    weight: 1,
    arbitrary: fc.constantFrom<unknown>([], 5, "policy", null, true).map((value) => ({
      text: JSON.stringify(value),
      paths: ["policy"],
    })),
  },
)

// R4: A policy is invalid if a required field is missing, a required string is
// empty or whitespace-only, or a field has the wrong type; each error names its
// field. With several bad fields at once, every one is reported on its own line.
// Kind: model/oracle (the generator's recorded paths are the expected errors)
test("R4: every invalid field is reported on its own error line naming its path", () =>
  Effect.promise(() =>
    fc.assert(
      fc.asyncProperty(invalidPolicy, async ({ text, paths }) => {
        await using temp = await tmpdir()
        const policyPath = path.join(temp.path, ".opencode", "ai-policy.json")
        await Bun.write(policyPath, text)

        const result = await loadAIPolicy(temp.path)
        expect(result.status).toBe("invalid")
        if (result.status !== "invalid") throw new Error("Expected a corrupted policy to be invalid")
        const [header, ...lines] = result.error.message.split("\n")
        expect(header).toBe(`Invalid AI policy in ${policyPath}:`)
        for (const name of paths) {
          expect(lines.some((line) => line.startsWith(`  - ${name}: `) && line.length > `  - ${name}: `.length)).toBe(
            true,
          )
        }
      }),
      { numRuns: 150 },
    ),
  ))
