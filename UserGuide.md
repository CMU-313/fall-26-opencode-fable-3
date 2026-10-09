# User Guide

## Codebase Walkthrough (`walkthrough` tool)

_Issue #23, Demetrius Demammos._

### What it does

`walkthrough` gives the agent a quick, factual map of an unfamiliar repository so a student can ask "give me a walkthrough of this repo" instead of opening files one by one. It reads every `package.json` (skipping `node_modules`) and reports:

- the workspace packages, with a one-line description (from the manifest, or the first prose paragraph of the package's `README.md`/`AGENTS.md`)
- each package's entry points: `bin`, `main`, `module`, `exports` and `src/index|main`
- which workspace packages depend on which
- top-level directories with file counts, and key docs found at the root (`README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`)

The tool itself is deterministic static analysis, with no model call inside it. The same repository always produces the same output. The agent decides when to call it and writes the narrative around the facts it returns.

### Try it without a model (no API key needed)

1. From the repository root, install dependencies: `bun install`
2. Run the tool directly through the debug command:

   ```bash
   bun run --conditions=browser packages/opencode/src/index.ts debug agent build --tool walkthrough
   ```

3. You should see JSON whose `result.output` starts like this (the full output lists every package):

   ```text
   # opencode
   Docs: README.md, AGENTS.md, CONTRIBUTING.md

   ## Packages
   - @opencode-ai/app (packages/app)
     entry: exports: ., ./desktop-menu, ... (+2 more); src: src/index.ts
     depends on: @opencode-ai/client, @opencode-ai/core, ...
   ```

   Check that `@opencode-ai/core` lists `@opencode-ai/schema` and `@opencode-ai/llm` under `depends on`, and that the end of the output has a `## Top-level directories` section.

4. **Edge case: a folder with no `package.json`.** Make a scratch folder and run the same command from inside it, using the absolute path to this repo's `packages/opencode/src/index.ts`:

   ```bash
   mkdir -p /tmp/wt-demo/src && cd /tmp/wt-demo
   echo "# Demo" > README.md && echo "package main" > src/main.go
   bun run --conditions=browser /path/to/repo/packages/opencode/src/index.ts debug agent build --tool walkthrough
   ```

   Expected output: `Docs: README.md`, the line `No packages detected from package.json files; showing directory layout only.`, and `- src/ (1 files)`.

### Try it through the agent (needs a provider login)

1. Log in once: `bun run --conditions=browser packages/opencode/src/index.ts auth login`, then pick a provider and paste your own API key.
2. From the repository root, start the TUI: `bun run dev`
3. Ask: `Use the walkthrough tool to summarize this repository's structure.`
4. You should see a `walkthrough` tool call, followed by a summary built from the tool's output. `bun run dev` starts inside `packages/opencode`, so the walkthrough covers that package. The tool always analyzes the directory the session was started in.

### Automated tests

Run them from each package directory:

```bash
cd packages/core && bun test test/tool-walkthrough-analysis.test.ts test/tool-walkthrough.test.ts
cd packages/opencode && bun test test/tool/walkthrough.test.ts test/tool/registry.test.ts
```

| Test file                                              | What it checks                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/test/tool-walkthrough-analysis.test.ts` | The pure analyzer on an in-memory monorepo: workspace globs, entry points, dependency filtering (workspace-only, no self or external), descriptions, malformed manifests, `node_modules` skipping, and the rendered outline, including repos with no packages and an empty repo. |
| `packages/core/test/tool-walkthrough.test.ts`          | The core (V2) tool through the real registry, with fake and real filesystem layers: permission is requested, only manifests and READMEs are read, a denied permission stops before any file is read, and a fixture repo on disk is analyzed correctly.                           |
| `packages/opencode/test/tool/walkthrough.test.ts`      | The live (V1) tool that the CLI/TUI actually runs, against a fixture repo in a temp project: packages, entry points and dependencies, the permission request, the no-`package.json` fallback, and failure on denied permission.                                                  |
| `packages/opencode/test/tool/registry.test.ts`         | `walkthrough` appears in the live tool list. This guards the bug found during Sprint 1, where a tool could be registered and still never reach a real session.                                                                                                                   |

Why we believe this is enough: the analyzer is a pure function, so exact-output assertions on a fixture repo cover the acceptance criteria for #23 ("given a repo path, the tool returns a walkthrough with correct top-level architecture, verified against a fixture repo") without depending on a model. The tool wrappers are tested through the same registry the product uses, and the registry test fails if the tool is dropped from the live list. Line coverage of the new files is 100% in both packages. CI runs both `@opencode-ai/core#test` and `opencode#test`.

### Limitations

- The analysis stops at `package.json` level. It does not parse source `import` statements, so it shows which packages declare a dependency, not which files use which.
- It targets JavaScript/TypeScript workspaces. For other repositories it falls back to directory counts and key docs.

### Notes for developers

This repo has two tool registries: the newer one in `packages/core/src/tool/` and the one the running CLI/TUI uses in `packages/opencode/src/tool/registry.ts`. A new tool must be added to both, including the `builtin` array in the second registry. The `exposes walkthrough in the live tool list` test is the template for guarding that.

## Hint Mode (`/hint`)

_Issues #17, #18, #20 and #TODO-full-solution-issue, Palomi Nihalani._

### What it does

Hint Mode lets a student work through a programming problem with guidance instead of getting the answer straight away. While it is on:

- **Hints come first.** The model replies with hints, such as a guiding question, the concept involved, or where to look, instead of corrected code. It is also told not to edit files to apply a fix.
- **Hints get more detailed.** Asking for another hint moves up one of 4 levels:

  | Level | Name         | What the model may give                                                      |
  | ----- | ------------ | ---------------------------------------------------------------------------- |
  | 1     | Nudge        | A guiding question or the concept involved, but not where the problem is     |
  | 2     | Direction    | Where the problem is (file, function, lines) and which concept applies there |
  | 3     | Approach     | What is wrong and how to fix it, in words only                               |
  | 4     | Partial code | Only the key part of the fix, with a gap for the student to fill in          |

  Messages like "another hint", "next hint please", "I'm still stuck", "can you be more specific?" or just "hint" count as asking for another hint. Asking again at level 4 stays at level 4. A new question, or a message sent with Hint Mode off, starts again at level 1.

- **The full solution is given only when asked for.** After at least one hint, the student can say "show me the full solution", "just tell me the answer", "full solution please" or "I give up". The model then gives the complete solution and connects it to the earlier hints. Asking for the full solution before any hints gets a first hint instead.

With Hint Mode off, the model gets exactly the same instructions as before, so normal opencode behavior is unchanged.

How it works: the TUI saves the on/off setting and sends `hint` with each prompt. The server stores it on the user message. When the latest message has Hint Mode on, the server adds the hint rules (`packages/opencode/src/session/prompt/hint.txt`) to the system prompt. It also adds a short reminder next to the student's message, which names the current hint level or allows the full solution (`hint-reminder.txt`, `hint-solution.txt`). The level is worked out from the conversation in `packages/opencode/src/session/hint.ts`, so nothing new is stored and it survives restarts.

### Try the toggle without a model (no API key needed)

1. From the repository root, install dependencies: `bun install`
2. Start the TUI: `bun dev`
3. Type `/hint` and press Enter. A purple **hint** label appears in the footer under the prompt box, next to the agent name.
4. Press `ctrl+p` and search for "hint". The command reads **Disable hint mode** while it is on, and **Enable hint mode** while it is off.
5. Type `/hint` again. The label disappears.
6. Turn it back on, quit (`ctrl+c` twice), and run `bun dev` again. The label is still there, because the setting is saved.

### Try it through the agent (needs a provider)

1. Start the TUI with `bun dev`, run `/connect`, and add a provider. The model must support tool use. OpenCode Zen's free models only work from the official opencode app, not from this source build. A free Google Gemini API key from aistudio.google.com works.
2. Pick the model with `/models`, then turn on Hint Mode with `/hint`.
3. Send these one at a time in the same session:

   | Send                                            | Expected reply                                                                    |
   | ----------------------------------------------- | --------------------------------------------------------------------------------- |
   | The binary search question below                | Level 1: a guiding question. No line number and no fix.                           |
   | `Can I get another hint?`                       | Level 2: points at the `lo = mid` line, without saying what to change.            |
   | `I'm still stuck`                               | Level 3: explains the fix in words, with no code.                                 |
   | `another hint please`                           | Level 4: a snippet with a gap, and a note that you can ask for the full solution. |
   | `Okay, show me the full solution`               | The full fixed function (`lo = mid + 1`), building on the earlier hints.          |
   | `Write a function that reverses a linked list.` | Back to level 1: a hint, not code.                                                |

   ```text
   My binary search loops forever. Can you fix it?

   def search(nums, target):
       lo, hi = 0, len(nums) - 1
       while lo <= hi:
           mid = (lo + hi) // 2
           if nums[mid] < target:
               lo = mid
           else:
               hi = mid - 1
       return lo
   ```

4. **Edge case: asking for the solution first.** In a new session with Hint Mode on, send `Give me the full solution: why does my recursive fibonacci exceed the max recursion depth?`. You should get a first hint, plus a note that you can ask for the full solution after trying it.
5. **Hint Mode off.** Run `/hint` to turn it off and ask the binary search question again. You should get the fix straight away, as normal.

### Automated tests

Run them from each package directory:

```bash
cd packages/tui && bun test test/cli/tui/hint.test.tsx
cd packages/opencode && bun test test/session/hint.test.ts
cd packages/opencode && bun test test/session/prompt.test.ts -t "hint|solution"
```

| Test file                                       | What it checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/tui/test/cli/tui/hint.test.tsx`       | The `/hint` toggle state: off by default, turns on and off, is written to the TUI's saved settings, and is restored after a restart.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `packages/opencode/test/session/hint.test.ts`   | 13 unit tests for the hint logic. Which phrases count as asking for another hint or for the full solution, and which do not (for example "Can you fix it?" and "Is my solution correct now?"). Levels go up one per request, stop at 4, and start over after a new question or after Hint Mode was off. The full solution is allowed only after a hint.                                                                                                                                                                                                                                                                                                                                                                            |
| `packages/opencode/test/session/prompt.test.ts` | 4 tests through the real prompt loop with a fake model server, checking exactly what is sent to the model. `prompt records hint mode on each user message`: `hint` is saved as true, false or not set. `loop adds hint instructions only to turns prompted in hint mode`: 3 programming questions get the hint rules, the same question with Hint Mode off does not. `loop raises the hint level for each request for another hint`: levels go 1, 2, 3, 4, 4, then 1 for a new question. `loop gives the full solution only when asked for it after hints`: an early request gets a hint, a request after hints gets the full solution with the earlier hints still in the conversation, and the next question goes back to hints. |

Why we believe this is enough: the parts that decide behavior are deterministic. These are the toggle state, the phrase matching, the level counting, and what gets sent to the model. The unit tests cover them directly with exact assertions, and the prompt loop tests check the actual request sent to a model server for every step of the hint-to-solution flow, so they do not depend on a real model's answers. The hint instruction and hint level tests were checked to fail when the feature code is removed. The TUI test covers 100% of the lines in `packages/tui/src/context/hint.ts`. The model's actual replies cannot be tested deterministically, which is what the manual steps above are for.

### Limitations

- The model is told not to edit files until the student asks for the full solution, but the edit tools are not disabled, so this relies on the model following instructions. Small free models are more likely to ignore the rules.
- Hint and solution requests are recognized by matching phrases, so unusual wording (for example "ugh I'm lost") is treated as a new question and starts again at level 1.
- Subagents do not receive the hint rules.

### Notes for developers

- The levels, phrase lists and level counting are all in `packages/opencode/src/session/hint.ts`. Add new phrasings to `anotherHintPatterns` or `solutionPatterns`, with a test case in `hint.test.ts`.
- `packages/tui` is not in the list of packages that `bun turbo test` runs in CI (see `turbo.json` and `TESTING.md`), so `hint.test.tsx` only runs locally. The `opencode` tests do run in CI.

## AI-Use Policy Awareness (Truanne)

Lets instructors include their AI-use policy in an assignment repo so students see it when they open the project in OpenCode and can read the full policy at any time.

### For instructors: adding a policy

Create `.opencode/ai-policy.json` in the root of the assignment's starter repo:

```json
{
  "courseName": "17-313 Foundations of Software Engineering",
  "assignmentName": "Project 2",
  "summary": "AI may help with understanding code, but you must write your own implementation.",
  "allowedUses": ["Explaining unfamiliar code", "Debugging help"],
  "prohibitedUses": ["Generating complete solutions", "Writing reflection answers"],
  "contact": { "name": "Course Staff", "email": "staff@example.edu" }
}
```

| Field | Required | Notes |
|---|---|---|
| courseName, assignmentName, summary | Yes | Non-empty text |
| allowedUses, prohibitedUses | Yes | Lists of text; may be empty |
| contact | No | `name` and `email` are both optional |

Unknown fields are rejected, so typos like `allowedUse` are caught. Students receive the policy when they clone or pull the repo. Edits show up the next time `/policy` is run or OpenCode is opened.

### For students: viewing the policy

- **On startup:** if the project has a policy, a short notification names the course and assignment. [Select "View policy" / Run `/policy`] to open it. It does not block typing.
- **Anytime:** run `/policy` to see the full policy. Allowed and prohibited uses are listed in separate labeled sections. Press Esc to close.
- **No policy:** no notification appears and OpenCode works normally. `/policy` explains that no policy is configured.
- **Invalid policy:** a warning appears on startup, and `/policy` lists what's wrong with the file (which field, and the problem).

This feature is advisory. It helps students avoid *unintentionally* violating a policy; it does not enforce or block anything.

### How to user test it

1. Run OpenCode from source: `[exact command from repo root]`, pointing it at a test project folder.
2. **Valid policy:** add the example file above to `<test project>/.opencode/`. Launch. Expect a notification naming the course and assignment. Open the policy and check that all fields appear, with allowed and prohibited uses separate.
3. **No contact:** remove `contact`, run `/policy`. The contact section is gone.
4. **No policy:** delete the file and relaunch. Expect no notification; `/policy` shows the empty state.
5. **Invalid policy:** delete `courseName` and relaunch. Expect a warning; `/policy` says `courseName` is missing. Also try broken JSON (delete a closing brace) and an empty file. OpenCode should keep working in all cases.
6. **Long text:** paste a long paragraph into `summary`. It wraps and the dialog scrolls with the keyboard.

### Automated tests

| What | Location |
|---|---|
| Schema (required/optional fields, types) | `[packages/opencode/test/policy/policy.test.ts]` and `[packages/opencode/test/policy/loading.test.ts]` |
| Loading (found / not found / invalid) | `[packages/opencode/test/policy/loading.test.ts]` |
| Validation error messages | `[packages/opencode/test/policy/loading.test.ts]` |
| Dialog content (`/policy`) | `[packages/tui/test/policy/display.test.ts]` |
| Startup notification | `[packages/tui/test/policy.test.ts]` |
| End-to-end integration | `[packages/opencode/test/policy/integration.test.ts]` |
| Shared fixtures | `[packages/opencode/test/policy/fixtures/ai-policy.json]` and `[packages/opencode/test/policy/fixtures/malformed.json]` |

Run them with `[bun run --cwd packages/opencode test test/policy]` and `[bun run --cwd packages/tui test test/policy.test.ts]`. They also run in CI on every PR.

**What they cover:** Unit tests check each piece: the schema accepts valid policies and rejects missing fields, wrong types, empty strings, and unknown keys; the loader distinguishes "no policy", "loaded", and "invalid" without throwing; validation messages name the field; the dialog content builder shows each field in the right section and omits contact when absent; and the startup logic shows a notification only for valid policies, a warning for invalid ones, and nothing when there is no policy.

The integration tests run the real chain, from a policy file on disk through the loader and the opencode-to-TUI mapping to what the dialog and notification show, for valid, missing, malformed, incomplete, empty, and long policies.

**Why we think this is sufficient:** every acceptance criterion from our issues maps to at least one test, and every failure mode we could think of
(no file, bad JSON, bad fields, unreadable file) is tested to confirm it doesn't crash OpenCode. The integration tests specifically cover the boundary between the `opencode` and `tui` packages, where the pieces could break even if each one passes its own tests.

**Limits:** the tests check *what content* is shown, not how it looks on screen. Visual layout, theme colors, and keyboard scrolling were verified by hand using the user testing steps above. [Edit if your integration tests render the dialog with a test renderer.]
