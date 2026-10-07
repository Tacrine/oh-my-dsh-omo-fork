# oh-my-dsh-omo-fork

**OMO**（oh-my-dsh）的 fork，面向 [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) 打包：把 **tri-agent** agent preset 做成可发布的 Cordis bundle。

这个 preset 给 agent 一套「双身份 + 完整编码工具链」：

- **Atlas** —— 常驻的指挥者。它不亲自实现、验证或审查；它只读计划、notepad 与证据，做簿记（勾选计划 checkbox、追加 notepad），把每一个工作单元委派给具名子代理。
- **Prometheus** —— 规划 doctrine。当会话进入 plan 模式（`/plan`）时，身份在整个规划会话期间切换为 Prometheus，结束后切回。单个插件 `plan-aware-persona.mjs` 占用唯一的 `deployment:persona-prefix` 槽位，通过读取公开的 `plan` session projection 在每次装配时选择文本。`planMode` service 被刻意**不**注入：它位于 `isolate: { planMode: true }` realm 内部，从外部注入永远不会解析成功。

在身份之外，preset 挂载了编码工具链：文件系统与 shell 工具、后台任务、skills、goals、plan mode、compaction、委派与 workflows，以及其余面向模型的 row —— 共 18 条 declaration row，其中包含 9 条锚定的子代理 row（explore、librarian、oracle、momus、multimodal-looker、sisyphus-junior、metis、hephaestus、sisyphus）。本包附带 **11 个 persona 文件**；插件自身读取 `atlas.md` 与 `prometheus.md`，另外 9 个锚定在子代理 row 上。

## 包内容

| 文件 | 用途 |
| --- | --- |
| `cordis.patch.yml` | 已发布的 bundle patch：preset 声明及其 `plugins:` 列表。 |
| `plan-aware-persona.mjs` | 包入口：注册 plan-aware persona 前缀与配置的 suffix。 |
| `personas/` | 11 个 persona 文件，与原始文件逐字节一致。 |
| `tools/gen-preset-bundle.mjs` | 从 legacy preset 目录重新生成 `cordis.patch.yml`。 |
| `tools/verify-preset-bundle.mjs` | 把已发布 patch 与 legacy entry list 做结构化比对。 |

patch 挂载以下 peer 包，由 DSH 提供：

`@deepseek-ai/dsh-agent-preset`、`dsh-agent-instructions`、`dsh-tool-bash`、`dsh-tool-pwsh`、`dsh-tool-fs`、`dsh-tool-fs-search`、`dsh-tool-jobs`、`dsh-skill-filesystem`、`dsh-tool-skill`、`dsh-command-goal`、`dsh-tool-goal`、`dsh-plan-mode`、`dsh-compaction-basic`、`dsh-command-compact`、`dsh-compaction-tool-result-pruner`、`dsh-tool-subagent-control`、`dsh-tool-subagent`、`dsh-workflow-ptc`、`dsh-tool-workflow`、`dsh-tool-ralph`、`dsh-tool-ask-user`、`dsh-tool-todo`、`dsh-tool-web`、`dsh-tool-present`，以及 `@deepseek-ai/cordis`。

## 安装

安装是**两个明确的步骤**。第 1 步装依赖，第 2 步告诉 profile 去加载它。两步都必需，且**不假设 `dsh` 已在 `PATH` 上**。

### 第 1 步 —— 把包装进 profile

把 CLI 指向你的 DSH checkout 的 bin 文件，并把安装转发给 profile：

```powershell
node "<dsh bin>" plugin --profile <profile> add -w @tacrine_f/oh-my-dsh-omo-fork
```

例如，若运行时是 `<dsh runtime>`，则 `<dsh bin>` 为
`<dsh runtime>\@deepseek-ai\dsh\lib\bin.js`：

```powershell
node "<dsh runtime>\@deepseek-ai\dsh\lib\bin.js" plugin --profile web add -w @tacrine_f/oh-my-dsh-omo-fork
```

