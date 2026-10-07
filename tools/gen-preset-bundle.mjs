/**
 * Generate the `tri-agent` agent-preset bundle from a legacy preset directory
 * (`$DSH_HOME/.agent-presets/tri-agent/` by default).
 *
 * Why this is a generator and not a copy:
 *
 * The legacy layout was an *include file*. `agent.cordis.yml` was loaded as its
 * own entry list, so its `ctx.baseUrl` was the legacy directory, and both the
 * relative plugin name `./plan-aware-persona.mjs` and every
 * `new URL('./personas/<x>.md', baseUrl)` resolved beside it.
 *
 * A bundle patch is not an include file. The patch loader
 * (`@deepseek-ai/dsh-app-boot/lib/index.js:3536` `anchorInsertedPluginNames`)
 * rewrites a relative `name` only for rows it walks — top-level `insert` rows
 * and nested rows of a `group: true` row. A preset declaration row is neither,
 * and its `plugins` list is a plain `config` value, so a nested
 * `name: ./plan-aware-persona.mjs` would be imported against the *profile*
 * directory and the mount would fail. `baseUrl` inside `!!js` has the same
 * problem: the preset mount inherits the declaring Loader's base
 * (`dsh-agent-preset-registry/lib/index.js:534`), which is the profile
 * directory.
 *
 * Both are therefore re-anchored onto the installed package, which is also what
 * the shipped `cordis` preset does
 * (`@deepseek-ai/dsh-web-app/presets/cordis.patch.yml:147`).
 *
 * The `plugins:` body itself is the legacy file's text verbatim, indented —
 * comments, groups, `isolate` realms, `disabled` and every `!!js` expression
 * survive byte-for-byte. Only the two anchors above are substituted, and the
 * multimodal subagent's machine-local `agentOptions` route is stripped (see
 * below).
 *
 * Output split (two files, both written into `--out`):
 *
 *   - `cordis.patch.yml` — the publishable patch. No deployment-local site rows
 *     and no machine-local model route, so it is safe to publish verbatim.
 *   - `cordis.local.patch.yml` — the two site rows that are specific to the
 *     machine this preset runs on (the deployment default and the
 *     `dsh-autoresume` disable). Git-ignored on purpose; re-applied locally.
 *
 * The multimodal subagent row carries `agentOptions: {provider: xinjianya,
 * model: gpt-5.6-sol}`. That route is a local provider that does not exist on
 * any other machine, so the whole `agentOptions:` key is stripped from the
 * published patch and counted (`agent-options-strips`).
 *
 * Every default path is derived from `os.homedir()`, so nothing in this file is
 * machine-specific.
 *
 * Usage:
 *   node tools/gen-preset-bundle.mjs [--legacy <dir>] [--out <dir>] [--package <name>]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Parse `--flag value` pairs; unknown flags are a hard error. */
const parseArgs = (argv) => {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`)
    const name = token.slice(2)
    if (!['legacy', 'out', 'package'].includes(name)) throw new Error(`unknown flag: ${token}`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${token} needs a value`)
    flags[name] = value
    index += 1
  }
  return flags
}

const flags = parseArgs(process.argv.slice(2))

/**
 * Defaults. The legacy directory is derived from the current user's home, and
 * the output directory defaults to the repository root — the parent of this
 * module's own `tools/` directory — never to `tools/` itself.
 */
const LEGACY = flags.legacy ?? join(homedir(), '.dsh', '.agent-presets', 'tri-agent')
const OUT = flags.out ?? join(import.meta.dirname, '..')

const PACKAGE = flags.package ?? '@tacrine_f/oh-my-dsh-omo-fork'
const ORDER = 10

/** `!!js` expression resolving this bundle's installed package directory. */
const BUNDLE_DIR = [
  "process.getBuiltinModule('node:path').dirname(",
  "process.getBuiltinModule('node:module').createRequire(baseUrl)",
  `.resolve('${PACKAGE}/package.json'))`,
].join('')

let source
let preset
try {
  source = readFileSync(join(LEGACY, 'agent.cordis.yml'), 'utf8')
  preset = readFileSync(join(LEGACY, 'preset.yml'), 'utf8')
} catch (error) {
  throw new Error(`cannot read the legacy preset at ${LEGACY}: ${error.message}`)
}

const nameMatch = /^name:\s*(.+?)\s*$/m.exec(preset)
if (nameMatch === null) throw new Error('preset.yml carries no name')
const displayName = nameMatch[1]

const descriptionMatch = /^description:\s*\|-\r?\n((?:[ \t].*\r?\n?)*)/m.exec(preset)
if (descriptionMatch === null) throw new Error('preset.yml carries no |- description block')
const descriptionLines = descriptionMatch[1]
  .split(/\r?\n/)
  .filter((line) => line.trim() !== '')
  .map((line) => line.trim())

const substitutions = { name: 0, persona: [], agentOptions: 0 }

/** Indent every non-empty line of a block by `pad` spaces. */
const indent = (text, pad) =>
  text
    .split(/\r?\n/)
    .map((line) => (line.trim() === '' ? '' : ' '.repeat(pad) + line))
    .join('\n')

/**
 * `fileURLToPath(new URL('./personas/<file>', baseUrl))` collapses to one
 * `join(...)` of native path segments: the rewritten expression already yields a
 * filesystem path, so the URL round-trip is removed with it rather than left to
 * throw on a non-URL argument.
 */
