import path from "path"
import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { WalkthroughAnalysis } from "@opencode-ai/core/tool/walkthrough-analysis"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({})

const MAX_FILES = 50_000

export const WalkthroughTool = Tool.define(
  "walkthrough",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service
    return {
      description:
        "Summarize the repository's structure: workspace packages with their entry points and inter-package dependencies, top-level directories, and key docs. Use it first when orienting in an unfamiliar codebase, then read the entry points it lists.",
      parameters: Parameters,
      execute: (_params: Record<string, never>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          yield* ctx.ask({
            permission: "walkthrough",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          const entries = yield* ripgrep.glob({ cwd: ins.directory, pattern: "**/*", limit: MAX_FILES })
          const files = entries.map((entry) => entry.path)
          const contents: Record<string, string> = {}
          for (const file of WalkthroughAnalysis.wanted(files)) {
            const text = yield* fs.readFileStringSafe(path.join(ins.directory, file))
            if (text !== undefined) contents[file] = text
          }

          const overview = WalkthroughAnalysis.analyze({ files, contents })
          return {
            output: WalkthroughAnalysis.render(overview),
            title: "Repository walkthrough",
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
