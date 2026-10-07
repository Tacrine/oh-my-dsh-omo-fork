/**
 * Structurally compare the bundle's declared `plugins:` list with the legacy
 * `agent.cordis.yml`, after applying only the three intended rewrites
 * (self-reference, persona anchor, multimodal `agentOptions` strip).
 *
 * Reports every difference by JSON path, so a flattened `isolate` group, a lost
 * `disabled`, or a reordered row cannot pass unnoticed.
 *
 * This tool needs the runtime that parses these files: the entry-list dialect
 * (`!!js` scalars must arrive as `{__jsExpr}` nodes) comes from
 * `@deepseek-ai/cordis-plugin-include`, and YAML from `js-yaml`. Neither
 * resolves from an arbitrary checkout directory, so the runtime is a parameter
 * with a derived default — see `resolveRuntime` below.
 *
 * Every flag has a derived default, so the tool also runs bare:
 *
 *   node tools/verify-preset-bundle.mjs
 *
 * Usage:
 *   node tools/verify-preset-bundle.mjs [--legacy <agent.cordis.yml>] \
 *     [--patch <cordis.patch.yml>] [--dump <dump-config capture>] \
 *     [--package <name>] [--runtime <node_modules>]
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Parse `--flag value` pairs; unknown flags are a hard error. */
const parseArgs = (argv) => {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`)
    const name = token.slice(2)
    if (!['legacy', 'patch', 'dump', 'package', 'runtime'].includes(name)) {
      throw new Error(`unknown flag: ${token}`)
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${token} needs a value`)
    flags[name] = value
    index += 1
  }
  return flags
}

/**
 * The two modules this tool cannot work without. `@deepseek-ai/cordis-plugin-include`
 * supplies the entry-list dialect and `js-yaml` the parser; both must come from
 * the same runtime so `!!js` scalars arrive as `{__jsExpr}` nodes.
 */
const REQUIRED_MODULES = ['js-yaml', '@deepseek-ai/cordis-plugin-include']

const containsRequiredModules = (runtime) =>
  REQUIRED_MODULES.every((module) => existsSync(join(runtime, ...module.split('/'))))

/**
 * Resolve the runtime that provides the two required modules.
 *
 * `--runtime` wins, then `$DSH_RUNTIME`, then the newest
 * `<DSH_HOME>/versions/<version>/node_modules` that actually contains both
 * modules. There is no machine path in this file: the fallback root is derived
 * from `os.homedir()`.
 *
 * @param explicit - the `--runtime` value, when given.
 * @returns an absolute path to a `node_modules` directory.
 */
function resolveRuntime(explicit) {
  const candidates = []
  if (explicit !== undefined) candidates.push(explicit)
  if (process.env.DSH_RUNTIME !== undefined && process.env.DSH_RUNTIME !== '') {
    candidates.push(process.env.DSH_RUNTIME)
  }
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const versionsDir = join(home, 'versions')
  if (existsSync(versionsDir)) {
    // Newest first: a version directory name sorts lexicographically for the
    // `0.1.7-rc.2` style DSH uses, so a plain descending sort is enough here.
    const versions = readdirSync(versionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse()
    for (const version of versions) candidates.push(join(versionsDir, version, 'node_modules'))
  }

  for (const candidate of candidates) {
    if (containsRequiredModules(candidate)) return candidate
  }

  throw new Error(
    'cannot resolve the runtime for this tool: pass --runtime <path to node_modules> ' +
      `(it must contain ${REQUIRED_MODULES.join(' and ')}). Tried: ${candidates.join(', ') || '(no candidates)'}. ` +
      'Set $DSH_RUNTIME to reuse a runtime without repeating the flag.',
  )
}

/**
 * Load the two runtime modules, failing loud and flag-named when unavailable.
 * @param runtime - the resolved `node_modules` directory.
 */
async function loadRuntimeModules(runtime) {
  let yaml
  let entryListSchema
  try {
    yaml = (await import(`file:///${runtime}/js-yaml/dist/js-yaml.mjs`)).default
    ;({ entryListSchema } = await import(`file:///${runtime}/@deepseek-ai/cordis-plugin-include/lib/index.js`))
  } catch (cause) {
    throw new Error(
      `cannot import js-yaml / @deepseek-ai/cordis-plugin-include from ${runtime}: ${cause.message}. ` +
        'Pass --runtime <path to node_modules> that contains both modules.',
    )
  }
  return { yaml, entryListSchema }
}

/**
 * The package name defaults to the sibling `package.json`, so a bare run needs
 * no flag once the repo is a real package.
 *
 * Fallback: before the manifest exists the name is read from the patch's own
 * self-reference row, which carries it exactly once. Without this a bare run
 * would fail on a repo whose `package.json` has not been authored yet, even
 * though the flag it needs is derivable from a file it is already reading.
 *
 * @param patchText - the patch source, used only by the fallback.
 */
function defaultPackage(patchText) {
  const manifest = join(import.meta.dirname, '..', 'package.json')
  try {
    const name = JSON.parse(readFileSync(manifest, 'utf8')).name
    if (typeof name === 'string' && name !== '') return name
  } catch {
    // No usable manifest yet; fall through to the patch.
  }
  // The self-reference row is the only `name:` row that does not sit in the DSH
  // plugin scope — every other row names a `@deepseek-ai/...` plugin under a
  // `- id:`/`name:` pair. Indentation cannot separate them: the self-reference
  // row shares its indent with the plugin rows.
  const rows = patchText
    .split(/\r?\n/)
    .filter((line) => /^[ \t]*name:[ \t]*'@[^']+'[ \t]*$/.test(line))
    .map((line) => /^[ \t]*name:[ \t]*'([^']+)'[ \t]*$/.exec(line)[1])
    .filter((name) => !name.startsWith('@deepseek-ai/'))
  const selfReferences = [...new Set(rows)]
  if (selfReferences.length === 1) return selfReferences[0]
  throw new Error(
    `cannot derive --package: no readable "name" in ${manifest} and the patch does not carry exactly one ` +
      `non-plugin self-reference name row (found ${selfReferences.length}). Pass --package <name> explicitly.`,
  )
}

