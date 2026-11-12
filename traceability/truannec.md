# Traceability: Truanne Chen (truannec)

**Target feature:** AI-Use Policy feature, src/policy/policy.ts, packages/tui/src/policy.ts, packages/tui/src/component/dialog-policy.tsx

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property (kind) | Test | Mutants it kills |
|---|---|---|---|---|---|---|---|
| R1 | C-6, O-6, S-5, S-7: “wouldn’t want open code to crash” (C-6) | If no policy file exists, opencode starts normally, applies no restrictions, and shows a message that no policy was found. | With no policy file in the project, “loadAIPolicy” returns a “missing” result (not an error), the session starts, and the startup notification says no policy was found. | Unchanged | Invariant: Missing policy permits session creation without restrictions and produces a no-policy notification | [R1: missing policy permits session startup and reports no policy found](/packages/opencode/test/policy/policy.property.test.ts#L49) | H1 |
| R2 | C-7, O-7: “it should just be a warning” (O-7) | If the policy file can’t be parsed, opencode doesn’t crash. It shows an “unable to parse policy” message that includes the file path. | With a policy file containing invalid JSON, the session still starts and the notification contains “unable to parse” and the file path. | Unchanged | Invariant (added in P5): an unparseable or unreadable policy file loads as invalid, never missing, with a not-valid-JSON message naming the path in the loader error and the /policy display, and a warning notification | [R2: an unparseable policy file is reported as invalid with its path, never as missing](/packages/opencode/test/policy/policy.property.test.ts#L366) | H2 (after P5 strengthening; survived before) |
| R3 | C-7, S-2 | Unknown fields don’t make a policy invalid. The policy still loads and a warning names each unknown field. | A valid policy plus an extra field “instructorNotes” loads successfully, and the result includes a warning naming “instructorNotes” and no error. | Unchanged | Metamorphic: Adding unknown fields preserves the loaded policy and produces warnings naming every added field. | [R3: unknown fields preserve a loaded policy and warn with each field name](/packages/opencode/test/policy/policy.property.test.ts#L212) | H3 (after P5 strengthening; survived before) |
| R4 | C-4, C-5, O-5, S-3, S-4: “I would want to see the new policy with the notification that it was updated” (O-5) | A missing required field, an empty required value, or an invalid value (e.g. a malformed email in a staff field) makes the policy invalid, and the error names the field. | With assignment: "", the result is invalid with an error naming assignment. A misspelled allowedUse in place of allowedUses is invalid because allowedUses is missing | Changed | Model/Oracle (added in P5): corrupting 1-3 fields (missing, blank, wrong type, bad list element, bad contact value, non-object file) yields invalid with one error line per corrupted path | [R4: every invalid field is reported on its own error line naming its path](/packages/opencode/test/policy/policy.property.test.ts#L476) | H4 (after P5 strengthening; survived before) |
| R5 | C-3, O-4: “The same policy” (O-4) | If the policy file changes while opencode is running, running /policy again shows the updated content and indicates it was reloaded. | Change the assignment name in the file, run /policy, and the new name appears together with an “updated” indicator. | Changed | Metamorphic: Re-reading displays edits and reversions regardless of modification time; Oracle/Model: the updated indicator matches changes from the last policy shown. | [R5: /policy displays edits and reversions without relying on modification time](/packages/opencode/test/policy/policy.property.test.ts#L263); [R5: updated indicator matches the last policy shown, not file saves](/packages/opencode/test/policy/policy.property.test.ts#L291) | H5, H6 (oracle property) |
| R6 | C-8, O-8, C-9 | Opening /policy repeatedly, with Esc in between, and without any file change shows identical content and no “updated” indicator. | Run /policy, press Esc, run /policy again, and the rendered output is identical, with no “updated” message. | Unchanged | Round Trip: Closing with Esc and reopening an unchanged policy preserves identical rendered content with no updated indicator. | [R6: Esc and repeated /policy opens preserve the rendered policy](/packages/opencode/test/policy/policy.property.test.ts#L154) | H6 |
| R7 | S-7, S-5, O-6 | The startup notification shows the course and assignment exactly as written in the policy file, so users can compare it against their actual assignment. | With course: "15-214" and assignment: "HW3", the notification contains both strings verbatim. | Changed | | | None (no property) |

Properties written or suggested by opencode or another AI tool: R1, R5 (second one), R6, (bug fixes during the test running phase). The P5 R2 and R4 properties and the R3 strengthening were drafted with Claude (AI) and checked against mutants H2-H4 and the Stryker survivors.

## Requirement changes

| ID | Original requirement (P3) | Revised requirement | Why it changed |
|---|---|---|---|
| R4 | A missing required field, an empty required value, or an invalid value (e.g. a malformed email in a staff field) makes the policy invalid, and the error names the field. | A policy is invalid if a required field is missing, a required string is empty or whitespace-only, or a field has the wrong type (e.g. allowedUses is not a list of strings). Each error names its field. No other condition makes a policy invalid. | Invalid value isn't clearly defined so you can't actually tell if the code meets it. The email example also only applies if the schema has a specific email field.|
| R5 | If the policy file changes while opencode is running, running /policy again shows the updated content and indicates it was reloaded. | When /policy is run, it re-reads the file and shows the current content. The “updated” indicator appears exactly when the loaded policy differs from the one last shown. Saving the file without changing its content does not trigger it. | Changes is slightly ambiguous. R5 says to always show updateds (even if just edits and reverts), but R6 says that idental content shouldn't |
| R7 | The startup notification shows the course and assignment exactly as written in the policy file. | The startup notification shows the course and assignment with leading and trailing whitespace trimmed and control characters removed. All other characters appear unchanged and in order. | A terminal UI can't safely render arbitrary strings exactly as writen if there are new lines or other characters. |

## Hand-written mutants

 Patches are in [`mutants/truannec/`](/mutants/truannec/). Each one was run with `git apply mutants/truannec/H<n>.patch`, then `bun test test/policy/policy.property.test.ts` from `packages/opencode`, then reverted. All 5 properties pass on the unmodified code at `588e85d`.

| ID | Requirement targeted | Change | Predicted killer | Actual result |
|---|---|---|---|---|
| H1 | R1 | `packages/tui/src/policy.ts`: `buildPolicyNotification` returns `undefined` for `not-found`, with a comment saying students without a policy shouldn't be nagged, so no "no policy found" message is shown | "Missing policy permits session startup and reports no policy found" (R1), because it asserts the notification text and `info` variant | **Killed** by R1 on the 1st run. Counterexample: `{directories: [], policyDirectory: false, files: []}` (the notification was `undefined`) |
| H2 | R2 | `src/policy/policy.ts`: in `loadAIPolicy`'s catch block, a `SyntaxError` returns `{ status: "not-found" }` ("a corrupt file shouldn't block startup"), so unparseable JSON silently reads as "no policy" instead of "unable to parse" plus the path | None. R2 has no property, and R1's generator writes malformed content (`{`) only to near-miss names (`ai-policy.json.bak`, `other-policy.json`), never to `.opencode/ai-policy.json` itself | **Survived** (5/5 pass), as predicted. Nothing writes invalid JSON to the real policy path |
| H3 | R3 | `src/policy/policy.ts`: `unknownFields` uses `!(key in fields)` instead of `!Object.hasOwn(fields, key)`, so unknown fields whose names are inherited from `Object.prototype` (`constructor`, `toString`, `hasOwnProperty`, …) get no warning | "Unknown fields preserve a loaded policy and warn with each field name" (R3) would catch it if it ever generated such a key, but I predicted **survive**: the key generator only draws from `instructorNotes`, `course_name`, `allowedUse`, `gradingRubric`, `x-policy`, `備考` | **Survived** (5/5 pass). The generator never produces an inherited property name |
| H4 | R4 | `src/policy/policy.ts`: `NonEmptyString` checks `value.length` instead of `value.trim().length`, so a whitespace-only `courseName`/`assignmentName`/`summary`/use is accepted as valid | None. R4 has no property, and `policyText` in the other properties always starts with `A`, `é`, or `1`, so whitespace-only strings are never generated | **Survived** (5/5 pass), as predicted |
| H5 | R5 | `packages/tui/src/app.tsx`: the `/policy` "updated" check compares only `courseName` and `assignmentName` instead of `isDeepEqual` on the whole policy, so editing the summary, uses, or contact never shows "(updated)" | "Updated indicator matches the last policy shown, not file saves" (R5 oracle), because `policyRevision` changes `summary`/`allowedUses`/`prohibitedUses`/`contact` in 4 of 6 cases | **Killed** by the R5 oracle on the 2nd run (`allowedUses` gained `"Revision!"`, expected "updated", got none). The R5 metamorphic property still passed because it checks content, not the indicator |
| H6 | R6 | `packages/tui/src/app.tsx`: the last-shown baseline is saved only on the first `/policy` of the session (`!shownPolicies.has(directory)`), so after any edit every later reopen shows "(updated)" forever | "Esc and repeated /policy opens preserve the rendered policy" (R6), because cases run in one mounted TUI, so from the 2nd case on the baseline is stale | **Killed** by R6 on the 2nd run (an unchanged reopen showed "updated"). Also killed by the R5 oracle |

**Final Run:** 3 of 6 killed (H1, H5, H6), and all 6 predictions were correct. All three survivors share the same cause: a requirement with no property (R2, R4) or a generator whose fixed vocabulary never reaches the boundary (R3). These will be the first survivors to fix when strengthening.

## Stryker comparison

### Setup

My config is [`packages/opencode/stryker.truannec.config.json`](/packages/opencode/stryker.truannec.config.json). It uses the `command` runner to run only my property file (`bun test test/policy/policy.property.test.ts`), and it mutates `src/policy/policy.ts:4-84`. That range is the schema, the error formatting, the loader, and the unknown-field warnings, which are the parts my properties actually call. I fixed the fast-check **seed to 42** with `fc.configureGlobal({ seed: 42 })` at the top of the property file.

A few things about the setup:
- I set `inPlace: true` because my property file imports `../../../tui/src/policy`. That file is outside `packages/opencode`, so Stryker's sandbox copy of the package couldn't find it.
- Stryker also won't mutate files outside the package (`../tui/src/policy.ts` matched nothing). So the TUI half of my feature, `buildPolicyNotification` and the "updated" logic in `app.tsx`, is only covered by my hand-written mutants H1, H5, and H6.
- I used `incremental` mode and ran Stryker in chunks, widening the `--mutate` range each time and reusing earlier results. Each command could only run for about 3 minutes in my setup. The last run used the full config and reused all 87 results.

Reports: [`mutants/truannec/mutation.html`](/mutants/truannec/mutation.html) (final) and [`mutants/truannec/mutation-before-strengthening.html`](/mutants/truannec/mutation-before-strengthening.html).

| Run | Mutants | Killed | Survived | Score (Stryker) | Score excluding 21 equivalent |
|---|---|---|---|---|---|
| Before strengthening (5 properties) | 87 | 28 | 59 | 32.18% | 42.42% (28/66) |
| After strengthening (7 properties) | 87 | 66 | 21 | **75.86%** | **100%** (66/66) |

### Which of my hand-written mutants did Stryker never generate? Why not?

H1, H5, and H6 are in `packages/tui/src/policy.ts` and `packages/tui/src/app.tsx`, which Stryker can't reach from this package.

H2 adds a new early `return` for `SyntaxError`. Stryker only changes or removes code that's already there, so it can't add a new branch. The closest it got was #29, which replaces the whole ENOENT check with `true` and treats every read error as missing.

H3 swaps `Object.hasOwn(fields, key)` for `key in fields`. Stryker can negate or simplify a condition, but it doesn't have a way to replace one membership check with a different one that behaves slightly differently.

H4 is the one Stryker did generate, as #1 (`value.trim()` → `value`).

### Which Stryker survivors would I never have thought of? Are any plausible bugs?

- **#44** (`errors: "all"` → `{}`): only the first schema error gets reported. This is a very reasonable bug in my opinion, since the decode options are easy to leave out.
- **#56, #61, #62, #64, #65** (breaking the `"contact" in parsed` check): warnings for unknown fields inside `contact` just disappear. This is also plausible, because nested objects are easy to forget about.
- **#66** (`"contact."` → `""`): the warning names the field but not that it's inside `contact`.
- **#19** (path join `"."` → `""`): `allowedUses.0` turns into `allowedUses0`.
- **#31, #35** (the ENOENT check widened to any error code): a directory at `ai-policy.json` gets treated as "no policy". This is plausible if someone tried to simplify the check.
- **#67** (`return []` → a fake warning when there's no `contact`): not a realistic bug, just a Stryker artifact.

These survivors showed me that R2 and R4 had no property at all, and that my R3 property used `arrayContaining` and `stringContaining`. Those let extra, mislabeled, or missing nested warnings through without noticing.

### What does each approach find that the other doesn't?

My hand-written mutants came from my requirements and interview notes. They could reach into the TUI (H1, H5, H6) and introduce logic that's different in kind, like H2's new early return and H3's `in`, which Stryker can't produce. Because I wrote a prediction for each one, the results also told me why a property was weak, not just that it was.

Stryker was much more thorough inside the loader. It tried every operator, so it caught formatting and options details I never thought about: `errors: "all"`, the nested contact check, the path joining, and the `"policy"` label for root-level errors. The downside is that 21 of the 87 mutants (24%) turned out to be equivalent, and I had to reason through each of those by hand. Some survivors, like the `"Stryker was here"` strings or an empty `status`, aren't bugs anyone would actually write.

### Strengthening

All killable survivors were killed by improving properties, and not by more example tests. The command runner reports kills per mutant, not per property, so the Stryker IDs below are the survivors each change was designed for (all of them are Killed in the final report).
- **R2 (new invariant):** generates truncated policies, trailing commas, `//` comments, single quotes, blank files, and a directory in place of the file. It requires `invalid` (never `not-found`), a "not valid JSON" message containing the path, the same path in the `/policy` display, and a warning notification. It kills **H2** and was aimed at Stryker survivors #6-10, #29, #31, #35, #40-42.
- **R4 (new model/oracle):** corrupts 1-3 distinct fields at once (missing, blank, whitespace-only, wrong type, bad list element, bad contact value) or writes a non-object file. The generator records each corrupted dotted path as the oracle, and every path must appear on its own `  - <path>: <message>` line. It kills **H4** and was aimed at Stryker survivors #0-2, #14-17, #19-23, #44-45, #48-51.
- **R3 (stronger generator and assertions):** unknown keys now include `Object.prototype` names (`constructor`, `toString`, …) and unknown fields inside `contact`. A clean policy must have no warnings, and the extended policy must have exactly one warning per unknown field, naming its full quoted path (`"contact.phone"`). It kills **H3** and was aimed at Stryker survivors #56, #61, #62, #64-67, #71.

Re-running the hand-written mutants against the strengthened file kills all six: H1 (R1), H2 (R2), H3 (R3), H4 (R4), H5 (R5 oracle), H6 (R6 and R5 oracle).

### Equivalent mutants (21)

**#11, #12, #13** (line 42, the fallback `issues` list in `formatAIPolicyError`)
This fallback only runs if a schema error somehow isn't a `SchemaError`. That can't happen, because the only schema caller passes the result of a failed `Schema.decodeUnknownExit`. JSON errors also return earlier at line 38, so this code never runs.

**#18** (line 44, `issue.path?.map` → `issue.path.map`)
The formatter always gives `path` as an array, even for root-level errors, where it's just empty. My R4 property writes non-object files to hit that case and still gets `- policy:`. Since `path` is never undefined, the `?.` doesn't do anything.

**#32, #33** (line 60, the `instanceof Error` / `"code" in error` part of the ENOENT check)
Anything `Bun.file().text()` or `JSON.parse` throws here is an `Error`, so that part of the check is always true. What actually matters is `error.code === "ENOENT"`, and it's the same in the original and both mutants.

**#43, #53** (lines 61 and 67, `{ cause: error }` → `{}`)
Nothing ever reads `cause`. The TUI mapping, the `/policy` dialog, and the startup notification only use `error.message`.

**#46** (line 64, `propertyOrder: "original"` → `""`)
This only changes the key order of the decoded policy object. The code reads fields by name, and the "updated" check uses `isDeepEqual`, which doesn't care about order, so the dialog looks the same either way.

**#52** (line 67, `"schema"` → `""`)
`formatAIPolicyError` only checks whether `kind === "json"`. Any other value goes down the schema branch, so the message comes out exactly the same.

**#55, #57, #58, #59, #60, #63** (line 72, the check before looking for unknown `contact` fields)
By this line the schema has already validated the file, so `parsed` is always a non-null object. That makes `typeof parsed === "object"` and `parsed !== null` always true, and swapping either for `true` changes nothing. When #55 or #57 skip the `"contact" in parsed` check and there's no contact, `unknownFields(undefined)` just returns `[]`, which is the same result.

**#74, #75, #76, #79, #81** (line 80, the "not an object" guard in `unknownFields`)
`unknownFields` is only called on `parsed` and on `parsed.contact` when it exists, and the schema guarantees both are objects. So this guard is never true, and changing it or what it returns has no effect.
