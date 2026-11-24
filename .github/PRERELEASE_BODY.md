<!-- 预发布 Release 正文的占位说明：rc / alpha 的正文不归档到 docs/releases，发布后由 gh release edit 补上。
     release workflow 把下面安装命令里的尖括号占位符替换成本版后，直接用它建 prerelease。
     Pre-release body placeholder: rc / alpha notes are not archived in docs/releases; the
     publisher fills the page in afterwards with `gh release edit`. The release workflow
     substitutes the version placeholders and uses this file verbatim. -->

## 预发布

本版为预发布，只用于自测与隔离 profile 验证；完整变更记录由发布者随后补入本页。

附件即编译好的完整安装包（含 client 构建产物）。**在 dsh 的插件安装里直接粘贴下面的下载地址**，或用命令安装同一附件：

```bash
dsh plugin --profile web add https://github.com/xbzbing/dsh-auth-gateway/releases/download/<TAG>/dsh-auth-gateway-<VERSION>.tgz
```

---

## Pre-release

A pre-release for self-testing and isolated-profile verification only; its full change log is filled in on this page after publishing.

The attached asset is the complete, pre-built package (client bundle included). **Paste the download URL below straight into dsh's plugin install**, or install the same asset from the command line:

```bash
dsh plugin --profile web add https://github.com/xbzbing/dsh-auth-gateway/releases/download/<TAG>/dsh-auth-gateway-<VERSION>.tgz
```
