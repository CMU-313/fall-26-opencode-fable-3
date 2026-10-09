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
