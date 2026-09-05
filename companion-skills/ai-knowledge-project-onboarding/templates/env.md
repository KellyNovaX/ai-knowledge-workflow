# 环境与外部依赖

[index](index.md) | [AGENTS](AGENTS.md) | [architecture](architecture.md) | [modules](modules.md) | [links](links.md) | [env](env.md) | [runbook](runbook.md) | [database](database.md)

#project/{{PROJECT_NAME}} #env {{TAGS}}

## 环境概览

| 环境 | 用途 | 访问方式 | 状态 |
|---|---|---|---|
| {{ENV_NAME}} | {{ENV_PURPOSE}} | {{ACCESS_METHOD}} | {{STATUS}} |

## 外部依赖

| 依赖 | 用途 | 配置来源 | 备注 |
|---|---|---|---|
| {{DEPENDENCY}} | {{PURPOSE}} | {{CONFIG_SOURCE}} | {{NOTES}} |

## 日志入口

| 环境 | 服务 | 日志位置或查询入口 | 备注 |
|---|---|---|---|
| {{ENV_NAME}} | {{SERVICE}} | {{LOG_ENTRY}} | {{NOTES}} |

## 数据库连接

| 环境 | 数据库 | 权限 | 配置来源 |
|---|---|---|---|
| {{ENV_NAME}} | {{DATABASE}} | {{PERMISSION}} | {{CONFIG_SOURCE}} |

共享模板不保存真实密码、Token 或内部主机；私有 Vault 是否记录敏感信息由仓库规则决定。

