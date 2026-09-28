import { TextAttributes } from "@opentui/core"
import { For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { buildPolicyDisplay, type PolicyLoadResult } from "../policy"

export function DialogPolicy(props: { result: PolicyLoadResult }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const display = buildPolicyDisplay(props.result)

  dialog.setSize("large")

  return (
    <box gap={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          AI-use policy
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <scrollbox height={20} backgroundColor={theme.backgroundElement} scrollbarOptions={{ visible: true }}>
        <Show
          when={display.status === "loaded"}
          fallback={
            <Show
              when={display.status === "invalid"}
              fallback={<text fg={theme.textMuted} wrapMode="word">{display.message}</text>}
            >
              <box gap={1}>
                <For each={display.status === "invalid" ? display.errors : []}>
                  {(error) => <text fg={theme.error} wrapMode="word">{error}</text>}
                </For>
              </box>
            </Show>
          }
        >
          <box gap={1}>
            <text fg={theme.text} wrapMode="word">
              <b>Course:</b> {display.courseName}
            </text>
            <text fg={theme.text} wrapMode="word">
              <b>Assignment:</b> {display.assignmentName}
            </text>
            <box>
              <text fg={theme.textMuted}>Summary</text>
              <text fg={theme.text} wrapMode="word">{display.summary}</text>
            </box>
            <box>
              <text fg={theme.success} attributes={TextAttributes.BOLD}>Allowed</text>
              <For each={display.allowedUses}>
                {(use) => <text fg={theme.text} wrapMode="word">• {use}</text>}
              </For>
            </box>
            <box>
              <text fg={theme.error} attributes={TextAttributes.BOLD}>Not allowed</text>
              <For each={display.prohibitedUses}>
                {(use) => <text fg={theme.text} wrapMode="word">• {use}</text>}
              </For>
            </box>
            <Show when={display.contact.length > 0}>
              <box>
                <text fg={theme.textMuted}>Contact</text>
                <For each={display.contact}>
                  {(value) => <text fg={theme.text} wrapMode="word">{value}</text>}
                </For>
              </box>
            </Show>
          </box>
        </Show>
      </scrollbox>
    </box>
  )
}