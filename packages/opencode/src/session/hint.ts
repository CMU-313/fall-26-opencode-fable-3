import type { SessionV1 } from "@opencode-ai/core/v1/session"
import HINT_REMINDER from "./prompt/hint-reminder.txt"
import HINT_SOLUTION from "./prompt/hint-solution.txt"

// Ordered from least to most detailed. No level gives the complete solution.
export const levels = [
  {
    name: "Nudge",
    guidance: "Ask a guiding question or name the concept involved. Do not say where the problem is or what to change.",
  },
  {
    name: "Direction",
    guidance:
      "Point to where the problem is, such as the file, function, or lines, and explain which concept applies there. Do not say what to change.",
  },
  {
    name: "Approach",
    guidance: "Explain what is wrong and describe how to fix it in words. Do not write the fixed code.",
  },
  {
    name: "Partial code",
    guidance:
      "Show only the key part of the fix as a short snippet or pseudocode with a gap for the student to fill in, and explain why it works. Do not give the complete solution. This is the most detailed hint, so if the student wants more, tell them they can ask for the full solution, for example by saying 'show me the full solution'.",
  },
] as const

const anotherHintPatterns = [
  /\b(another|next|more|further|additional|extra|bigger|second)\s+hints?\b/i,
  /\bstill\s+(stuck|confused|lost|not\s+working|(don'?t|do\s+not)\s+(get|understand))\b/i,
  /\bmore\s+(detail|details|detailed|specific|help)\b/i,
  /^\s*(hint|more|another(\s+one)?|next)(\s+please)?\s*[.!?]*\s*$/i,
]

export function isAnotherHintRequest(text: string) {
  return anotherHintPatterns.some((pattern) => pattern.test(text))
}

// Only explicit requests count. "Can you fix it?" is how most questions start, so it still gets hints first.
const solutionPatterns = [
  /\b(show|give|tell|reveal|send|share|write)\s+(me\s+)?(the\s+)?(full|complete|whole|entire|final|actual)\s+(solution|answer|code|fix)\b/i,
  /\b(show|give|tell|reveal)\s+(me\s+)?the\s+(solution|answer)\b/i,
  /\b(full|complete)\s+solution\b/i,
  /\bjust\s+(tell|show|give)\s+me\b/i,
  /\bi\s+give\s+up\b/i,
]

export function isSolutionRequest(text: string) {
  return solutionPatterns.some((pattern) => pattern.test(text))
}

// The full solution is only given after at least one hint on the same problem, so it can build on that
// guidance. Asking for it up front gets a first hint instead.
export function solutionRequested(prompts: readonly { hint?: boolean; text: string }[]) {
  const latest = prompts.at(-1)
  return !!latest?.hint && isSolutionRequest(latest.text) && !!prompts.at(-2)?.hint
}

// Prompts are the Session's user messages, oldest first. The latest prompt's level is one plus the
// number of "another hint" requests in a row before it, starting from the Hint Mode question they follow.
// A new question, or a prompt sent with Hint Mode off, starts again at level 1.
export function level(prompts: readonly { hint?: boolean; text: string }[]) {
  const start = prompts.findLastIndex((prompt) => !prompt.hint || !isAnotherHintRequest(prompt.text))
  const requests = prompts.length - 1 - start
  const question = prompts[start]?.hint ? 1 : 0
  return Math.min(Math.max(requests + question, 1), levels.length)
}

export function reminder(messages: readonly SessionV1.WithParts[]) {
  const prompts = messages.flatMap((message) =>
    message.info.role === "user"
      ? [
          {
            hint: message.info.hint,
            text: message.parts
              .flatMap((part) => (part.type === "text" && !part.synthetic && !part.ignored ? [part.text] : []))
              .join("\n"),
          },
        ]
      : [],
  )
  if (solutionRequested(prompts)) return HINT_SOLUTION
  const current = level(prompts)
  // Replacer functions keep "$" in the inserted text from being read as a replacement pattern.
  return HINT_REMINDER.replace("${level}", () => String(current))
    .replace("${max}", () => String(levels.length))
    .replace("${name}", () => levels[current - 1].name)
    .replace("${guidance}", () => levels[current - 1].guidance)
}

export * as SessionHint from "./hint"
