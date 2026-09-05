# 架构说明

[index](index.md) | [AGENTS](AGENTS.md) | [architecture](architecture.md) | [modules](modules.md) | [links](links.md) | [env](env.md) | [runbook](runbook.md) | [database](database.md)

#project/{{PROJECT_NAME}} #architecture {{TAGS}}

## 分层结构

```text
{{LAYERED_ARCHITECTURE}}
```

## 模块关系

```mermaid
flowchart LR
  {{MERMAID_MODULE_RELATION}}
```

## 核心流程

```mermaid
sequenceDiagram
  {{MERMAID_CORE_FLOW}}
```

## 服务依赖

| 依赖 | 用途 | 主要模块 |
|---|---|---|
| {{DEPENDENCY}} | {{PURPOSE}} | {{MODULES}} |

## 数据流描述

{{DATA_FLOW_SUMMARY}}
