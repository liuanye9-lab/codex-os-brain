---
name: harness-discipline
description: 在豆包工作中复用 Codex Brain harness 的验收纪律——把"做完了"变成可执行验证，并在多 agent 拆分前先判断该不该拆。适用于：声称任务完成前的自检、需要机械证据而非口头结论、批量工作是否 fan out 的判断、内容治理产物的发布前门禁。不用于：替代宿主自身的权限控制，也不保证拦截（豆包无 hook 机制，本 Skill 为自觉级）。
metadata:
  version: "1.0.0"
---

# Harness 验收纪律（豆包侧）

## 先说清楚这个 Skill 的能力边界

**Codex 侧**：harness 通过 `SessionStart` / `PreToolUse` / `Stop` 三个 hook **机械强制**——
agent 想跳过验收，宿主层面就不允许结束。

**豆包侧（本 Skill）**：豆包工作**没有 hook 机制**，只有 skill。因此本 Skill 是**自觉级纪律**：
它提供同一套判据和同一个验证引擎，但**不能阻止**一个不读它的 agent 直接声称完成。

> 这是事实差异，不是实现缺陷。不要在豆包侧宣称"已强制拦截"——那是假的。
> 能诚实提供的是：**同一套验证命令 + 同一套判据**，让结论建立在机器证据上。

### 还有一条边界：只在"受管项目"里生效

即使在 Codex 侧，`PreToolUse` 的危险操作拦截**只在初始化过 harness 的项目内生效**
（实测：受管项目内 `rm -rf ~/Documents` → deny；未初始化的目录内 → 放行）。

所以在一个新目录开工时，**先初始化再干活**：

```bash
brain task create --task-id <id> --objective "<目标>" --criterion tests --json
```

没初始化就等于没有安全带，无论 Codex 还是豆包。

## 前置：引擎是否可用

```bash
command -v brain || echo "harness 未安装"
brain doctor --json
```

`brain` 不可用时，**不要静默降级成口头结论**。明确告诉用户引擎不可用，
以及因此哪些结论没有机器证据支撑。

---

## 用法一：声称完成前，先跑验收

**触发时机**：任何准备说"已完成 / 已修复 / 已通过"的时刻。

```bash
# 1. 开工时把验收标准写死（动手前，不是完工后）
brain task create --task-id <id> --objective "<目标>" --criterion tests --json

# 2. 声称完成前，由引擎重跑验收
brain verify --json
```

判读结果：

| verify 返回 | 含义 | 该怎么说 |
|---|---|---|
| `passed` | 验收器重跑通过 | 可以说完成，并附验收证据 |
| `partial` / `failed` | 有未通过项 | **不要说完成**，说清哪项没过 |
| `verifier_inputs_changed` | 验收输入被改动 | 这是改靶，回滚改动重跑 |

**关键**：`verifier_inputs_changed` 常常不是恶意的——比如任务本身就要改 `package.json`。
这时正确做法是在合同里**显式声明豁免**，而不是绕过验收：

```json
{ "verifierSpec": { "baselineExcludePaths": ["workspace/knowledge-manifest.json"] } }
```

豁免会削弱封印，所以必须显式写，绝不推断。

---

## 用法二：多 agent 拆分前，先问该不该拆

**触发时机**：面对批量同构工作，考虑并行处理时。

不要默认"拆了更快"。调研结论是反直觉的：

- 等 thinking token 预算下，单 agent 在多跳推理上**追平或胜出**——每次 handoff 只损失信息
- 共享 context 的多 agent（71%）**差于**单 agent（78%）；隔离 context 才是 84%
- 步骤重复是多 agent 最大单一失效模式（1600+ 标注 trace 中占 17.14%）

```bash
brain fanout assess --units <数量> \
  --independent-units \      # 单元之间不需要互相说话
  --isolated-context \       # 每个单元自带上下文
  --per-unit-verifiable \    # 每个单元能独立验证
  --shared-readonly \        # 共享的东西只读（风格指南=只读，索引=真耦合）
  --order-dependent \        # 必须按顺序产出 → 拆不了
  --json
```

返回 `single_agent` 就**不要拆**，把 thinking 预算提上去反而更好。

同一个工作流的不同阶段结论可能相反：盘点、逐页评分 → 拆；跨页一致性发布 → 不拆。

---

## 用法三：拆了之后，用账本防重复与防自证

**这不是编排器**——它不 spawn、不调度。跑 worker 是宿主的事，账本只记录认领与结果。

```bash
brain fanout register --plan <p> --units "u1,u2,u3" --json
brain fanout claim    --plan <p> --worker <w> --limit 2 --json   # 返回只读的已完成清单
brain fanout complete --plan <p> --unit u1 --worker <w> \
  --verified --verifier-ref "<harness 验收引用>" --json
brain fanout status   --plan <p> --json
```

三个要点：

1. **防重复**：已完成清单由 lead 持有，claim 时只读注入。靠 prompt 提醒 worker"别重复"是无效的
2. **防自证**：`--verified` 必须带 harness 的 verifier-ref，worker 不能为自己背书
3. **看零验证率**：`zeroVerificationRate` 接近 1.0 说明这次 fan-out 只是在批量生产未经审视的产出

worker 崩溃不会把活儿带走——认领是租约，`status` 报 `stalled`，`brain fanout reclaim` 显式回收。

---

## 用法四：内容治理产物的发布门禁

配合 `enterprise-kb-ops` 这类产出 `knowledge-manifest.json` 的工作流：

```bash
brain task create --task-id <id> --objective "<目标>" \
  --criterion governance --manifest <manifest 路径> --json
brain verify --json
```

检查项：未标记 `production_ready` 的条目、悬空的 `parent_id` / `source_ids` 引用。
**fail-closed**：清单缺失、损坏、为空都算失败，缺字段不视为同意。

写在 skill 里的"发布前要审核"只是自然语言，靠自觉；绑到合同上才是机械的。

---

## 报告纪律

用本 Skill 得出结论时，必须区分证据等级：

- **已验证**：`brain verify` 返回 passed，附验收器与引用
- **未验证**：没跑或没通过，**明说没通过**，不要用"应该没问题"含混过去
- **不可验证**：没有可执行验收器的部分（如文风、判断题），标注为人工确认项

不要说"全部完成"，除非每一项都有对应证据。
