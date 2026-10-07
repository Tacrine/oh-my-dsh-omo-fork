# oh-my-dsh-omo-fork

A fork of **OMO** (oh-my-dsh) packaged for [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh): the **tri-agent** agent preset as a publishable Cordis bundle.

The preset gives an agent a two-mode identity and a full coding toolchain:

- **Atlas** — the standing orchestrator. It does not implement, verify, or review; it reads the plan, the notepad and the evidence, does the bookkeeping (ticking plan checkboxes, appending notepads) and delegates every unit of work to a named subagent.
- **Prometheus** — the planning doctrine. While a session is in plan mode (`/plan`), the identity swaps to Prometheus for the whole planning session, then swaps back. A single plugin, `plan-aware-persona.mjs`, owns the one `deployment:persona-prefix` slot and chooses the text per assembly by reading the public `plan` session projection. The `planMode` service is deliberately *not* injected: it lives inside the `isolate: { planMode: true }` realm, so injecting it from outside would never resolve.

Around that identity the preset mounts the coding toolchain: filesystem and shell tools, background jobs, skills, goals, plan mode, compaction, delegation and workflows, and the remaining model-facing rows — 18 declaration rows in total, including 9 anchored subagent rows (explore, librarian, oracle, momus, multimodal-looker, sisyphus-junior, metis, hephaestus, sisyphus). The package ships **11 persona files**; the plugin reads `atlas.md` and `prometheus.md` itself, and the other 9 are anchored to the subagent rows.

## What ships

| File | Purpose |
| --- | --- |
| `cordis.patch.yml` | The published bundle patch: the preset declaration and its `plugins:` list. |
| `plan-aware-persona.mjs` | The package entry: registers the plan-aware persona prefix and the configured suffix. |
| `personas/` | 11 persona files, byte-identical to the originals. |
| `tools/gen-preset-bundle.mjs` | Regenerates `cordis.patch.yml` from a legacy preset directory. |
| `tools/verify-preset-bundle.mjs` | Structurally compares the shipped patch against that legacy entry list. |

The patch mounts the following peer packages, which DSH provides:

`@deepseek-ai/dsh-agent-preset`, `dsh-agent-instructions`, `dsh-tool-bash`, `dsh-tool-pwsh`, `dsh-tool-fs`, `dsh-tool-fs-search`, `dsh-tool-jobs`, `dsh-skill-filesystem`, `dsh-tool-skill`, `dsh-command-goal`, `dsh-tool-goal`, `dsh-plan-mode`, `dsh-compaction-basic`, `dsh-command-compact`, `dsh-compaction-tool-result-pruner`, `dsh-tool-subagent-control`, `dsh-tool-subagent`, `dsh-workflow-ptc`, `dsh-tool-workflow`, `dsh-tool-ralph`, `dsh-tool-ask-user`, `dsh-tool-todo`, `dsh-tool-web`, `dsh-tool-present`, plus `@deepseek-ai/cordis`.

## Install

Installation is **two explicit steps**. Step 1 installs the dependency; step 2 tells the profile to load it. Both are required, and `dsh` is not assumed to be on your `PATH`.

### Step 1 — install the package into the profile

Point the CLI at your DSH checkout's bin file, and forward the install to the profile:

```powershell
node "<dsh bin>" plugin --profile <profile> add -w @tacrine/oh-my-dsh-omo-fork
```

For example, on a checkout whose runtime is `<dsh runtime>`, `<dsh bin>` is
`<dsh runtime>\@deepseek-ai\dsh\lib\bin.js`, so:

```powershell
node "<dsh runtime>\@deepseek-ai\dsh\lib\bin.js" plugin --profile web add -w @tacrine/oh-my-dsh-omo-fork
```

