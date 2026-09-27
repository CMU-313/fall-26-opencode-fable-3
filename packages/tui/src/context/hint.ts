import { createMemo } from "solid-js"
import { useKV } from "./kv"

// Hint Mode is a persisted client preference. The TUI sends it with each prompt so the
// server records it on the user message, where response generation reads it.
export function useHintMode() {
  const kv = useKV()
  const [stored, setStored] = kv.signal("hint_mode", false)
  const enabled = createMemo(() => stored() === true)

  return {
    enabled,
    set(next: boolean) {
      setStored(() => next)
    },
    toggle() {
      setStored(() => !enabled())
    },
  }
}
