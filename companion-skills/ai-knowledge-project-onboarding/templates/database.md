# 数据库说明

[index](index.md) | [AGENTS](AGENTS.md) | [architecture](architecture.md) | [modules](modules.md) | [links](links.md) | [env](env.md) | [runbook](runbook.md) | [database](database.md)

#project/{{PROJECT_NAME}} #database {{TAGS}}

## 使用原则

- 查询和导出优先使用只读连接。
- 写操作先确认环境、影响范围、事务和回滚方案。
- 连接配置见 [env](env.md)，执行步骤见 [runbook](runbook.md)。

## 表结构来源

| 来源 | 内容 |
|---|---|
| `{{SQL_PATH}}` | {{SQL_DESC}} |

## 核心表索引

| 表 | 业务域 | 用途 | 常用字段 |
|---|---|---|---|
| `{{TABLE}}` | {{DOMAIN}} | {{PURPOSE}} | `{{FIELDS}}` |

## 表关系

{{RELATION_SUMMARY}}

## 常用导出场景

| 场景 | 主表 | 关联表 | 过滤条件 |
|---|---|---|---|
| {{SCENARIO}} | `{{MAIN_TABLE}}` | `{{RELATED_TABLE}}` | {{FILTER}} |

