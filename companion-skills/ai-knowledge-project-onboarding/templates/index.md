# {{PROJECT_NAME}}

#project/{{PROJECT_NAME}} {{TAGS}}

{{ONE_LINE_SUMMARY}}

## 快速入口

| 入口 | 用途 |
|---|---|
| [AGENTS](AGENTS.md) | 项目全貌、约束和 AI 阅读规则 |
| [architecture](architecture.md) | 架构、核心流程和依赖关系 |
| [modules](modules.md) | 模块职责和代码位置 |
| [links](links.md) | 源码、分支和文档入口 |
| [env](env.md) | 环境、外部依赖和本地配置说明 |
| [runbook](runbook.md) | 构建、运行、验证和排查步骤 |
| [database](database.md) | 表结构、关系和常用查询场景 |

## 推荐阅读路径

| 场景 | 阅读顺序 |
|---|---|
| 新接手项目 | [AGENTS](AGENTS.md) → [architecture](architecture.md) → [modules](modules.md) |
| 修改功能 | [modules](modules.md) → [links](links.md) → 相关源码 |
| 环境排查 | [env](env.md) → [runbook](runbook.md) |
| 数据问题 | [database](database.md) → [env](env.md) → [runbook](runbook.md) |

## 开发入口规则

- 项目资料只作为稳定上下文；实际开发从任务或 workflow 入口进入。
- 分支、环境和影响范围未确认前，不执行写操作。

