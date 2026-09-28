import { Schema } from "effect"

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