const PERSONA_PATH = new RegExp(
  String.raw`process\.getBuiltinModule\('node:url'\)\.fileURLToPath\(` +
    String.raw`new URL\('\.\/personas\/([^']+)', baseUrl\)\)`,
  'g',
)

/**
 * Drop the whole `agentOptions:` key of the multimodal subagent row — the key
 * line plus exactly its own more-indented child lines — and nothing else. The
 * scan stops at the first non-blank line indented at or below the key, so the
 * sibling `persona:` and `toolFilter:` rows survive untouched.
 */
const stripAgentOptions = (text) => {
  const lines = text.split('\n')
  const kept = []
  let keyIndent = null
  for (const line of lines) {
    if (keyIndent !== null) {
      const indentMatch = /^[ \t]*/.exec(line)[0]
      if (line.trim() === '' || indentMatch.length > keyIndent) continue
      keyIndent = null
    }
    const keyMatch = /^([ \t]*)agentOptions:(?!\S)[ \t]*$/.exec(line)
    if (keyMatch !== null) {
      keyIndent = keyMatch[1].length
      substitutions.agentOptions += 1
      continue
    }
    kept.push(line)
  }
  return kept.join('\n')
}

const body = stripAgentOptions(
  source
    .replace(/^(\s*)name:\s*\.\/plan-aware-persona\.mjs\s*$/m, (_match, pad) => {
      substitutions.name += 1
      return `${pad}name: '${PACKAGE}'`
    })
    .replace(PERSONA_PATH, (_match, file) => {
      substitutions.persona.push(file)
      return `process.getBuiltinModule('node:path').join(${BUNDLE_DIR}, 'personas', '${file}')`
    }),
)

if (substitutions.name !== 1) throw new Error(`expected exactly one ./plan-aware-persona.mjs row, rewrote ${substitutions.name}`)
if (substitutions.persona.length !== 9) throw new Error(`expected 9 persona paths, rewrote ${substitutions.persona.length}`)
if (substitutions.agentOptions !== 1) throw new Error(`expected exactly one multimodal agentOptions block, stripped ${substitutions.agentOptions}`)
if (body.includes("'./personas/")) throw new Error('a persona path was left anchored on baseUrl')
if (body.includes('agentOptions')) throw new Error('an agentOptions key was left in the published patch')

const declaration = [
  '# The declaration. `plugins` is the legacy agent.cordis.yml entry list verbatim.',
  '- insert:',
  '    - id: preset-tri-agent',
  "      name: '@deepseek-ai/dsh-agent-preset'",
  '      config:',
  '        id: tri-agent',
  `        name: ${displayName}`,
  '        description: |-',
  ...descriptionLines.map((line) => `          ${line}`),
  `        order: ${ORDER}`,
  '        plugins:',
  indent(body, 10).replace(/\s+$/, ''),
  '',
  '',
]

const document = [
  '# tri-agent agent preset — migrated from the retired $DSH_HOME/.agent-presets/tri-agent/',
  '# directory (see @deepseek-ai/dsh-agent-preset/skills/editing-cordis-compositions,',
  '# "Migrate a legacy preset"). Generated by tools/gen-preset-bundle.mjs;',
  '# edit the legacy directory and re-run the generator rather than editing this file.',
  '#',
  '# Deployment-local rows (the preset-registry default and the disabled-bundle overlay)',
  '# live in cordis.local.patch.yml, and the multimodal subagent has no machine-local route.',
  '',
  ...declaration,
].join('\n')

/**
 * The site rows are machine-local, so they are published separately: the bundle
 * patch stays portable, and re-applying the overlay locally restores the
 * deployment default and the dsh-autoresume disable.
 */
const local = [
  '# Deployment-local overlay for the tri-agent agent preset. Generated by',
  '# tools/gen-preset-bundle.mjs; edit the legacy directory and re-run the generator',
  '# rather than editing this file. Git-ignored on purpose: it names this machine\'s',
  '# deployment default and its dsh-autoresume disable.',
  '',
  '# Deployment default: the registry row is inserted by @deepseek-ai/dsh-web-app with',
  '# `default: standard`; this layer replaces the whole config, so only the default changes.',
  '- id: agent-preset-registry',
  '  config:',
  '    default: tri-agent',
  '',
  '# dsh-autoresume@0.1.3 calls ctx.sessionPersistence.inspect(...), which 0.1.7-rc.2 does',
  '# not provide (SessionPersistence exposes create/open/flush/stat/list only), so it fails',
  '# on every session and its feature is unusable. No compatible release exists upstream, so',
  '# the bundle is disabled rather than removed: the dependency stays installed and this row',
  '# can be dropped to re-enable it after an upstream fix.',
  '- id: dsh-autoresume',
  '  disabled: true',
  '',
].join('\n')

writeFileSync(join(OUT, 'cordis.patch.yml'), document, 'utf8')
writeFileSync(join(OUT, 'cordis.local.patch.yml'), local, 'utf8')

process.stdout.write(
  `wrote cordis.patch.yml + cordis.local.patch.yml: name-rewrites=${substitutions.name} ` +
    `persona-rewrites=${substitutions.persona.length} agent-options-strips=${substitutions.agentOptions} order=${ORDER}\n`,
)
