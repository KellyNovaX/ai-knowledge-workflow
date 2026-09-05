# 发布指南

独立源码仓库：[KellyNovaX/ai-knowledge-workflow](https://github.com/KellyNovaX/ai-knowledge-workflow)。当前材料用于首次发布；社区目录上架状态以官方页面为准。

## 1. 独立源码仓库

使用此源码目录创建公开 GitHub 仓库，建议仓库名 `ai-knowledge-workflow`。不要上传任何个人知识库、`data.json`、`node_modules` 或旧知识库 Git 历史。源码必须包含根目录 README、LICENSE、manifest、构建配置和依赖锁文件。

## 2. 发布文件

```sh
npm ci
npm run package
```

创建 GitHub Release，标签必须为 `0.3.1`，与 manifest 版本完全一致，不加 `v`。把 `dist/main.js`、`dist/manifest.json`、`dist/styles.css` 分别作为附件上传；不要只上传 ZIP。可同时附上两个 ZIP 与 SHA256SUMS.txt，方便手动安装和分享。

更新版本时同步 manifest、package.json、package-lock.json、versions.json 和 CHANGELOG，然后重新构建。不要替换已经发布标签下的文件掩盖版本变化。

## 3. 社区目录

在 [Obsidian Community](https://community.obsidian.md) 登录 Obsidian 账号，关联 GitHub，创建插件条目并填写独立仓库地址。检查声明，确认开发者政策和维护责任后提交。按自动审核结果修正，必要时递增版本再发布。

当前官方流程使用社区目录，不再按旧文章创建 community-plugins.json 的提交。只有审核通过并发布后，用户才能在 Obsidian 内搜索安装。

## 提交前仍需人工完成

- 在真实 Obsidian 空库启用插件，检查看板/创建任务/完成与重开。
- macOS 外部应用集成按需验收；Windows/Linux 尚未实机验证。
- 确认公开仓库归属、介绍、GitHub Release 附件和 README 中的上架状态。
- 使用自己的 Obsidian 账号确认开发者政策和维护承诺。

## 官方依据

- [提交插件](https://docs.obsidian.md/plugins/releasing/submit-plugin)
- [开发者政策](https://docs.obsidian.md/community-directory/developer-policies)
- [插件提交要求](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)

核对日期：2026-09-05。
