import { spyOn } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { Global } from "@opencode-ai/core/global"
import { Effect } from "effect"
import path from "path"
import { createTuiResolvedConfig } from "../../../tui/test/fixture/tui-runtime"
import { createFetch, eventSource, json } from "../../../tui/test/fixture/tui-sdk"
import { loadAIPolicy } from "../../src/policy/policy"
import { pollWithTimeout } from "../lib/effect"

export async function mountPolicyCommand(directory: string) {
  await Bun.write(path.join(directory, ".test-state", "kv.json"), "{}")
  const setup = await createTestRenderer({ width: 120, height: 60, useThread: false })
  const core = await import("@opentui/core")
  // The application owns renderer creation; replace only the terminal boundary.
  const factory = spyOn(core, "createCliRenderer").mockResolvedValue(setup.renderer)
  const { run } = await import("../../../tui/src/app")
  const ready = Promise.withResolvers<TuiPluginApi>()
  const task = Effect.runPromise(
    run({
      url: "http://test",
      directory,
      args: {},
      config: createTuiResolvedConfig({ plugin_enabled: {} }),
      fetch: createFetch((url) => {
        if (url.pathname === "/path") return json({ home: "", state: "", config: "", worktree: directory, directory })
        if (url.pathname === "/api/location") return json({ directory, project: { id: "proj_test", directory } })
        if (
          [
            "/api/agent",
            "/api/model",
            "/api/provider",
            "/api/integration",
            "/api/command",
            "/api/skill",
            "/api/reference",
          ].includes(url.pathname)
        )
          return json({ location: { directory, project: { id: "proj_test", directory } }, data: [] })
      }).fetch,
      events: eventSource(),
      pluginHost: {
        async start(input) {
          ready.resolve(input.api)
        },
        async dispose() {},
      },
      async loadAIPolicy(directory) {
        const result = await loadAIPolicy(directory)
        if (result.status !== "invalid") return result
        return { status: "invalid", errors: [result.error.message] }
      },
    }).pipe(Effect.provide(Global.layerWith({ state: path.join(directory, ".test-state") }))),
  )
  const api = await Promise.race([
    ready.promise,
    task.then(() => {
      throw new Error("TUI exited before registering /policy")
    }),
  ]).catch(async (error: unknown) => {
    setup.renderer.destroy()
    await task.catch(() => undefined)
    factory.mockRestore()
    throw error
  })

  return {
    async escape() {
      setup.mockInput.pressEscape()
      // A lone Esc is delivered after the terminal parser resolves its prefix.
      await Effect.runPromise(
        pollWithTimeout(
          Effect.sync(() => (api.ui.dialog.open ? undefined : true)),
          "Esc did not close the policy dialog",
          "1 second",
        ),
      )
      await setup.renderOnce()
      return api.ui.dialog.open
    },
    async show() {
      api.ui.dialog.clear()
      const command = api.keymap
        .getCommands({ visibility: "registered" })
        .find((command) => command.slashName === "policy")
      if (!command) throw new Error("/policy command is not registered")
      // Await the real command handler so assertions observe the finished reload.
      await command.run({
        keymap: api.keymap,
        focused: null,
        target: null,
        data: {},
        input: "/policy",
        payload: undefined,
        event: new core.KeyEvent({
          name: "return",
          ctrl: false,
          meta: false,
          shift: false,
          option: false,
          sequence: "\r",
          number: false,
          raw: "\r",
          eventType: "press",
          source: "raw",
        }),
      })
      await setup.renderOnce()
      const dialog = setup.renderer.root.findDescendantById("ai-policy-dialog")
      if (!dialog) throw new Error("/policy did not render its dialog")
      // Startup toasts may expire while a dialog is open; compare the dialog itself.
      return setup
        .captureCharFrame()
        .split("\n")
        .slice(dialog.y, dialog.y + dialog.height)
        .map((line) => line.slice(dialog.x, dialog.x + dialog.width))
        .join("\n")
    },
    async [Symbol.asyncDispose]() {
      setup.renderer.destroy()
      await task.finally(() => factory.mockRestore())
    },
  }
}
