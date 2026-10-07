# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-10-07

First published release: the `tri-agent` agent preset (Atlas orchestration + Prometheus planning) as a fork of OMO, packaged for DeepSeek Harness as a Cordis bundle.

### Added

- The published bundle patch `cordis.patch.yml`: the preset declaration with its `plugins:` list — 18 declaration rows, including the 9 anchored subagent persona rows.
- `plan-aware-persona.mjs`: the package entry, owning the single `deployment:persona-prefix` slot and choosing Atlas or Prometheus per assembly from the public `plan` session projection.
- `personas/`: 11 persona files, byte-identical to the originals.
- `tools/gen-preset-bundle.mjs`: a parameterized generator (`--legacy`, `--out`, `--package`) whose every path default is derived from `os.homedir()` and the repository layout.
- `tools/verify-preset-bundle.mjs`: a structural verifier with a five-flag CLI (`--legacy`, `--patch`, `--dump`, `--package`, `--runtime`), reporting `verdict`, `rows`, `rewrites`, `differences` and `selfReference`.
- `cordis.local.patch.yml` in the repository: a record of the two deployment-local rows. **Not published, not committed and not loaded locally.**

### The three documented rewrites

A legacy preset directory is an *include file*; a bundle patch is not. Both of its relative anchors would otherwise resolve against the profile directory and fail to mount, so the generator applies exactly three rewrites, and the verifier asserts exactly the same three:

1. **The package self-reference** — the relative plugin name `./plan-aware-persona.mjs` is re-anchored onto the installed package (`name: '@tacrine_f/oh-my-dsh-omo-fork'`), so the persona plugin resolves from the package rather than the profile.
2. **The nine persona path anchors** — every `fileURLToPath(new URL('./personas/<file>', baseUrl))` becomes
   `join(dirname(createRequire(baseUrl).resolve('@tacrine_f/oh-my-dsh-omo-fork/package.json')), 'personas', '<file>')`,
   for the 9 anchored subagent rows.
3. **The multimodal `agentOptions` block is removed** — the machine-local `provider`/`model` route for `subagent_multimodal_looker` does not ship. Consumers re-add their own route; the published patch never pins a machine-specific provider.

### Notes

- Every `@deepseek-ai/*` package the patch mounts is a `peerDependency` (`>=0.1.7-rc.2 <0.2.0`, and `@deepseek-ai/cordis` as `^4.0.1`). There are no regular runtime `dependencies`.
- The published patch sets **no** default preset and carries no deployment-local rows. Setting `agent-preset-registry.default: tri-agent` is a post-install edit.
- `exports` keeps `"./package.json"`, because the persona anchors resolve `<pkg>/package.json` through `createRequire`. Without it they fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- A missing or empty persona file fails the mount by design.

[0.1.0]: https://github.com/Tacrine/oh-my-dsh-omo-fork/releases/tag/v0.1.0
