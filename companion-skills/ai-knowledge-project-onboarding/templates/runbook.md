# 操作手册

[index](index.md) | [AGENTS](AGENTS.md) | [architecture](architecture.md) | [modules](modules.md) | [links](links.md) | [env](env.md) | [runbook](runbook.md) | [database](database.md)

#project/{{PROJECT_NAME}} #runbook {{TAGS}}

## 构建

```bash
{{BUILD_COMMAND}}
```

## 运行

```bash
{{START_COMMAND}}
```

## 验证

```bash
{{VERIFY_COMMAND}}
```

## 排查

1. 确认目标环境、时间范围和请求标识。
2. 从 [env](env.md) 获取日志或监控入口。
3. 先做只读检查，记录证据后再决定是否修改。

## 回滚

- {{ROLLBACK_STEPS}}