该命令在 `$DSH_HOME\profiles\<profile>\` 内运行 pnpm，因此它会写入一条 `dependencies`。**它不会改动 `dsh.profile.bundles`。**

### 第 2 步 —— 把包加入 `dsh.profile.bundles` 并重启

打开 `$DSH_HOME\profiles\<profile>\package.json`，把包名加入该 profile 的 `dsh.profile.bundles` 数组：

```jsonc
{
  "dsh": {
    "profile": {
      "bundles": [
        // ...你已有的 bundles...
        "@tacrine_f/oh-my-dsh-omo-fork"
      ]
    }
  }
}
```

然后**重启 Host 并新建一个会话**。运行中的 agent 会保持它启动时的 composition，因此已经开着的会话不会自动加载这个 preset —— 必须新建会话。

> 仓库内的 skill `editing-cordis-compositions` 对 *workspace* bundle 规定使用 `plugin_manager install_bundle`。该动作不适用于第三方 npm 包，所以这里记录的路径是「profile 依赖 + 显式 bundles 条目」。

### 验证安装后的 composition

```powershell
$env:DSH_HOME = "<dsh home>"
node "<dsh bin>" --profile <profile> --dump-config
```

输出中应出现一条 `preset-tri-agent` row，其 `name` 为 `@tacrine_f/oh-my-dsh-omo-fork`，并且有九条经由该包解析的 `personas` 表达式。

## 安装后你可能需要自己做的改动

已发布的 patch **只**包含可移植的 preset 声明。这个 fork 来源机器上的两项本地配置被刻意**不**发布，你可能想自行补回：

1. **把 tri-agent 设为默认 preset。** 已发布的 patch **不**设置任何默认 preset —— 本包从不强制默认值。如果你希望 tri-agent 成为默认，请在你自己的 profile 或 overlay patch 中设置该 registry row：

   ```yaml
   - id: agent-preset-registry
     config:
       default: tri-agent
   ```

   （`@deepseek-ai/dsh-web-app` 插入该 row 时用的是 `default: standard`；上面的 row 会替换整个 config，因此只有 default 改变。）

2. **给 `subagent_multimodal_looker` 指定模型路由。** 该 fork 自己的机器专属路由被**刻意从已发布 patch 中移除** —— 它指向一个只存在于原机器的 provider。没有它时，multimodal 子代理继承 deployment 的路由。若要固定，请在你自己的 overlay 中为该 row 加上 `agentOptions` 块：

   ```yaml
   - id: tool-subagent-multimodal-looker
     name: '@deepseek-ai/dsh-tool-subagent'
     config:
       # ...已发布的 config...
       agentOptions:
         provider: <你的 provider>
         model: <你的 model>
   ```

本仓库中的 `cordis.local.patch.yml` 恰好保存了原机器的那两条 row。它**不发布、不提交、本地也不加载** —— 仅作为记录保留，这也是为什么上述改动必须由你自己完成。

## 失败模式：刻意 fail loud

`plan-aware-persona.mjs` 在 mount 时从磁盘读取 persona 文本。**persona 文件缺失或为空会导致 mount 失败**，并在错误中指明该文件：

```
plan-aware-persona: cannot read persona "file:///.../personas/atlas.md"
plan-aware-persona: persona "file:///.../personas/atlas.md" is empty
```

这是刻意设计。空的 persona 前缀会静默地剥掉 agent 的身份 —— 一个指明文件的 mount 错误，远比一个悄悄丢失指令的 agent 容易处理。

## Peer 模型

patch 挂载的每个 `@deepseek-ai/*` 包都声明为 **`peerDependency`**，绝不用普通 `dependency`。它们由 DSH 提供；bundle 不得安装自己的副本。peer 范围固定为 `>=0.1.7-rc.2 <0.2.0`（`@deepseek-ai/cordis` 为 `^4.0.1`）。

DSH profile 的 `.npmrc` 设置了 `auto-install-peers=false`，因此这些 peer **只是声明性的**：pnpm 不会去拉取它们，缺失的 peer 会在 mount 时以解析错误暴露，而不是被静默安装。

## 重新验证已发布的产物

`tools/verify-preset-bundle.mjs` 在只应用三项已记录 rewrite 之后，把已发布的 patch 与生成它的 legacy entry list 做结构化比对。它按 JSON path 报告每一处差异，并输出含 `verdict`、`rows`、`rewrites`、`differences`、`selfReference` 的 JSON 报告。

在仓库根目录运行：

```powershell
node "E:\Downloads\oh-my-dsh-omo-fork\tools\verify-preset-bundle.mjs" --runtime "<dsh runtime node_modules>" --legacy "<指向 legacy agent.cordis.yml 文件>" --patch "E:\Downloads\oh-my-dsh-omo-fork\cordis.patch.yml" --package @tacrine_f/oh-my-dsh-omo-fork
```

注意 `--legacy` 取的是**文件**（`agent.cordis.yml`），不是它所在的目录。

正常的运行会输出 `"verdict": "IDENTICAL"`、`"rows": 18`、`"rewrites": { "name": 1, "persona": 9, "agentOptions": 1 }` 与 `"differences": []`，并以 0 退出。

### 关于「无参数裸调用」的诚实说明

每个 flag 都有推导出的默认值，所以下面这条也能跑：

```powershell
$env:DSH_RUNTIME = "<dsh runtime node_modules>"
node "E:\Downloads\oh-my-dsh-omo-fork\tools\verify-preset-bundle.mjs"
```

**但裸调用并不保证在任何机器上都能工作。** 其中两个默认值依赖机器环境：

- `--runtime` 先取 `$DSH_RUNTIME`，否则取最新的、确实同时包含 `js-yaml` 与 `@deepseek-ai/cordis-plugin-include` 的 `$DSH_HOME\versions\*\node_modules`。如果你的 DSH home 下没有 `versions\` 目录 —— 当 DSH 由另一个 launcher checkout 运行时很常见 —— **裸调用无法解析 runtime**，会以非零退出并给出指明 `--runtime` 的消息。这两个模块都无法从任意 checkout 目录解析。
- `--package` 从本仓库的 `package.json` 推导，不是机器专属默认值。

因此：依赖裸调用之前，请把 `DSH_RUNTIME` 设为 runtime 的 `node_modules`（或直接传 `--runtime`）。**上面显式带 `--runtime` 的形式是推荐用法**，也是脚本与 CI 中应当使用的一种。

## 重新生成 patch

`cordis.patch.yml` 是生成产物 —— 不要手工编辑它。请修改 legacy preset 目录，然后：

```powershell
node tools/gen-preset-bundle.mjs --legacy "<legacy 目录>" --out . --package @tacrine_f/oh-my-dsh-omo-fork
```

`--legacy` 默认 `$HOME/.dsh/.agent-presets/tri-agent`，`--out` 默认仓库根目录，`--package` 默认本包名。生成器会打印三个计数器：

```
wrote cordis.patch.yml + cordis.local.patch.yml: name-rewrites=1 persona-rewrites=9 agent-options-strips=1 order=10
```

从 legacy entry list 变成 bundle patch 时应用的三项已记录 rewrite：

1. **包自引用** —— legacy 的相对插件名 `./plan-aware-persona.mjs` 被重新锚定到已安装的包上，因为 bundle patch 不是 include 文件，相对名会被按 *profile* 目录导入。
2. **九个 persona 路径锚点** —— 每个 `fileURLToPath(new URL('./personas/<file>', baseUrl))` 变成 `join(dirname(createRequire(baseUrl).resolve('<pkg>/package.json')), 'personas', '<file>')`，原因相同。
3. **移除 multimodal 的 `agentOptions` 块** —— 针对 `subagent_multimodal_looker` 的机器专属 `provider`/`model` 路由不随包发布。

## 血统

本包是 **OMO**（oh-my-dsh）的 fork，重新打包以便该 preset 可以从 npm 安装，而不是作为某个 profile 里的私有 `link:` 依赖存在。persona 文本、工具链 composition 与插件均来自上游设计；本 fork 的贡献是打包拆分 —— 一个不含机器本地 row 的可发布 patch、一个参数化生成器，以及一个能证明已发布 patch 仍与其生成来源一致的 verifier。

## 许可证

MIT —— 见 [LICENSE](./LICENSE)。
