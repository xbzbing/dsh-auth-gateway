# Release notes template / 发版正文模板

本文件是**正式版** GitHub Release 正文的**唯一格式来源**。发版时照抄下面的骨架填写，不要再去翻历史 release 反推格式。正文**必须中英双语**：中文段在前，`---` 分隔，英文段在后；两段内容一一对应，不是摘要。

This file is the single source of format for **stable** GitHub Release bodies. Copy the skeleton below; do not reverse-engineer the format from historical releases. The body must be bilingual: Chinese first, `---`, then English — the two halves mirror each other.

- Release 标题 = tag 名 = `v<package.json version>`；tag 必须与 manifest 的 version 一致。
- 两段都以 compare 链接收尾：`https://github.com/xbzbing/dsh-auth-gateway/compare/<PREV>...<TAG>`，`<PREV>` 是上一个**正式版** tag，跳过中间的 rc / alpha（`v0.9.0` 配 `v0.8.7`，不是配 `v0.9.0-rc.1`）——完整变更记录必须覆盖「上一次稳定版之后」的全部内容。
- 不要保留 GitHub 自动生成的 `## What's Changed` 段落，它和这里的结构冲突；workflow 也不用 `--generate-notes`。
- **归档只收正式版**：`docs/releases/` 只存正式版正文，rc / alpha 不写、也不留存正文文件。预发布的 Release 页面由 `.github/PRERELEASE_BODY.md` 的固定说明生成，发布后用 `gh release edit --notes-file <本地文件>` 补正文（本地文件放 `docs/local/`，已 gitignore），重跑 workflow 不会覆盖它。
- **本仓库的 workflow 不发 npm**：Release 与 tgz 附件由 workflow 自动完成；若本版要让 npm 安装行可用，先手动 `npm publish --access public`，再推 version bump（见下方发布流程）。

## 写作规则

**主要变更**

- 一条一个用户可感知的结果，标题加粗，冒号后写「现在是什么样 / 为什么值得升级」，不是实现流水账。
- 末尾用 `（#N）` 关联 issue 或 PR；没有关联就不写。
- 顺序：面向用户的能力与修复在前，`**内部**` 类的约定 / 门禁 / 重构放最后一条。
- 不要写：版本号变更、client 产物重建、纯格式调整、仅测试内部改名且不改变任何保证的改动。

**验证**

- 写**当次** `npm run check` 的真实输出：单测数与产物一致性结果。数字不得沿用上一版。
- 再写 1–3 条最有判别力的回归：修了什么、哪条测试会在去掉修复后转红。
- 没有新验证内容时，宁可只留 `npm run check` 一行，也不要编。

**安装**

- 附件一条必给（workflow 随 Release 自动附上，钉到本版具体版本，不写 latest）。
- npm 一条（`dsh-auth-gateway@<VERSION>`，不带 `@latest`）只在本版**已手动发布**后保留；未发布就删掉该行，不要留一个装不上的命令。
- URL 里的 tag 用本版真实 tag；命令必须带 `--profile <profile>`，示例统一用 `web`。
- 预发布不发 npm：它的正文是 `.github/PRERELEASE_BODY.md` 里的固定说明，只给附件一条。

**篇幅**

| 版本类型 | 中文条目数 |
| --- | --- |
| patch（修 bug / 文档） | 1–4 |
| minor（新能力） | 5–10 |
| major | 按需分组，每组一个小标题 |

## 骨架

<!-- 从下一行开始复制到 release 正文 -->

## 主要变更

- **<用户可感知的标题>**：<现在是什么样、为什么值得升级>（#<issue 或 PR>）
- **<标题>**：<说明>
- **修复**：<修掉的现象与影响面>（#<N>）
- **内部**：<约定 / 门禁 / 结构性改动>

## 安装

