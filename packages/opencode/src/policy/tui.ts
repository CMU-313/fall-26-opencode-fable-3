import type { PolicyLoadResult } from "@opencode-ai/tui/policy"
import type { AIPolicyLoadResult } from "./policy"

export function mapAIPolicyLoadResult(result: AIPolicyLoadResult): PolicyLoadResult {
  if (result.status === "not-found") return result
  if (result.status === "loaded") return result
  return { status: "invalid", errors: result.error.message.split("\n").filter(Boolean) }
}