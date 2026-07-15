# Codex Brain V9：给 AI 编程助手装一个「安全副驾驶」

[![Version](https://img.shields.io/badge/version-0.10.0-5b5bd6)](package.json)
[![Runtime](https://img.shields.io/badge/runtime-local--first-1f883d)](docs/v9/privacy-and-threat-model.md)
[![Interfaces](https://img.shields.io/badge/interfaces-hooks%20%7C%20CLI%20%7C%20MCP-0969da)](docs/v9/quickstart.md)
[![Eval](https://img.shields.io/badge/eval-reliability%20suites-orange)](evals/v9-reliability/runner.cjs)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

把 AI 编程助手想成**司机**：它负责开车、认路、做决定。  
Codex Brain 像坐在副驾的人：**平时不唠叨、不抢方向盘**；只有快碰到红线、要做高风险操作、连续撞同一堵墙、长对话被压缩，或它说「已经做完」时，才提醒、补小抄，或踩一脚刹车。

> 它**不是**另一个 Agent，也**不承诺**让模型永远正确。  
> 它是一层 **reliability control plane（可靠性控制平面）**：把「目标、边界、证据、失败、交接」变成可检查的规则——**先把事情说清楚，再拿证据验收**。

---

## 目录

1. [装上之后，你到底得到什么](#装上之后你到底得到什么)
2. [Agent 会有哪些具体提升](#agent-会有哪些具体提升)
3. [什么时候会插手，什么时候闭嘴](#什么时候会插手什么时候闭嘴)
4. [一图看懂架构](#一图看懂架构)
5. [P0–P6：0.10 可靠性控制平面](#p0p6-010-可靠性控制平面)
6. [历代版本：解决了什么问题，为什么那样改](#历代版本解决了什么问题为什么那样改)
7. [五分钟跑起来](#五分钟跑起来)
8. [工程术语对照](#工程术语对照)
9. [它做不到什么](#它做不到什么)
10. [文档索引](#文档索引)

---

## 装上之后，你到底得到什么

安装并启用后，你的工作流会多出一套**本地、可审计、默认可静默**的护栏，而不是再塞一个会抢话的「超级大脑」。

### 1. 三条统一入口（同一套规则）

| 入口 | 大白话 | 你得到什么 |
|---|---|---|
| **项目 hooks** | 装在项目里的传感器 | 在 `SessionStart` / `PreToolUse` / `PostToolUse` / `PreCompact` / `PostCompact` / `Stop` 等时点自动观察；平时安静，触发红线才介入 |
| **`brain` CLI** | 手边控制台 | 建任务、验收、交接、技能、记忆、嵌入、hooks 开关，全部可脚本化、可 JSON 输出 |
| **本地 MCP** | 给其他应用的标准插口 | Cursor / 其他 MCP 客户端可读状态与证据，受控写任务与 claim；**不能**绕过策略、装模型、跑迁移 |

三端共用同一 core：**不会出现「CLI 一套规矩、hooks 另一套」**。

### 2. 一份「任务合同」（Task Contract）

装上后你可以（也应当）把每次正经活写成合同：

- **objective**：要做成什么  
- **constraints**：明确红线（用户说的 > 推断的）  
- **scope.allowed / forbidden**：能动哪里、不能动哪里  
- **criteria + verifier**：怎样才算验收通过  

这不是写给人类看的文档玩具，而是 **Stop / verify / close 的硬门槛**。

### 3. 可执行验收，而不是「口头完成」

| 以前常见情况 | 装上之后 |
|---|---|
| Agent 说「测试过了 / 做完了」 | 只记为 **claim（自述）**，状态仍是 `unverified` |
| 你凭感觉相信 | `brain verify` **重新跑** command / test / scope 等 verifier |
| 过关靠自觉 | 只有 `harnessVerified: true` 才能把 criterion 标成 `passed` |

类比：**学生自己在卷子上打勾不算分，老师重批才算分。**

### 4. 失败熔断（Failure Circuit）

同类失败：

1. 第 1 次：记一笔  
2. 第 2 次：**警告——换路线**  
3. 第 3 次：**熔断——别再盲重试**

减少「同一面墙连撞十分钟」的 token 与时间浪费。

### 5. 班次交接工件（Session Handoff）

在项目下生成 / 维护：

```text
.brain/
  feature-backlog.json   # 功能清单（passes 只能在验证后翻 true）
  progress.md            # 本班做了什么、留下什么
  smoke.sh               # 下一班先点烟：环境还活着吗
```

上下文压缩或新开会话时，副驾驶补的是**目标 + 红线 + 未决 + 交接摘要**，不是整段聊天复读。

### 6. 能力边界策略（Capability Policy）

不再靠「命令字符串里有没有 delete 字样」这种贴纸式匹配，而是：

- 路径 **canonicalize**（规范化真实路径）  
- **allow / deny** 前缀与禁区  
- 工具与 shell 的 **risk table**（如 `git push --force`、`rm -rf`、管道远程执行）

### 7. 技能与记忆（有门禁的增强，不是永远在线）

- **Skills**：激活必须声明 **期望验收项 + token 预算**；产出是证据候选项，不是指令  
- **Memory**：召回默认带 `[UNVERIFIED MEMORY]`；只有 harness 验证通过的结果才可晋升为 `verified_outcome`  
- **可选本地嵌入（Ollama）**：本地资料柜召回；**hooks 热路径永不调模型 / 永不调 Ollama**

### 8. 隐私与本地优先

- 默认 **local-first**：状态在 `CODEX_BRAIN_HOME`（或 `~/.codex-brain`）  
- 事件是**脱敏元数据**，不默认存原始 prompt / 原始工具输出  
- 公开发布走 **allowlist 导出**，不是把私有目录洗一遍就上传  

### 9. 可度量的可靠性考场

```bash
npm run eval:reliability
```

四个固定考站：**虚假完成、死循环、越权、热路径税（延迟）**——用来回答「装了到底有没有用」，而不是「我觉得更稳」。

### 10. 你**不会**自动得到的东西（避免预期错位）

- 不会自动让模型更聪明、写出更优雅的算法  
- 不会替代 code review 与领域专家判断  
- 不会在 hooks 默认关闭时「隐形全托管」——**要显式 enable**  
- 不能把语义正确性形式化证明完（它管的是过程可靠性，不是定理证明器）

---

## Agent 会有哪些具体提升

下面按**真实 coding agent 常见失败模式**对照。提升指的是 **可靠性 / 可控性 / 成本纪律**，不是 benchmark 上的「智商分数」。

### A. 完成声明更诚实（False Completion ↓）

| 现象 | 无 harness | 有 Codex Brain |
|---|---|---|
| 「功能做好了」但测试没跑 / 跑挂 | 你常被带节奏 | Stop / close 可被 **harness re-run** 挡住 |
| 把「改了文件」当成「验收通过」 | 极易发生 | criterion 必须挂 **可执行证据** |

**专业表述**：completion 从 *self-report* 升级为 *externally verifiable acceptance*（外部可验证验收）。

### B. 目标与红线更抗遗忘（Goal Drift ↓）

| 现象 | 无 harness | 有 Codex Brain |
|---|---|---|
| 长对话后偏离原始目标 | 很常见 | Task Contract + compact 后小抄强制带回 objective / constraints |
| 「用户说了不能动 X」被冲淡 | 靠模型自觉 | explicit constraints 有冲突检测；scope 可拦路径 |

### C. 重复无效动作更少（Looping ↓）

| 现象 | 无 harness | 有 Codex Brain |
|---|---|---|
| 同一错误重试 N 次 | 烧 token | 失败签名 + 2 警告 / 3 熔断 |
| 换个说法再撞一次 | 难以察觉 | 同类 signature 累计 |

### D. 高风险动作更难「手滑」（Overreach ↓）

| 现象 | 无 harness | 有 Codex Brain |
|---|---|---|
| 写到 secrets、误删、强推远程 | 依赖模型谨慎 | PreToolUse 策略：禁区路径、critical shell 模式要求确认或拒绝 |
| 只靠 prompt「请小心」 | 软约束 | **fail-closed** 红线（策略边界）+ **fail-open** 观察（坏观察器不卡死干活） |

### E. 跨会话 / 压缩后更能接上（Long-horizon Continuity ↑）

| 现象 | 无 harness | 有 Codex Brain |
|---|---|---|
| 新 session 不知道上一班做到哪 | 靠人复述 | progress + backlog + smoke 交接协议 |
| 压缩后只剩模糊摘要 | 易丢红线 | 有界 checkpoint（目标/约束/未决）+ handoff 上下文 |

对齐业界 long-running harness 思路：**增量推进 + 干净交接 + 可检查 backlog**，但保持 native-first，不默认 multi-agent 编排。

### F. 上下文更「省座位」（Context Tax ↓）

| 现象 | 无 harness / 重 harness | 有 Codex Brain V9 |
|---|---|---|
| 每轮塞长 system / 人设 / 全历史 | 贵且挤掉任务本身 | **默认真干**；有症状才注入；召回有条数与 token 上限 |
| 多 Agent 默认开会 | 协调成本高 | 子代理 / 技能 **按证据按需**；你自己的 A/B 表明清晰任务上路由可 **0 质量增益、token 大涨** |

**专业表述**：从 *always-on orchestration* 转为 *measured augmentation*（计量后的增强）。

### G. 记忆与技能更安全（Poisoning / Skill Sprawl ↓）

| 现象 | 无 harness | 有 Codex Brain |
|---|---|---|
| 过期笔记当圣旨 | 记忆污染 | 注入强制 UNVERIFIED；冲突与 supersedes 可记录 |
| 技能随意注入 | 成本与副作用不清 | 激活要 **expected criteria + budget**；产出仅是 evidence candidate |

### H. 可观测、可复盘（Observability ↑）

你得到：

- 脱敏 **events.jsonl**（工具结果状态、失败签名、验收事件）  
- **circuit** 状态（是否已熔断）  
- **verify results**（谁、用什么 fingerprint、何时 harness 验证）  
- **eval 报表**（四考站是否绿）

这让「Agent 今天又犯什么病」从感觉变成可统计信号（触发频率、重复失败、验证缺口）——**不是通用 BI**，但是调策略的原材料。

### 提升一览（给决策者看的表）

| 维度 | 提升方向 | 机制关键词 |
|---|---|---|
| 完成可信度 | 虚假完成更难混过 | executable verifiers, harnessVerified |
| 约束遵守 | 越界更易被拦 | task contract, path policy |
| 失败处理 | 盲重试更短 | failure circuit |
| 长程任务 | 交接更干净 | handoff backlog / progress / smoke |
| 成本纪律 | 默认编排税更低 | native-first, silent-by-default |
| 记忆安全 | 待证召回 | unverified memory banner |
| 技能治理 | 有预算有验收 | skill activation contract |
| 工程闭环 | 可测可回归 | reliability eval suites |

---

## 什么时候会插手，什么时候闭嘴

| 场景 | 大白话 | V9 行为 |
|---|---|---|
| 日常读写，范围已说清 | 正常开车 | 只记允许的元数据，**不打扰** |
| 有明确目标/红线 | 办事前写清单 | 需要时补回 Task Contract 与交接摘要 |
| 禁区路径 / 高危写 / 强推 / 破坏性删除 | 转账前再核收款人 | 策略拦截或要求确认（fail-closed） |
| 同类失败反复出现 | 路口红绿灯 | 2 警告，3 熔断 |
| 上下文压缩 / 新会话 | 换班留言 | 有界小抄 + handoff，不复读全文 |
| Agent 声称完成 | 交卷按题号查 | **重跑 verifier**；自述不算数 |
| 观察器自己挂了 | 仪表盘坏了别锁死油门 | 观察类失败 **fail-open**，不阻断正常工作 |

热路径 hooks：**不联网、不调用模型**。预算目标：`PreToolUse` &lt; 100 ms，`PostToolUse` &lt; 150 ms——副驾驶不能比开车还慢。

---

## 一图看懂架构

```mermaid
flowchart TB
  subgraph 开车的人
    Agent["AI 编程助手\n司机"]
  end
  subgraph 三种插口
    Hooks["项目传感器\nhooks"]
    CLI["brain 命令行\n手边控制台"]
    MCP["本地 MCP\n通用插口"]
  end
  subgraph 副驾驶核心
    Core["V9 可靠性控制平面"]
    Contract["任务清单\n要做什么 / 不能做什么"]
    Verify["可执行验收\n老师重批卷"]
    Circuit["失败红绿灯"]
    Handoff["交接本"]
    Policy["安检门"]
    Skills["技能工牌"]
    Memory["便条墙"]
    Hosts["宿主转接头"]
  end
  Agent --> Hooks
  Human["使用者"] --> CLI
  Client["其他应用"] --> MCP
  Hooks --> Core
  CLI --> Core
  MCP --> Core
  Core --> Contract & Verify & Circuit & Handoff & Policy & Skills & Memory & Hosts
```

```mermaid
stateDiagram-v2
  [*] --> 安静工作
  安静工作 --> 记一笔: 普通工具事件
  记一笔 --> 安静工作: 无明确风险
  安静工作 --> 补小抄: 压缩 / 交接
  安静工作 --> 先刹车: 禁区或高风险
  安静工作 --> 提醒绕路: 第2次同类失败
  提醒绕路 --> 先刹车: 第3次熔断
  安静工作 --> 交卷验收: Stop / 完成声明
  交卷验收 --> 重批卷: harness 重跑 verifier
  重批卷 --> [*]: 全部 harnessVerified
  重批卷 --> 先刹车: 缺证据 / 失败 / 仅自述
```

---

## P0–P6：0.10 可靠性控制平面

在 V9「安全副驾驶」之上，0.10 把「证据」从状态字段升级为**可重放协议**，并补齐交接、评测、策略、技能、宿主与记忆。

| 优先级 | 能力 | 大白话 | 解决的问题 | 你怎么用 |
|---|---|---|---|---|
| **P0** | 可执行验收 | 老师重批卷 | 自述完成、假 passed | `brain verify` / `brain evidence claim` |
| **P1** | 班次交接 | 换班留言本 | 压缩/跨会话失忆与烂尾 | `brain handoff init\|status\|progress` |
| **P2** | 可靠性考场 | 驾照四科目 | 「我觉得更稳」无法证明 | `npm run eval:reliability` |
| **P3** | 路径能力策略 | 机场安检 | 关键词误伤/漏拦 | hooks PreToolUse + `policy.js` |
| **P4** | 技能焊死证据 | 临时工工牌 | 技能乱注入无验收 | `brain skill activate --criterion …` |
| **P5** | 多宿主适配 | 旅行转接头 | 绑死单一 IDE | `BRAIN_HOST=codex\|claude\|mcp` |
| **P6** | 版本化记忆 | 未核验便利贴 | 记忆污染当圣旨 | `brain memory recall` |

详见 [docs/v9/p0-p6-reliability-plane.md](docs/v9/p0-p6-reliability-plane.md)。

---

## 历代版本：解决了什么问题，为什么那样改

这不是「版本号越大功能越多越好」的堆料史。每一版都先钉住一个**高频翻车点**，再发现护栏本身的成本与盲区，最后收敛成 V9 的原则：

> **控制必须赚回自己的成本（control must earn its cost）。**  
> 清晰、低风险、可验证的工作 → 让原生 Agent 直接干；  
> 只有出现明确症状 → 系统才介入。

```mermaid
flowchart LR
  V1["V1\n笔记本"] --> V2["V2\n诚实"] --> V3["V3\n换路"] --> V4["V4\n姿势卡"] --> V5["V5\n资料出处"] --> V6["V6\n改完即查"] --> V7["V7\n重 harness"] --> V8["V8\n默认直做"] --> V9["V9\n安全副驾驶"] --> V91["0.10\nP0–P6"]
```

### 总表（问题 → 手段 → 为何还要演进）

| 版本 | 当时主要问题（大白话） | 专业出发点 | 加了什么 | 留下的教训 / 为何继续改 |
|---|---|---|---|---|
| **V1** | 聊着聊着忘掉目标、重复踩坑 | 持久化与可追溯：把关键状态移出瞬时对话 | 本地笔记 / 轻量索引 / 会话开始条件注入 / Stop 捕获教训 | **记得住 ≠ 是真的**；错误信念也会被忠实保存 → V2 |
| **V2** | 模型说得很满，证据不够 | 置信度校准：self-report ≠ evidence | 在线：信号融合与对质；离线：回顾记忆再晋升/存疑 | 更诚实仍可能死磕错误路线 → V3 |
| **V3** | 卡在一条路上反复小修 | 失败环检测与策略切换（anti-loop） | 卡住检测、突破清单（回退/分解/换工具/质疑目标） | 万能检查表会误报；不同任务需要不同姿势 → V4 |
| **V4** | 大道理都会，一忙就局部最优 | 轻量模式路由，避免每轮长 persona | owner / operator / reviewer / coach 短工作卡 | 纯文本姿态管不住截图/文档类证据 → V5 |
| **V5** | 截图 PDF 当过又丢，或假装看懂了 | 多模态摄入的可表示证据边界 | sidecar：元数据、可提取文本、unsupported 状态 | 收证据更好 ≠ 改完代码已验收 → V6 |
| **V6** | 局部改对、整体埋雷（漏测、密钥、膨胀文件） | 贴近因果点的工程 harness | PostTool 检测：漏验、危险编辑、密钥、依赖与结构债 | 常驻检查易吵；「建议」不能自动变「许可」→ V7 |
| **V7** | 想自我进化却可能直接改策略/记忆 | 治理门：proposal → candidate → 审批/验证 | Evolution Gate、trace/eval、隐私门、人审 | **护栏全集默认开启**在强模型时代变成上下文税与干扰 → V8 |
| **V8** | 编排太重，清晰任务被拖慢 | Native-first control plane；增强要可计量 | Task Contract、context economy、trace、harness tax、skill lifecycle、policy lab | hooks/CLI/MCP 仍需统一小规则 → V9 |
| **V9** | 三端策略不一致；要安静也要能刹得住 | 统一可靠性副驾驶 + 证据门 + 熔断 + 可选本地召回 | 同一 core、hooks/CLI/MCP、迁移回退、隐私导出 | 证据仍偏状态字段；长程交接与硬评测不足 → **0.10 P0–P6** |
| **0.10** | 假完成、弱交接、弱评测、弱策略、弱技能/记忆/多宿主 | 可重放验收 + handoff + eval + capability policy | 本文 P0–P6 | 仍不替代语义专家；继续用 eval 说话 |

### 分版细说（优化出发点写清楚）

#### V1 — 从「聊天记忆」到「可检查笔记本」

- **问题**：长会话丢失目标；同一纠正反复出现；决策只活在对话气泡里。  
- **出发点**：先解决 **persistence（持久化）** 与 **traceability（可追溯）**，而不是一上来追求准确率分数。  
- **手段**：小而可读的本地状态/教训文件 + 条件注入，而不是巨型黑盒记忆库。  
- **边界**：保存系统会连错误一起保存。

#### V2 — 诚实优先：自述不能当证据

- **问题**：Agent 语气很确定，但没有外部依据。  
- **出发点**：**epistemic humility（认知谦逊）**——把「我觉得」和「我有证据」拆开。  
- **手段**：多信号置信、对质、不敢则追问或降调；离线再整合记忆。  
- **边界**：诚实 ≠ 会换搜索路径。

#### V3 — 卡住时逼你换路

- **问题**：单轨死磕（single-track persistence）。  
- **出发点**：在 **unproductive loop 变得可见** 的时刻介入，而不是每句都说教。  
- **手段**：重复卡住信号 → 下一轮突破清单。  
- **边界**：检查表会误伤；姿势应随任务变。

#### V4 — 短工作卡，而不是长人设

- **问题**：原则会背，压力下只顾眼前 diff。  
- **出发点**：**context thrift（上下文节俭）**——用显式信号选窄姿态，而不是常驻万金油 prompt。  
- **手段**：owner / operator / reviewer / coach。  
- **边界**：管不住非文本证据生命周期。

#### V5 — 资料要有出处，不假装看懂

- **问题**：截图/PDF 影响过任务，随后从记忆蒸发；或把文件名当理解。  
- **出发点**：**evidence representation（可表示证据）**——只记录能安全表示的东西，明确 unsupported。  
- **边界**：摄入完善 ≠ 变更已验证。

#### V6 — 改完马上做工程体检

- **问题**：AI 改动局部正确，却引入漏测、密钥、臃肿结构、错误层修改。  
- **出发点**：**shift-left observability**——在因果编辑点附近暴露失败模式。  
- **手段**：纯检测器 + 红灯记录 + 节流，避免永远吵闹。  
- **边界**：顾问型，不该静默改写；自我改系统需要治理 → V7。

#### V7 — 重 harness：可观测闭环 + 进化门

- **问题**：长程不可靠：丢上下文、漂目标、工具过程不可见、完成不可验、错误不可复用。  
- **出发点**：把 coding session 当成 **engineered execution loop**（需求→计划→执行→trace→验证→人审→学习），而不是写更好的 prompt。  
- **手段**：工作记忆、trace/eval、prompt pack、隐私门、人审、reward/replay、看板……以及 **Evolution Gate**（提案必须候选化，敏感变更要批/要证）。  
- **历史地位**：定下至今仍正确的硬核原则——**验证、隐私、人审、可观测、评估**。  
- **为何收缩**：模型变强后，**每层默认全开**会：吞上下文、抢判断、多 Agent 空转、自动进化推噪声。  
- 复盘：[docs/history/v7-heavy-harness.md](docs/history/v7-heavy-harness.md)

#### V8 — Native-first：默认让主 Agent 干活

- **问题**：V7 式编排在「任务已经清晰」时变成纯税。  
- **出发点**：**measured augmentation**——增强模块可开关；用 harness tax 对比原生基线；策略进 lab，技能走 lifecycle。  
- **实证取向**：清晰任务上，路由子代理可能 **质量不涨、token/延迟大涨**；含糊任务缺信号时，多派几个探子也猜不到没说出口的业务规则 → **先澄清，再编排**。  
- **边界**：控制面模块仍需与 hooks/CLI/MCP 收成一套产品规则。

#### V9 — 安全副驾驶（当前主线）

- **问题**：要保留 V7/V8 的硬护栏，但默认安静、三端一致、可迁移可回退、隐私可导出。  
- **出发点**：  
  - **native-first**：司机开车，副驾驶按症状介入；  
  - **evidence-gated completion**：完成门控；  
  - **fail-closed red lines / fail-open observers**；  
  - **local-first privacy**。  
- **手段**：Task Contract、事件、证据门、失败电路、hooks/CLI/MCP 统一 core、可选 Ollama 嵌入、V1–V8 复制式迁移。  
- **0.10 增量**：把「证据」做成可执行 verifier；补 handoff、eval、path policy、skills、hosts、memory 版本语义（P0–P6）。

### 从历代演进里沉淀的产品原则

1. **持久化要服务验证，而不是替代验证。**  
2. **自述永远小于证据；证据最好可重放。**  
3. **卡住时换路，比加长 prompt 更有效。**  
4. **姿态与上下文要短、要按需，常驻即有税。**  
5. **多模态与记忆都要标明「知道到什么程度」。**  
6. **工程问题靠近编辑点暴露，但建议 ≠ 放行。**  
7. **自我改进必须过治理门。**  
8. **编排默认关闭；打开要有独立收益证明。**  
9. **三端一套策略；红线硬，观察软。**  
10. **用 eval 约束叙事，避免「架构故事」膨胀。**

---

## 五分钟跑起来

需要 **Node.js 20+**。

```bash
git clone https://github.com/liuanye9-lab/codex-os-brain.git
cd codex-os-brain
npm install
npm test
npm run eval:reliability
npm link

brain status --json
brain task create --task-id demo --objective "verify the V9 adapter" --criterion tests --json
brain evidence claim --criterion tests --id claim1 --json   # 仅自述，未验收
brain verify --json                                        # harness 重跑
brain handoff init --objective "verify the V9 adapter" --json
```

别名：`brain` 与 `codex-brain` 均可。

### 任务与验收（P0）

```bash
brain task create --task-id release --objective "ship safely" --criterion tests,scope --json
brain evidence claim --criterion tests --id ev1 --kind claim --ref agent --json
brain verify --json                 # 重跑 verifiers
brain verify --status-only --json   # 只看存档评分
brain task checkpoint --summary "midway" --json
```

### 交接本（P1）

```bash
brain handoff init --json
brain handoff status --json
brain handoff progress --summary "固定了 Stop 验收" --json
```

### 技能 / 记忆 / 宿主（P4–P6）

```bash
brain skill list --json
brain skill activate --id brain-lite-model-router --criterion tests --budget 2000 --json
brain memory add --text "优先本地嵌入" --tags embed --json
brain memory recall --query "嵌入" --json
brain hosts list --json
```

### 给项目装传感器

```bash
brain hooks doctor --project "$PWD" --json
brain hooks enable --project "$PWD" --confirm --json
brain hooks disable --project "$PWD" --confirm --json
```

默认**不**装全局 hooks，**不**擅自装 Claude Code hooks；只写项目内配置。

### MCP

```bash
brain mcp serve
```

```json
{
  "mcpServers": {
    "codex-brain-v9": {
      "command": "brain",
      "args": ["mcp", "serve"]
    }
  }
}
```

MCP 可读状态/任务/失败/事件/验收/交接/技能/记忆；可受控建任务、checkpoint、**claim** 证据、激活技能、验证后关闭任务。  
**不能**自证 passed、下载模型、改嵌入配置、批准迁移、绕过策略。

### 可选：本地资料柜（Ollama）

像资料管理员，不是第二大脑。hooks 热路径**永不**调用。

```bash
brain embeddings recommend --profile zh-light --json
brain embeddings doctor --json
```

见 [docs/v9/local-embeddings.md](docs/v9/local-embeddings.md)。

### 验收与发布卫生

```bash
npm test
npm run check
npm run eval:reliability
node scripts/build-public-export.js --output /tmp/codex-brain-v9-public
```

---

## 工程术语对照

| 术语 | 大白话 | 在本项目中的落点 |
|---|---|---|
| **Harness** | 套在模型外面的缰绳与跑道 | 整个 Codex Brain：约束感知、动作、验收与交接 |
| **Reliability control plane** | 可靠性调度台 | V9 core：合同、策略、验证、事件、熔断 |
| **Task Contract** | 任务合同 | objective / constraints / scope / criteria |
| **Executable verifier** | 可执行验收器 | command / test_runner / git_diff_bounded / human_attestation… |
| **harnessVerified** | 老师签过字 | 仅 harness 重跑可置 true |
| **Native-first** | 默认让主模型直做 | 无症状不注入、不强制 multi-agent |
| **Measured augmentation** | 增强要算账 | harness tax、skill budget、eval |
| **Fail-closed / fail-open** | 红线死锁 / 观察器坏了不挡路 | PreToolUse&Stop vs 纯观察 |
| **Context engineering** | 座位怎么分 | 有界 checkpoint、召回上限、交接摘要 |
| **Loop engineering** | 交通规则 | 失败电路 + 证据交卷 |
| **Capability policy** | 能力与路径门禁 | path canonicalize + risk table |
| **Evidence-gated memory** | 有证据才晋升的记忆 | UNVERIFIED 默认；verified_outcome 晋升 |
| **Host adapter** | 宿主转接头 | Codex / Claude / generic MCP |
| **RAG（可选）** | 先翻资料柜再答 | 本地嵌入；结果是候选证据不是指令 |

---

## 它做不到什么

- **不能**保证语义正确、产品正确、安全到可形式化证明  
- **不能**替代资深工程师的设计评审与业务判断  
- **不能**在你不建 Task Contract、不跑 verify、不 enable hooks 时「自动变稳」  
- **不能**单靠多 Agent 猜出用户没说的隐藏验收标准（此时应 **澄清**，不是加戏）  

副驾驶不是方向盘。它减少的是：**遗忘、越界、死循环、假完成、无交接、无计量的编排税**。

---

## 文档索引

| 文档 | 内容 |
|---|---|
| [CLI / hooks / MCP 快速开始](docs/v9/quickstart.md) | 命令与接入 |
| [P0–P6 可靠性控制平面](docs/v9/p0-p6-reliability-plane.md) | 0.10 机制说明 |
| [可选 Ollama 本地嵌入](docs/v9/local-embeddings.md) | 资料柜 |
| [V1–V8 迁移与回退](docs/v9/migration.md) | 搬家协议 |
| [隐私与威胁模型](docs/v9/privacy-and-threat-model.md) | 本地优先与导出 |
| [研究与开源归属](docs/v9/research-and-attribution.md) | 论文与上游概念 |
| [V7 重 harness 复盘](docs/history/v7-heavy-harness.md) | 为何从重到轻 |
| [V1–V8 历史设计](v1/README.md) | 分版设计原文入口 |

---

MIT licensed. See [LICENSE](LICENSE).
