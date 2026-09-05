# 从这里开始

这是 AI Knowledge Workflow 0.3.3 的空白知识库，没有示例任务或个人资料。

1. 在 Obsidian 中选择“打开本地仓库”，打开这个文件夹。
2. 到设置 → 第三方插件，启用 AI Knowledge Workflow。插件不会自动开启。
3. 插件设置保持 AI agent 为 Manual，Vault root 留空。
4. 打开命令面板，运行 AI Knowledge: Add general task，创建第一条待办。
5. 运行 AI Knowledge: Open todo board，查看和管理任务。

项目与工作流不是第一步必需的。准备好真实项目资料后，再建立项目任务。

Starter 已包含项目资料生成、任务管理和周报三个配套技能，与插件初始化提供的内容相同，共 17 个文件，位于 `.agents/skills/`。

旧知识库或缺少技能文件时，可运行 **AI Knowledge: Initialize vault structure**，查看预览并确认后补齐缺失文件；已有文件不会被覆盖或自动更新。初始化离线完成，不下载或执行脚本，不启动 AI，也不安装 Python、CLI 或修改全局助手配置。

技能是否被发现、加载和使用由 AI 助手决定。插件基本功能不需要 AI 或 Python；运行技能脚本需自行准备 Python 3，使用 AI 协作还需相应 CLI 和账号，外部服务可能收费。

完整使用、平台限制和隐私说明见插件目录中的 [README](.obsidian/plugins/ai-knowledge-workflow/README.md)。
