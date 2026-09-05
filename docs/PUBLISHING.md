# 发布指南

独立源码仓库：[KellyNovaX/ai-knowledge-workflow](https://github.com/KellyNovaX/ai-knowledge-workflow)。源码仓库和社区条目已建立；后续版本继续从此仓库发布，社区页面及客户端收录状态分别核实。

## 1. 独立源码仓库

在独立源码仓库中开发并发布。不要上传任何个人知识库、`data.json`、`node_modules` 或旧知识库 Git 历史。源码必须包含根目录 README、LICENSE、manifest、构建配置和依赖锁文件。

## 2. 发布文件

```sh
npm ci
npm run package
```

创建 GitHub Release，本次标签必须为 `0.3.3`，与 manifest 版本完全一致，不加 `v`。把 `dist/main.js`、`dist/manifest.json`、`dist/styles.css` 分别作为附件上传；不要只上传 ZIP。可同时附上两个 ZIP 与 SHA256SUMS.txt，方便手动安装和分享。

更新版本时同步 manifest、package.json、package-lock.json、versions.json 和 CHANGELOG，然后重新构建。不要替换已经发布标签下的文件掩盖版本变化。

## 3. 社区目录

在 [Obsidian Community](https://community.obsidian.md) 登录 Obsidian 账号，关联 GitHub，创建插件条目并填写独立仓库地址。检查声明，确认开发者政策和维护责任后提交。按自动审核结果修正，必要时递增版本再发布。

当前官方流程使用社区目录，不再按旧文章创建 community-plugins.json 的提交。社区公开页面、版本扫描和客户端搜索收录可能不同步；发布后应分别核对，不要仅凭网页显示可安装就宣称客户端已能搜到。

## 每次发布仍需核对

- 在真实 Obsidian 空库启用插件，检查看板/创建任务/完成与重开。
- macOS 外部应用集成按需验收；Windows/Linux 尚未实机验证。
- 确认公开仓库归属、介绍、GitHub Release 附件和 README 中的上架状态。
- 使用自己的 Obsidian 账号核对最新版本扫描与开发者政策；新增能力应重新检查披露。
- 0.3.3 将固定技能资源随包提供；初始化确认后只创建缺失文件，保留已有文件，不下载或执行脚本。检查标准三文件安装和 Starter 均包含这套资源。

## 官方依据

- [提交插件](https://docs.obsidian.md/plugins/releasing/submit-plugin)
- [开发者政策](https://docs.obsidian.md/community-directory/developer-policies)
- [插件提交要求](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)

核对日期：2026-09-05。
