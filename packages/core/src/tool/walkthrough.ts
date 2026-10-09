export * as WalkthroughTool from "./walkthrough"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { FileSystem } from "../filesystem"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { Ripgrep } from "../ripgrep"
import { RelativePath } from "../schema"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { WalkthroughAnalysis } from "./walkthrough-analysis"

export const name = "walkthrough"

const MAX_FILES = 50_000
const READ_CONCURRENCY = 8

export const Input = Schema.Struct({})

/** Static-analysis walkthrough of the active Location: packages, entry points, dependencies and docs. */
const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const filesystem = yield* FileSystem.Service
    const ripgrep = yield* Ripgrep.Service
    const location = yield* Location.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Summarize the repository's structure: workspace packages with their entry points and inter-package dependencies, top-level directories, and key docs. Use it first when orienting in an unfamiliar codebase, then read the entry points it lists.",
          input: Input,
          output: WalkthroughAnalysis.Overview,
          toModelOutput: ({ output }) => [{ type: "text", text: WalkthroughAnalysis.render(output) }],
          execute: (_input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: ["*"],
                save: ["*"],
                metadata: {},
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              const entries = yield* ripgrep.glob({ cwd: location.directory, pattern: "**/*", limit: MAX_FILES })
              const files = entries.map((entry) => entry.path)
              const decoder = new TextDecoder()
              const contents = Object.fromEntries(
                yield* Effect.forEach(
                  WalkthroughAnalysis.wanted(files),
                  (file) =>
                    filesystem
                      .read({ path: RelativePath.make(file) })
                      .pipe(Effect.map(({ content }) => [file, decoder.decode(content)] as const)),
                  { concurrency: READ_CONCURRENCY },
                ),
              )
              return WalkthroughAnalysis.analyze({ files, contents })
            }).pipe(Effect.mapError(() => new ToolFailure({ message: "Unable to build a repository walkthrough" }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/walkthrough",
  layer,
  deps: [ToolRegistry.node, FileSystem.node, Ripgrep.node, Location.node, PermissionV2.node],
})
