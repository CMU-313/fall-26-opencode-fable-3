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
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Session } from "../../src/session/session"
import { provideInstance, tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { mountPolicyCommand } from "./policy-command"

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
    field: fc.constantFrom("courseName", "assignmentName", "summary", "allowedUses", "prohibitedUses", "contact"),
  })
  .map((input) => ({
    policy: input.policy,
    // Every generated revision changes exactly one field, including fields that
    // a comparison limited to the course/assignment header would miss.
    changed:
      input.field === "allowedUses" || input.field === "prohibitedUses"
        ? { ...input.policy, [input.field]: [...input.policy[input.field], "Revision!"] }
        : input.field === "contact"
          ? {
              ...input.policy,
              contact: { name: `${input.policy.contact?.name ?? ""}!`, email: input.policy.contact?.email },
            }
          : { ...input.policy, [input.field]: `${input.policy[input.field]}!` },
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
const unknownPolicyFields = fc
  .tuple(
    fc.jsonValue(),
    fc.dictionary(fc.constantFrom("course_name", "allowedUse", "gradingRubric", "x-policy", "備考"), fc.jsonValue(), {
      maxKeys: 4,
    }),
  )
  .map((values) => ({ instructorNotes: values[0], ...values[1] }))

// R3: Adding unknown fields preserves a valid policy and reports a warning
// naming every added field, instead of turning the result into an error.
// Kind: metamorphic
test("R3: unknown fields preserve a loaded policy and warn with each field name", () =>
  Effect.promise(() =>
    fc.assert(
      fc.asyncProperty(validPolicy, unknownPolicyFields, async (policy, fields) => {
        await using temp = await tmpdir()
        const file = path.join(temp.path, ".opencode", "ai-policy.json")
        await Bun.write(file, JSON.stringify(policy))
        const original = await loadAIPolicy(temp.path)
        expect(original.status).toBe("loaded")
        if (original.status !== "loaded") throw new Error("Expected the base policy to be valid")

        await Bun.write(file, JSON.stringify({ ...policy, ...fields }))
        const extended = await loadAIPolicy(temp.path)
        expect(extended.status).toBe("loaded")
        expect(extended).not.toHaveProperty("error")
        expect(extended).toMatchObject({
          policy: original.policy,
          warnings: expect.arrayContaining(Object.keys(fields).map((field) => expect.stringContaining(field))),
        })
      }),
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