async function main() {
  const flags = parseArgs(process.argv.slice(2))

  const RUNTIME = resolveRuntime(flags.runtime)
  const LEGACY = flags.legacy ?? join(homedir(), '.dsh', '.agent-presets', 'tri-agent', 'agent.cordis.yml')
  const PATCH = flags.patch ?? join(import.meta.dirname, '..', 'cordis.patch.yml')
  const DUMP = flags.dump

  const { yaml, entryListSchema } = await loadRuntimeModules(RUNTIME)

  /**
   * Drop the whole `agentOptions:` key plus its more-indented children from a
   * legacy YAML text, counting the strips. Line-based on purpose: a greedy regex
   * also swallows the adjacent sibling keys (`persona:`, `toolFilter:`).
   *
   * @param text - the legacy entry-list source.
   * @returns the stripped text and how many `agentOptions:` keys were removed.
   */
  function stripAgentOptions(text) {
    const lines = text.split('\n')
    const kept = []
    let keyIndent = null
    let count = 0
    for (const line of lines) {
      if (keyIndent !== null) {
        const indent = /^[ \t]*/.exec(line)[0]
        if (line.trim() === '' || indent.length > keyIndent) continue
        keyIndent = null
      }
      const keyMatch = /^([ \t]*)agentOptions:(?!\S)[ \t]*$/.exec(line)
      if (keyMatch !== null) {
        keyIndent = keyMatch[1].length
        count += 1
        continue
      }
      kept.push(line)
    }
    return { text: kept.join('\n'), count }
  }

  const legacyText = readFileSync(LEGACY, 'utf8')
  const patchText = readFileSync(PATCH, 'utf8')

  const PACKAGE = flags.package ?? defaultPackage(patchText)

  const stripped = stripAgentOptions(legacyText)
  const legacy = yaml.load(stripped.text, { schema: entryListSchema })
  const patch = yaml.load(patchText, { schema: entryListSchema })

  /**
   * Read a `--dump-config` capture as its YAML document alone.
   * @param path - the capture written by the shell.
   * @returns the document text, with any leading `dsh:` diagnostics removed.
   */
  function readDumpDocument(path) {
    const lines = readFileSync(path, 'utf8').split(/\r?\n/)
    const start = lines.findIndex((line) => line.startsWith('# ==') || line.startsWith('- id:'))
    if (start < 0) throw new Error(`no YAML document found in ${path}`)
    return lines.slice(start).join('\n')
  }

  /**
   * The declaration under test: the bundle's own patch, or — when a dump path is
   * passed — the row `dsh --profile web --dump-config` actually composed. The dump
   * stream also carries `dsh:` patch warnings ahead of the document, so the text is
   * trimmed to its first YAML line before parsing.
   */
  const composed = DUMP === undefined
    ? undefined
    : yaml.load(readDumpDocument(DUMP), { schema: entryListSchema })?.find(
        (entry) => entry.id === 'preset-tri-agent',
      )

  const declaration = composed ?? patch.find((entry) => entry.insert !== undefined)?.insert?.[0]
  if (declaration === undefined) throw new Error('no declaration row found')
  if (declaration.id !== 'preset-tri-agent') throw new Error(`unexpected declaration row id ${declaration.id}`)
  if (declaration.name !== '@deepseek-ai/dsh-agent-preset') throw new Error(`unexpected declaration plugin ${declaration.name}`)

  /** Expected legacy-to-bundle rewrites, applied to a deep clone of the legacy list. */
  const expected = structuredClone(legacy)
  const seen = { name: 0, persona: 0, agentOptions: stripped.count }

  /**
   * Walk one node, applying the intended substitutions and counting them.
   * @param node - the value to rewrite in place.
   */
  function rewrite(node) {
    if (Array.isArray(node)) return node.forEach(rewrite)
    if (node === null || typeof node !== 'object') return
    if (node.name === './plan-aware-persona.mjs') {
      node.name = PACKAGE
      seen.name += 1
    }
    if (typeof node.__jsExpr === 'string') {
      const before = node.__jsExpr
      node.__jsExpr = before.replace(
        /process\.getBuiltinModule\('node:url'\)\.fileURLToPath\(new URL\('\.\/personas\/([^']+)', baseUrl\)\)/g,
        (_match, file) => {
          seen.persona += 1
          return `process.getBuiltinModule('node:path').join(process.getBuiltinModule('node:path').dirname(process.getBuiltinModule('node:module').createRequire(baseUrl).resolve('${PACKAGE}/package.json')), 'personas', '${file}')`
        },
      )
      if (node.__jsExpr !== before) return
    }
    for (const value of Object.values(node)) rewrite(value)
  }

  rewrite(expected)

  /** Collect every structural difference between two values. */
  function diff(left, right, path = '$') {
    const out = []
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right)) return [`${path}: array/非-array 不一致`]
      if (left.length !== right.length) out.push(`${path}: length ${left.length} != ${right.length}`)
      for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
        out.push(...diff(left[index], right[index], `${path}[${index}]`))
      }
      return out
    }
    if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)])
      for (const key of keys) {
        if (!Object.hasOwn(left, key)) out.push(`${path}.${key}: missing in legacy`)
        else if (!Object.hasOwn(right, key)) out.push(`${path}.${key}: missing in bundle`)
        else out.push(...diff(left[key], right[key], `${path}.${key}`))
      }
      return out
    }
    if (left !== right) out.push(`${path}: ${JSON.stringify(left)} != ${JSON.stringify(right)}`)
    return out
  }

  const differences = diff(expected, declaration.config.plugins)

  /**
   * The published patch must carry the new package name in exactly one `name:`
   * row — the self-reference row the persona plugin mounts by.
   */
  const selfReferenceRows = patchText
    .split(/\r?\n/)
    .filter((line) => line.trim() === `name: '${PACKAGE}'`)
    .length

  if (selfReferenceRows !== 1) {
    throw new Error(`expected exactly one self-reference row "name: '${PACKAGE}'", found ${selfReferenceRows}`)
  }
  if (seen.name !== 1) throw new Error(`expected exactly one ./plan-aware-persona.mjs row, rewrote ${seen.name}`)
  if (seen.persona !== 9) throw new Error(`expected 9 persona paths, rewrote ${seen.persona}`)
  if (seen.agentOptions !== 1) throw new Error(`expected exactly one multimodal agentOptions block, stripped ${seen.agentOptions}`)

  /** The old local package name must not survive anywhere in the published patch. */
  const localRows = patchText.split(/\r?\n/).filter((line) => line.includes('@local/'))
  if (localRows.length !== 0) {
    throw new Error(`the published patch still carries ${localRows.length} "@local/" occurrence(s): ${localRows.join(' | ')}`)
  }

  const groups = declaration.config.plugins.filter((row) => row.group === true)
  const isolated = groups.map((row) => ({ id: row.id, isolate: row.isolate, children: row.config.length }))
  const rows = declaration.config.plugins.length

  process.stdout.write(
    JSON.stringify(
      {
        runtime: RUNTIME,
        legacy: LEGACY,
        patch: PATCH,
        package: PACKAGE,
        declaration: {
          loaderRowId: declaration.id,
          plugin: declaration.name,
          id: declaration.config.id,
          name: declaration.config.name,
          order: declaration.config.order,
          descriptionChars: declaration.config.description.length,
        },
        rows,
        rewrites: seen,
        selfReference: PACKAGE,
        isolatedGroups: isolated,
        disabledRows: declaration.config.plugins.filter((row) => row.disabled !== undefined).map((row) => row.id),
        differences,
        verdict: differences.length === 0 ? 'IDENTICAL' : 'DIFFERS',
      },
      null,
      2,
    ) + '\n',
  )

  if (differences.length !== 0) process.exitCode = 1
}

try {
  await main()
} catch (error) {
  // Fail loud but clean: the message names the flag or file at fault, and a raw
  // stack trace would only bury it.
  process.stderr.write(`verify-preset-bundle: ${error.message}\n`)
  process.exitCode = 1
}
