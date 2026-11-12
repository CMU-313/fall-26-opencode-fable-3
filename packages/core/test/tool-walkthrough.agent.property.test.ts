import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import fc from "fast-check"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { WalkthroughTool } from "@opencode-ai/core/tool/walkthrough"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { executeTool, toolIdentity } from "./lib/tool"

// Fixed for reproducibility, same as the other property files in this project.
fc.configureGlobal({ seed: 42 })

/**
 * This file replaces one opencode wrote for R6 (see the traceability file's "Agent
 * failure case" section). opencode's original version called `WalkthroughAnalysis.analyze`
 * and `.render` directly on an in-memory snapshot object — the pure analyzer, which never
 * reads a real file or spawns anything, so it can never execute a lifecycle script no
 * matter what the test does.
 *
 * This version drives the real `WalkthroughTool` (packages/core) against a real temp
 * directory — the same harness `packages/core/test/tool-walkthrough.test.ts` already uses
 * for its "live" fixture test — so a script that actually runs leaves a real marker file
 * on disk. (I moved this off the `packages/opencode` wrapper after discovering that
 * harness's project bootstrap does a real dependency install independent of anything
 * walkthrough-specific, which made "did walkthrough run this, or did something else"
 * impossible to isolate there. This one has no such confound: `tempLocationLayer` is a
 * plain temp directory with no project bootstrap at all.)
 *
 * Generator choices: `scriptsArb` always includes "postinstall" (literally what R6's
 * acceptance criteria names) plus a random subset of the other real npm/bun lifecycle
 * script names, each a real shell command that creates a marker file — so "marker absent"
 * can only mean the script was never executed, not a fluke of which scripts were chosen.
 */
const scriptNames = ["preinstall", "install", "prepare", "prepack", "postpack", "prepublishOnly", "build"]
const scriptsArb = fc.subarray(scriptNames).map((extra) => ["postinstall", ...extra])
const cases = fc.sample(scriptsArb, { numRuns: 8, seed: 42 })

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const live = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Location.node, ToolRegistry.node, ToolRegistry.toolsNode, WalkthroughTool.node]),
    [
      [PermissionV2.node, permission],
      [Location.node, tempLocationLayer],
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
    ],
  ),
)

const sessionID = SessionV2.ID.make("ses_walkthrough_agent_property")
const call = {
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id: "call-walkthrough-agent", name: WalkthroughTool.name, input: {} },
}

describe("WalkthroughTool properties (agent, strengthened)", () => {
  for (const [index, scripts] of cases.entries()) {
    live.live(`R6: scripts ${JSON.stringify(scripts)} are never executed by the real tool`, () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const root = (yield* Location.Service).directory
        const marker = path.join(root, `marker-${index}.txt`)
        const scriptsObj = Object.fromEntries(scripts.map((script) => [script, `touch "${marker}"`]))

        yield* Effect.promise(() =>
          fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "acme", scripts: scriptsObj })),
        )

        yield* executeTool(registry, call)

        const marked = yield* Effect.promise(() =>
          fs
            .stat(marker)
            .then(() => true)
            .catch(() => false),
        )
        expect(marked).toBe(false)
      }),
    )
  }
})
