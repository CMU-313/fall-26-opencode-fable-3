import { Cause, Exit, Schema, SchemaIssue } from "effect"
import path from "path"

const NonEmptyString = Schema.String.pipe(
  Schema.check(Schema.makeFilter((value) => (value.trim().length ? undefined : "must not be empty"))),
)

function unknownFields(value: Record<string, unknown>, fields: object) {
  const known = new Set(Object.keys(fields))
  return Object.keys(value)
    .filter((key) => !known.has(key))
    .map((key) => ({ path: [key], issue: `unknown field "${key}"` }))
}

const ContactFields = {
  name: Schema.optional(NonEmptyString),
  email: Schema.optional(NonEmptyString),
}
const ContactBase = Schema.Struct(ContactFields)
const Contact = Schema.StructWithRest(ContactBase, [Schema.Record(Schema.String, Schema.Unknown)]).pipe(
  Schema.check(Schema.makeFilter((value) => unknownFields(value, ContactFields))),
)

/**
 * The AI-use policy expected at `.opencode/ai-policy.json` in a student's project.
 * It identifies the course and assignment, summarizes the policy, lists allowed
 * and prohibited uses, and optionally provides a contact name and email.
 */
const AIPolicyFields = {
  courseName: NonEmptyString,
  assignmentName: NonEmptyString,
  summary: NonEmptyString,
  allowedUses: Schema.Array(NonEmptyString),
  prohibitedUses: Schema.Array(NonEmptyString),
  contact: Schema.optional(Contact),
}
const AIPolicyBase = Schema.Struct(AIPolicyFields)
export const AIPolicy = Schema.StructWithRest(AIPolicyBase, [Schema.Record(Schema.String, Schema.Unknown)]).pipe(
  Schema.check(Schema.makeFilter((value) => unknownFields(value, AIPolicyFields))),
)

export type AIPolicy = Schema.Schema.Type<typeof AIPolicy>

export type AIPolicyLoadResult =
  | { status: "not-found" }
  | { status: "loaded"; policy: AIPolicy }
  | { status: "invalid"; error: Error }

export function formatAIPolicyError(pathname: string, error: unknown, kind: "json" | "schema") {
  const detail = error instanceof Error ? error.message : String(error)
  if (kind === "json") return `Invalid AI policy in ${pathname}:\n  - file is not valid JSON: ${detail}`

  const issues = Schema.isSchemaError(error)
    ? SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues
    : [{ message: detail, path: [] }]
  const messages = issues.map((issue) => {
    const field = issue.path?.map(String).join(".") || "policy"
    return `  - ${field}: ${issue.message}`
  })
  return `Invalid AI policy in ${pathname}:\n${messages.join("\n")}`
}

export async function loadAIPolicy(projectDirectory: string): Promise<AIPolicyLoadResult> {
  const policyPath = path.join(projectDirectory, ".opencode", "ai-policy.json")
  const file = Bun.file(policyPath)

  let parsed: unknown
  try {
    const text = await file.text()
    parsed = JSON.parse(text)
  } catch (error) {
    // Read directly: Bun.file().exists() also returns false for directories.
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { status: "not-found" }
    return { status: "invalid", error: new Error(formatAIPolicyError(policyPath, error, "json"), { cause: error }) }
  }

  const decoded = Schema.decodeUnknownExit(AIPolicy)(parsed, { errors: "all", propertyOrder: "original" })
  if (Exit.isFailure(decoded)) {
    const error = Cause.squash(decoded.cause)
    return { status: "invalid", error: new Error(formatAIPolicyError(policyPath, error, "schema"), { cause: error }) }
  }

  return { status: "loaded", policy: decoded.value }
}
