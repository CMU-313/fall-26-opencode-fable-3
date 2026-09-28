import { Schema } from "effect"
import path from "path"

/**
 * The AI-use policy expected at `.opencode/ai-policy.json` in a student's project.
 * It identifies the course and assignment, summarizes the policy, lists allowed
 * and prohibited uses, and optionally provides a contact name and email.
 */
export const AIPolicy = Schema.Struct({
  courseName: Schema.String,
  assignmentName: Schema.String,
  summary: Schema.String,
  allowedUses: Schema.Array(Schema.String),
  prohibitedUses: Schema.Array(Schema.String),
  contact: Schema.optional(
    Schema.Struct({
      name: Schema.optional(Schema.String),
      email: Schema.optional(Schema.String),
    }),
  ),
})

export type AIPolicy = Schema.Schema.Type<typeof AIPolicy>

export type AIPolicyLoadResult =
  | { status: "not-found" }
  | { status: "loaded"; policy: AIPolicy }
  | { status: "invalid"; error: unknown }

export async function loadAIPolicy(projectDirectory: string): Promise<AIPolicyLoadResult> {
  const policyPath = path.join(projectDirectory, ".opencode", "ai-policy.json")
  const file = Bun.file(policyPath)

  if (!(await file.exists())) return { status: "not-found" }

  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch (error) {
    return { status: "invalid", error }
  }

  const result = Schema.decodeUnknownEither(AIPolicy)(parsed)
  if (result._tag === "Left") return { status: "invalid", error: result.left }
  return { status: "loaded", policy: result.right }
}