This runs pnpm inside `$DSH_HOME\profiles\<profile>\`, so it writes a `dependencies` entry. **It does not touch `dsh.profile.bundles`.**

### Step 2 — add the package to `dsh.profile.bundles` and restart

Open `$DSH_HOME\profiles\<profile>\package.json` and add the package name to the profile's `dsh.profile.bundles` array:

```jsonc
{
  "dsh": {
    "profile": {
      "bundles": [
        // ...your existing bundles...
        "@tacrine/oh-my-dsh-omo-fork"
      ]
    }
  }
}
```

Then **restart the Host and start a new session.** A live agent keeps the composition it booted with, so an already-running session will not pick the preset up — a new session is required.

> The in-tree skill `editing-cordis-compositions` prescribes `plugin_manager install_bundle` for a *workspace* bundle. That action does not apply to a third-party npm package, which is why the documented path here is the profile dependency plus the explicit bundles entry.

### Verify the install composed

```powershell
$env:DSH_HOME = "<dsh home>"
node "<dsh bin>" --profile <profile> --dump-config
```

The output should contain a `preset-tri-agent` row whose `name` is `@tacrine/oh-my-dsh-omo-fork`, and nine `personas` expressions resolving through that package.

## Post-install edits you may need

The published patch ships **only** the portable preset declaration. Two things that were local to the machine this fork came from are deliberately **not** shipped, so you may want to re-add them yourself:

1. **Making tri-agent your default preset.** The published patch does **not** set a default preset — this package never forces one. If you want tri-agent to be the default, set the registry row yourself in your own profile or overlay patch:

   ```yaml
   - id: agent-preset-registry
     config:
       default: tri-agent
   ```

   (`@deepseek-ai/dsh-web-app` inserts that row with `default: standard`; the row above replaces the whole config, so only the default changes.)

2. **Giving `subagent_multimodal_looker` a model route.** The fork's own machine-specific route was **removed from the published patch** on purpose — it pointed at a provider that exists on no other machine. Without it the multimodal subagent inherits the deployment's route. To pin one, add an `agentOptions` block to that row in your own overlay:

   ```yaml
   - id: tool-subagent-multimodal-looker
     name: '@deepseek-ai/dsh-tool-subagent'
     config:
       # ...the shipped config...
       agentOptions:
         provider: <your provider>
         model: <your model>
   ```

A repo-side `cordis.local.patch.yml` in this repository holds exactly those two rows for the original machine. It is **not published, not committed and not loaded locally** — it is kept only as a record, which is why you have to make these edits yourself.

## Failure mode: it fails loud on purpose

`plan-aware-persona.mjs` reads its persona prose from disk at mount time. A **missing or empty persona file fails the mount**, naming the file in the error:

```
plan-aware-persona: cannot read persona "file:///.../personas/atlas.md"
plan-aware-persona: persona "file:///.../personas/atlas.md" is empty
```

That is deliberate. An empty persona prefix would silently strip the agent's identity — a mount error that names the file is far easier to act on than an agent that quietly lost its instructions.

## Peer model

Every `@deepseek-ai/*` package the patch mounts is declared as a **`peerDependency`**, never as a regular `dependency`. DSH provides them; the bundle must not install its own copies. Peer ranges are pinned as `>=0.1.7-rc.2 <0.2.0` (and `@deepseek-ai/cordis` as `^4.0.1`).

The DSH profile's `.npmrc` sets `auto-install-peers=false`, so these peers are **declarative only**: pnpm will not fetch them, and a missing peer surfaces as a resolution error at mount time rather than being silently installed.

## Re-verifying the shipped artifact

`tools/verify-preset-bundle.mjs` structurally compares the shipped patch against the legacy entry list it was generated from, after applying only the three documented rewrites. It reports every difference by JSON path and prints a JSON report with `verdict`, `rows`, `rewrites`, `differences` and `selfReference`.

Run it from the repository root:

```powershell
node "E:\Downloads\oh-my-dsh-omo-fork\tools\verify-preset-bundle.mjs" --runtime "<dsh runtime node_modules>" --legacy "<path to the legacy agent.cordis.yml file>" --patch "E:\Downloads\oh-my-dsh-omo-fork\cordis.patch.yml" --package @tacrine/oh-my-dsh-omo-fork
```

Note `--legacy` takes the **file** (`agent.cordis.yml`), not the directory that holds it.

A healthy run prints `"verdict": "IDENTICAL"`, `"rows": 18`, `"rewrites": { "name": 1, "persona": 9, "agentOptions": 1 }` and `"differences": []`, and exits 0.

### The bare form, honestly

Every flag has a derived default, so this also works:

```powershell
$env:DSH_RUNTIME = "<dsh runtime node_modules>"
node "E:\Downloads\oh-my-dsh-omo-fork\tools\verify-preset-bundle.mjs"
```

**But the bare form is not guaranteed to work everywhere.** Two of those defaults depend on the machine:

- `--runtime` resolves from `$DSH_RUNTIME` if it is set, otherwise from the newest `$DSH_HOME\versions\*\node_modules` that actually contains both `js-yaml` and `@deepseek-ai/cordis-plugin-include`. If your DSH home has no `versions\` directory — which is common when DSH runs from a separate launcher checkout — **the bare form cannot resolve the runtime** and exits non-zero with a message naming `--runtime`. Neither of the two modules resolves from an arbitrary checkout directory.
- `--package` resolves from this repository's `package.json`; it is not a machine-specific default.

So: set `DSH_RUNTIME` to the runtime's `node_modules` (or pass `--runtime`) before relying on the bare form. **The explicit `--runtime` example above is the recommended form**, and it is the one to use in scripts and CI.

## Regenerating the patch

`cordis.patch.yml` is generated — do not hand-edit it. Edit the legacy preset directory, then:

```powershell
node tools/gen-preset-bundle.mjs --legacy "<legacy dir>" --out . --package @tacrine/oh-my-dsh-omo-fork
```

`--legacy` defaults to `$HOME/.dsh/.agent-presets/tri-agent`, `--out` to the repository root and `--package` to this package's name. The generator prints its three counters:

```
wrote cordis.patch.yml + cordis.local.patch.yml: name-rewrites=1 persona-rewrites=9 agent-options-strips=1 order=10
```

The three documented rewrites, applied when a legacy entry list becomes a bundle patch:

1. **The package self-reference** — the legacy relative plugin name `./plan-aware-persona.mjs` is re-anchored onto the installed package, because a bundle patch is not an include file and a relative name would be imported against the *profile* directory.
2. **The nine persona path anchors** — each `fileURLToPath(new URL('./personas/<file>', baseUrl))` becomes a `join(dirname(createRequire(baseUrl).resolve('<pkg>/package.json')), 'personas', '<file>')`, for the same reason.
3. **The multimodal `agentOptions` block is removed** — the machine-local `provider`/`model` route for `subagent_multimodal_looker` does not ship.

## Lineage

This package is a fork of **OMO** (oh-my-dsh), repackaged so the preset can be installed from npm instead of living as a private `link:` dependency in one machine's profile. The persona prose, the toolchain composition and the plugin are the upstream design; this fork's contribution is the packaging split — a publishable patch with no machine-local rows, a parameterized generator and a verifier that proves the shipped patch still matches the source it was generated from.

## License

MIT — see [LICENSE](./LICENSE).
