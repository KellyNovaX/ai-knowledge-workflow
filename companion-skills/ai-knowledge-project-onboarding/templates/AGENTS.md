# {{PROJECT_NAME}}

[index](index.md) | [AGENTS](AGENTS.md) | [architecture](architecture.md) | [modules](modules.md) | [links](links.md) | [env](env.md) | [runbook](runbook.md) | [database](database.md)

#project/{{PROJECT_NAME}} {{TAGS}}

{{ONE_LINE_SUMMARY}}

## AI 进入项目规则

- 本目录只维护稳定项目知识，不记录一次性任务过程。
- 开发前先从任务或 workflow 入口进入，再按需读取本目录资料。
- 默认只读本文件和 [links](links.md)，其余资料按任务需要读取。
- 源码仓库不是知识库目录，源码位置见 [links](links.md)；实际开发分支以任务入口为准，执行前核对源码仓库。
- 环境和外部依赖见 [env](env.md)，操作步骤见 [runbook](runbook.md)，表结构见 [database](database.md)。
- 目标分支或目标环境未确认时，只做只读分析。

## 核心功能

- {{FEATURE}}

## 核心模块

| 模块 | 职责 | 启动入口 | 独立部署 |
|---|---|---|---|
| {{MODULE}} | {{RESPONSIBILITY}} | {{MAIN_CLASS}} | {{YES_NO}} |

完整技术栈见 [architecture](architecture.md)，详细模块结构见 [modules](modules.md)。本入口控制在 1–3KB，构建和启动命令写入 [runbook](runbook.md)。

## 关键约束

- {{CONSTRAINT}}