```bash
# 同一版本的 GitHub Release 附件（含编译好的 client 产物）
dsh plugin --profile web add https://github.com/xbzbing/dsh-auth-gateway/releases/download/<TAG>/dsh-auth-gateway-<VERSION>.tgz

# npm（仅当本版已手动发布 npm 时保留本行）
dsh plugin --profile web add dsh-auth-gateway@<VERSION>
```

## 验证

- `npm run check` 全绿：语法 + 类型检查 + <N> 单测；`npm run build:check` 产物一致
- <关键回归：修了什么；去掉该修复后哪条测试转红>

[完整变更记录 <PREV>...<TAG>](https://github.com/xbzbing/dsh-auth-gateway/compare/<PREV>...<TAG>)

---

## English

- **<Title>**: <what it does now and why it is worth upgrading> (#<issue or PR>)
- **<Title>**: <description>
- **Fixes**: <the symptom and its blast radius> (#<N>)
- **Internal**: <conventions / gates / structural changes>

## Install

```bash
# The same version as a GitHub Release asset (client bundle pre-built)
dsh plugin --profile web add https://github.com/xbzbing/dsh-auth-gateway/releases/download/<TAG>/dsh-auth-gateway-<VERSION>.tgz

# npm (keep this line only when this version was published to npm manually)
dsh plugin --profile web add dsh-auth-gateway@<VERSION>
```

## Verification

- `npm run check` green: syntax + typecheck + <N> unit tests; `npm run build:check` artifact consistency
- <key regression: what was fixed and which test turns red without it>

[Full changelog <PREV>...<TAG>](https://github.com/xbzbing/dsh-auth-gateway/compare/<PREV>...<TAG>)

<!-- 复制到上一行结束 -->

## 填写素材

```bash
# 上一个正式版 tag 到 HEAD 的提交（合并提交已排除，release 里不列）
PREV=$(git tag --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
git log --oneline --no-merges "$PREV"..HEAD

# 上一个正式版 tag（compare 链接的 <PREV> 也用它）
echo "$PREV"

# 当次门禁的真实数字
npm run check
```

## 发布流程

发布由 `.github/workflows/release.yml` 在「version bump 合入 main」（package.json 变更）时执行。正式版正文**随发版提交一起入库**；预发布没有正文文件，Release 页面由 workflow 用固定说明生成：

```bash
# 1. 版本号：npm version 同步 package.json 与 package-lock.json（根 + packages[""]）
#    预发布用带 - 的版本（0.9.0-rc.1）：只发 GitHub，不写正文
#    正式版用纯 semver（0.9.0）：照上面的骨架写正文 docs/releases/v<v>.md
npm version <v> --no-git-tag-version

# 2. （可选，仅正式版）npm 仍为手动发布：workflow 不发 npm。
#    要让安装说明里的 npm 行可用，先发 npm，再推 version bump。
npm publish --access public

# 3. 正式版正文（预发布跳过这步）：和代码一起提交、一起 review
$EDITOR docs/releases/v<v>.md
git add package.json package-lock.json docs/releases/v<v>.md && git commit -m "chore: release <v>"
git push origin main
```

合入 main 后 workflow 自动完成：门禁（`npm ci` + `npm run check` + `npm run build:check` + `npm pack` + `scripts/assert-pack.mjs`）→ 打 tag → GitHub Release（附 tgz；预发布带 `--prerelease`，正文先用 `.github/PRERELEASE_BODY.md` 的固定说明）。不要手工在 main 上打 tag。

workflow 在动手之前先校验：正式版的 `docs/releases/v<v>.md` 必须存在、门禁必须全绿；任何一条不满足就停在发布之前。远端已有 tag、已有 Release 时相应步骤自动跳过（Release 改为更新正文并补传附件），所以失败后可以直接重跑：

```bash
gh workflow run release.yml
```

手工在网页上改正文而不改文件，下次重跑会被文件内容覆盖——正式版来自 `docs/releases/v<v>.md`，预发布来自 `.github/PRERELEASE_BODY.md`。
