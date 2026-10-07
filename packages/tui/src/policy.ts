export type Policy = {
  courseName: string
  assignmentName: string
  summary: string
  allowedUses: readonly string[]
  prohibitedUses: readonly string[]
  contact?: {
    name?: string
    email?: string
  }
}

export type PolicyLoadResult =
  | { status: "not-found" }
  | { status: "loaded"; policy: Policy }
  | { status: "invalid"; errors: readonly string[] }

export type PolicyNotification = {
  message: string
  variant: "info" | "warning"
}

export function buildPolicyNotification(result: PolicyLoadResult): PolicyNotification | undefined {
  if (result.status === "not-found") return
  if (result.status === "invalid") {
    return {
      message: "AI-use policy file is invalid. Run /policy for details",
      variant: "warning",
    }
  }

  return {
    message: `AI-use policy: ${result.policy.courseName} · ${result.policy.assignmentName}. Run /policy to view`,
    variant: "info",
  }
}

export type PolicyDisplay =
  | { status: "empty"; message: string }
  | { status: "invalid"; errors: readonly string[] }
  | {
      status: "loaded"
      courseName: string
      assignmentName: string
      summary: string
      allowedUses: readonly string[]
      prohibitedUses: readonly string[]
      contact: readonly string[]
    }

export function buildPolicyDisplay(result: PolicyLoadResult): PolicyDisplay {
  if (result.status === "not-found") {
    return {
      status: "empty",
      message: "No AI-use policy found for this project. Instructors can add one at .opencode/ai-policy.json.",
    }
  }

  if (result.status === "invalid") return result

  return {
    status: "loaded",
    courseName: result.policy.courseName,
    assignmentName: result.policy.assignmentName,
    summary: result.policy.summary,
    allowedUses: result.policy.allowedUses,
    prohibitedUses: result.policy.prohibitedUses,
    contact: [result.policy.contact?.name, result.policy.contact?.email].filter(
      (value): value is string => value !== undefined,
    ),
  }
}