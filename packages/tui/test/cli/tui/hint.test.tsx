/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { KVProvider } from "../../../src/context/kv"
import { useHintMode } from "../../../src/context/hint"

async function wait(fn: () => boolean | Promise<boolean>, timeout = 2000) {
  const start = Date.now()
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function mountHint(root: string, kv: Record<string, unknown>) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), JSON.stringify(kv))

  const ref: { hint?: ReturnType<typeof useHintMode> } = {}
  function Probe() {
    ref.hint = useHintMode()
    return <text>{ref.hint.enabled() ? "on" : "off"}</text>
  }

  const app = await testRender(() => (
    <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
      <KVProvider>
        <Probe />
      </KVProvider>
    </TestTuiContexts>
  ))
  await wait(() => ref.hint !== undefined)
  return { app, hint: ref.hint!, file: path.join(state, "kv.json") }
}

test("hint mode is disabled by default and toggles on and off", async () => {
  await using tmp = await tmpdir()
  const mounted = await mountHint(tmp.path, {})

  try {
    expect(mounted.hint.enabled()).toBe(false)

    mounted.hint.toggle()
    expect(mounted.hint.enabled()).toBe(true)
    await wait(async () => (await Bun.file(mounted.file).json()).hint_mode === true)

    mounted.hint.toggle()
    expect(mounted.hint.enabled()).toBe(false)

    mounted.hint.set(true)
    expect(mounted.hint.enabled()).toBe(true)
  } finally {
    mounted.app.renderer.destroy()
  }
})

test("hint mode restores the persisted preference", async () => {
  await using tmp = await tmpdir()
  const mounted = await mountHint(tmp.path, { hint_mode: true })

  try {
    expect(mounted.hint.enabled()).toBe(true)
  } finally {
    mounted.app.renderer.destroy()
  }
})
