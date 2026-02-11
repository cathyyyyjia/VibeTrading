# 需求文档

# **Aipha Vibe Trading System 需求文档（MVP）**

## **0\. 目标与范围**

### **MVP 目标**

构建最基础版本的 vibe trading system，支持以下闭环：

1. 用户输入自然语言策略意图

2. AI 自动生成结构化策略（五层：原子/时间/信号/逻辑/动作）

3. 自动回测并给出报告

4. 一键确认后进入 **Paper Trading**（优先）或 **Live Trading**（可开关）

5. 具备最小可用的可观测性（日志、状态、告警）

### **MVP 验收任务**

在 QQQ / NDX 上确认 **4小时 MACD 死叉**，且在**收盘前 2 分钟**仍未收回“跌破的 5日 MA”（仍在 MA5 下方），则卖出一部分 **TQQQ**，认为反弹结束。

**核心点**：多标的（信号标的 vs 交易标的）、多周期（4H \+ “收盘前2分钟”）、事件+状态组合、执行动作（减仓）。

---

## **1\. 用户体验与产品形态（MVP）**

### **1.1 交互原则**

* 用户只输入**一句自然语言**（或很少补充），系统自动完成拆解与执行。

* 输出结果后用户只做：**Confirm（部署）/ Revise（修改）**。

### **1.2 页面结构（v0）**

* 左侧：对话输入 \+ 回测结果（KPI、曲线、交易列表）+ Confirm/Revise

* 右侧：AI 工作台（Planner/Runner 状态）展示进度与产物（DSL、数据检查、回测 run\_id）

![][image1]![][image2]

---

## **2\. 策略表达：五层 DSL（必须）**

### **2.1 五层定义**

1. **原子层 Atom**：指标/特征（MACD、MA）

2. **时间层 Timeframe**：1m/1h/4h/1d \+ 对齐规则

3. **信号层 Signal**：死叉、收盘前条件、MA 下方状态

4. **逻辑层 Logic**：AND/OR、窗口、确认、冷却、优先级

5. **动作层 Action**：卖出多少、订单类型、执行保护

### **2.2 测试用例的 DSL 拼装结果（明确交付）**

下面是 v0 运行必须能生成/保存/回测的“结构化策略 Spec”（用自然语言解析后产出）：

**标的与角色**

* Signal Underlying：`QQQ`（或 `NDX`，两者择一/同时支持）

* Trade Instrument：`TQQQ`

**原子层**

* `MACD(12,26,9)` on 4H for QQQ/NDX

* `MA(5, type=SMA)` on 1D for QQQ/NDX（“5日MA”日频）

* `LastPrice` on 1m for QQQ/NDX（用于收盘前2分钟检查）

**时间层**

* 4H bars：用于 MACD（基于分钟数据聚合或直接用4H数据）

* 1D bars：用于 MA5

* 1m bars：用于临近收盘检查（最后2分钟）

* 对齐：在“收盘前2分钟”决策点，只能使用**已完成**的 4H bar（无未来函数）

  * `carry_forward_last_closed_4H`（把最近完成4H状态带到当前时点）

**信号层**

* `S1_event`: 4H MACD 死叉（QQQ/NDX）

  * event：`macd_line crosses below signal_line`（在 4H bar close 判定）

  * confirm：可选 `confirm_bars=0/1`（v0 可不确认）

* `S2_state`: 当天收盘前 2 分钟（例如 15:58:00 ET）时，QQQ/NDX 价格仍在 MA5 下方

  * state：`price_1m(15:58) < MA5_today`（MA5 取当日收盘前可得的“昨日为止 MA5” or “当日实时MA5”二选一，v0 建议用**昨日收盘计算的 MA5**，避免当日未收盘导致定义歧义）

* `S3_filter`（可选）：当日是否为交易日；数据完整性 OK

**逻辑层**

* `TRIGGER = S1_event_within(lookback_days=5 trading days) AND S2_state`

  * 解释：4H 死叉发生后的一段时间内（比如5个交易日）有效，避免“死叉发生了很久还触发”

  * cooldown：触发后 `cooldown=1 trading day`，避免每天15:58重复卖

**动作层**

* `ACTION = REDUCE_POSITION(symbol=TQQQ, by_pct=25%)`

  * 订单：`MKT` 或 `LMT`（v0 建议 MKT \+ 滑点保护阈值）

  * 执行保护：

    * max\_slippage\_bps（例如 30bps）

    * only\_regular\_session（只在正常交易时段）

    * idempotency\_key（按日期+策略+symbol 防重复下单）

以上就是“拼搭结果”，你们的系统必须能自动生成并运行它。

---

## **3\. 回测需求（MVP 必须有）**

### **3.1 回测引擎必须支持**

* 多标的：信号标的（QQQ/NDX）触发交易标的（TQQQ）

* 多周期：4H、1D、1m 的对齐与无未来函数

* 执行规则：在指定时刻（15:58）下单

* 成本模型：手续费 \+ 滑点（先固定bps，后续可升级）

* 输出：

  * KPI：年化/回撤/Sharpe/交易次数/胜率/平均持有期

  * 交易列表：每笔交易原因（S1/S2/逻辑触发）

  * 诊断：信号触发频率、触发后收益分布、失效环境提示

### **3.2 数据颗粒度与回测时间**

* 最低要求：**1分钟级**数据（用于 15:58 检查与模拟下单）  
* 4H 可由 1m 聚合  
* 1D 用于 MA5（可由 1m 聚合或直接日线）  
* 针对MOC订单，使用完整的从开盘到收盘的数据进行回测模拟，成交价格必须使用该交易日16:00的收盘价(Close Price)，而不是15:58的瞬时价

---

## **4\. 实盘/纸面交易需求（MVP）**

### **4.1 交易接口（建议路径）**

* 优先：IBKR API（纸面/实盘一致）

* 需要的能力：

  * 查询持仓（TQQQ 当前仓位）

  * 下单（市价/限价）

  * 订单状态回报（成交/失败）

  * 幂等与重试（避免重复卖）

### **4.2 定时与触发**

* 每个交易日 **15:58:00 ET**（美股东部时间）触发策略评估与下单

* 同时需要持续更新/缓存信号状态（4H MACD 是否在有效窗口内）

---

## **5\. 工程架构（v0 最小模块）**

### **5.1 服务划分**

1. **UI Web**：对话、工作台、报告展示、Confirm/Revise

2. **Strategy Service（NL→Spec）**

   * 把自然语言解析成五层 DSL（带默认值）

   * 校验（字段完整性、无未来函数规则）

3. **Planner/Runner**

   * 把 Spec 编译成 DAG 任务（数据→特征→信号→回测→报告）

   * 记录 run\_id、步骤状态、产物链接

4. **Market Data Service**

   * 拉取/缓存 1m 数据、聚合 4H/1D

   * 数据完整性检查（缺口、时区、交易日）

5. **Backtest Engine**

6. **Execution Service**

   * IBKR 下单、风控、幂等、告警

### **5.2 存储与产物**

* DB（Postgres）：策略 spec、run\_id、任务状态、交易记录、配置

* Object Storage：回测报告、图表、交易 CSV、日志快照

* Cache（Redis）：最新行情/信号状态、任务队列锁

### **5.3 可观测性**

* structured logs（JSON）

* metrics：下单成功率、延迟、数据缺口率、回测耗时

* alerts：15:58 触发失败、数据缺失、下单失败、重复下单防护触发

---

## **6\. 数据需求与选型**

### **6.1 必要数据**

* QQQ（或 NDX）1-minute OHLCV

* TQQQ 1-minute OHLCV（回测下单成交模拟）

* 交易日历（US equities calendar）

* 公司行为（拆股/分红）处理：v0 可只用**调整后价格**（adjusted）或明确只做不复权回测并声明

### **6.2 数据源策略（不绑定单一供应商）**

* v0 推荐：选择一个稳定的分钟数据供应（付费通常更稳定）

* 备选：两路数据（主/备）+ 缺口自动切换（可 v1）

---

## **7\. 服务器与部署要求（MVP）**

### **7.1 技术设想（可修改）**

* 足够跑原型+少量用户  
* 前后端  
  * Vite \+ React \+ Python \+ Fast API  
  * 要求可以达到快速部署验证的要求  
  * 框架完整，遵循clean code代码风格  
  * 前端风格简练，采用Shadcn/UI作为前端组件和默认配色模板  
* Infra  
  * GitHub  
  * Supabase支持PostgreSQL \+ Auth \+ Storage \+ Realtime  
  * Redis 缓存  
  * Vercel快速部署

### **7.2 网络与安全**

* API 必须鉴权（JWT/Session）

* Broker 凭证加密存储（KMS/Secret Manager）

* 下单服务独立网络策略（最小权限）

* 审计日志：谁在什么时候 Confirm、生成了什么订单意图

---

## **8\. 风控与防呆（MVP 必须）**

* **No Lookahead**：跨周期只能使用已完成 bar

* **时间点明确**：15:58 ET 执行；若遇到半日市/提前收盘，按交易日历调整

* **幂等**：同一策略同一交易日最多触发一次卖出

* **失败降级**：数据缺失/下单失败 → 不交易 \+ 告警 \+ UI 展示原因

* **Paper 默认**：Confirm 默认部署到 Paper；Live 需要额外开关

---

## **9\. 里程碑与验收标准（建议）**

### **Phase 0（3–7 天）：策略 DSL \+ mock 回测**

* NL→Spec 能输出五层 DSL

* Runner 能跑通流程（先用 mock 数据/结果）

* UI 两区 \+ Confirm/Revise

### **Phase 1（1–2 周）：真实数据 \+ 回测可用**

* 接入分钟数据

* 回测引擎跑出 KPI、交易列表、曲线

* 测试用例可以回测复现（15:58 检查 \+ 4H MACD）

### **Phase 2（1–2 周）：Paper Trading**

* IBKR paper 下单、订单状态、幂等、告警

* 每个交易日自动触发一次评估

**验收标准（针对你这个策略）**

* 回测：能输出 “触发日/触发时刻/卖出比例/原因”

* 实盘（paper）：在触发日 15:58 ET 产生一笔减仓单，且不会重复下单

---

## **10\. 工程任务清单**

### **Backend**

* Spec Schema（五层 DSL）定义 \+ 校验器

* NL→Spec 解析器（默认值、输出假设）

* Data Service：分钟数据拉取/缓存/聚合（1m→4H/1D）

* Backtest Engine：多标的+多周期对齐+成本模型

* Report Generator：KPI+图+交易列表+解释文本

* Execution Service：IBKR paper 下单 \+ 幂等 \+ 告警

### **Frontend**

* Strategy Designer: chat 输入与历史

* 右侧 AI Workspace（步骤卡片 \+ artifact 链接）

* Backtest Summary 部分（KPI \+ chart \+ trade table）

* Confirm/Revise 流程（paper 默认）

### **Infra/DevOps**

* 容器化、CI/CD、环境变量与密钥管理

* Postgres/Redis 部署

* 日志与告警（最小版也要有）

---

：

* **DSL 的 JSON Schema（字段名、类型、默认值）**

* Runner 的 DAG 节点定义（input/output）

* 回测引擎的对齐规则伪代码（避免未来函数）

* IBKR 下单幂等与重试策略（状态机）

# 后端技术总结

# **Vibe Trading 后端技术总结**

## **0\. Scope & Non-goals（v0 边界）**

### **In Scope**

* 自然语言 → 五层 DSL → 执行计划 → 回测 → 报告 → Paper（可选 Live）  
* 多周期信号（1m / 4H / 1D）对齐  
* 决策 vs 成交时点严格区分  
* Workspace 可观测（steps / logs / artifacts）

### **Out of Scope（v0 不做）**

* 高频（\<1m）数据  
* 盘中多次决策  
* 复杂组合优化 / 资金再平衡  
* Partial fill / VWAP / TWAP 等复杂执行

  ---

## **1\. Global Assumptions（全局写死规则）**

1. 时区与日历  
   * 统一使用 America/New\_York  
   * 使用交易所日历（处理 DST / 提前收盘 / 假期）  
   * 禁止使用 EST / 本地时间  
2. 决策与执行  
   * 决策时点：market\_close \- 2 minutes  
     * 常规交易日：15:58 ET  
     * 提前收盘：actual\_close \- 2min  
   * 执行模型：MOC（Market-On-Close）  
   * 回测成交价：当日收盘价（16:00 close 或提前收盘 close）+ 滑点/成本  
3. MA5 定义（强约束）  
   * MA5 \= 截至昨日收盘的 5 日 SMA  
   * 使用 LAST\_CLOSED\_1D bar  
   * 禁止使用当日未收盘数据（避免未来函数）  
4. 多周期数据真源  
   * 1m 为唯一真源  
   * 4H / 1D 必须由 1m 聚合生成  
5. 信号标的降级  
   * 默认信号标的：QQQ  
   * NDX 分钟数据不稳定 → 自动 fallback 到 QQQ  
   * 降级必须在 DataHealth 中显式标记  
     ---

## **2\. System Architecture（模块划分）**

* NL Input  
  *   ↓  
  * Parser / SpecBuilder  
  *   ↓ StrategySpec (DSL)  
  * Planner  
  *   ↓ ExecutionPlan  
  * Runner (Orchestrator)  
  *   ├─ Data Factory  
  *   ├─ Indicator Engine  
  *   ├─ Backtest Engine  
  *   ├─ Execution Service (Paper/Live)  
  *   ↓  
  * Workspace (steps / logs / artifacts)

    ---

## **3\. Core Domain Models & Schemas（核心结构）**

### **3.1 StrategySpec（策略规范）**

包含：

* universe（signal / trade symbols）  
* decision / execution / risk  
* DSL 五层：  
  * Atomic  
  * Time  
  * Signal  
  * Logic  
  * Action

StrategySpec 是 策略的唯一语义源，Planner / Backtest / Execution 不得自行推断规则。

---

### **3.2 ExecutionPlan（执行计划，plan.json）**

ExecutionPlan 是 StrategySpec 的可执行编译结果。

#### **必须包含**

{ "version": "v0", "decision\_schedule": { "type": "MARKET\_CLOSE\_OFFSET", "offset": "-2m", "timezone": "America/New\_York" }, "nodes": \[ { "id": "data\_signal\_1m", "type": "DATA", "symbol": "QQQ", "timeframe": "1m", "outputs": \["bars\_qqq\_1m"\] } \] }

#### **强制规则**

* 每个 DATA / INDICATOR 节点必须显式声明：  
  * symbol  
  * timeframe  
* 禁止 Runner / DataFactory 从 DSL 反推 symbol

  ---

## **4\. Time & Multi-Timeframe Semantics（关键写死点）**

### **4.1 4H Bar 切分规则（非常重要）**

SESSION\_ALIGNED\_4H 定义：

* 以 交易所 session open（NYSE 09:30 ET）为锚点  
* 按 session 内切分 4H bar  
* 提前收盘日：最后一个 4H bar 自动缩短  
* 禁止使用自然日 / UTC 对齐 / pandas resample 默认行为

  ---

### **4.2 多周期对齐规则（No Future Function）**

| 周期 | 取值规则 |
| ----- | ----- |
| 1m | decision\_time 前最后一个已闭合 bar |
| 4H | decision\_time 前最后一个 已闭合 4H bar |
| 1D | 昨日收盘（LAST\_CLOSED\_1D） |

高周期值在决策点（15:58）使用 carry-forward 语义。

---

## **5\. Signal & Event Semantics（信号语义）**

### **5.1 Indicator**

* 所有 indicator 只允许基于 已闭合 bar  
* lookback/window 必须带单位（如 "5d" / "20bars@4h"）

### **5.2 Event（非常关键）**

Event semantics: \- Events are edge-triggered. \- macd\_bear\_cross is TRUE only at the bar where the cross occurs. \- It is NOT a persistent state.

MACD 死叉 ≠ “MACD 当前在 signal 下方”

---

## **6\. Logic Layer（策略条件）**

v0 示例逻辑（语义级）：

IF (4H MACD bearish cross occurred on last closed 4H bar) AND (15:58 1m close \< MA5\_last\_closed\_1D) THEN sell part of TQQQ position via MOC

---

## **7\. Action & Execution Semantics**

### **7.1 Quantity Resolution**

"qty": { "mode": "FRACTION\_OF\_POSITION", "value": 0.3 }

#### **最小成交约束（必须实现）**

If computed quantity \< broker.min\_qty: \- v0 behavior: skip action \- log: "qty\_too\_small" \- do NOT place order

---

### **7.2 Idempotency & Cooldown**

* Idempotency key：  
  * strategy\_version \+ trading\_day \+ action\_id  
*   
* Cooldown（v0 默认）：  
  * 同一 symbol \+ side  
  * 1 trading day 内只允许一次  
    ---

## **8\. Backtest Engine Semantics**

### **8.1 时间线**

| 阶段 | 时间 |
| ----- | ----- |
| Decision | 15:58 |
| Order Submit | 15:58 |
| Fill | Market Close |

### **8.2 Trade 结构（必须区分）**

{ "decision\_time": "...15:58", "fill\_time": "...16:00", "fill\_price": 50.12, "cost": { "slippage": 0.02, "commission": 0.0 }, "why": { "macd\_4h\_cross": true, "close\_1558": 408.1, "ma5\_last\_closed": 410.25, "signal\_symbol": "QQQ", "is\_fallback": false } }

---

## **9\. Data Factory & Health**

### **9.1 数据真源**

* 所有 4H / 1D 数据必须由 1m 聚合  
* 禁止混用第三方 4H / 1D

### **9.2 DataHealth（必须产出）**

{ "source": "primary | fallback", "is\_fallback": false, "missing\_ratio": 0.0, "gaps": \[ { "start": "...", "end": "...", "bars\_missing": 3 } \] }

---

## **10\. Workspace & Observability（前端可观测）**

### **10.1 Workspace Steps（固定枚举）**

* parse → plan → data → backtest → report → deploy

### **10.2 必备 Artifacts**

| Artifact | 用途 |
| ----- | ----- |
| dsl.json | 策略语义快照 |
| plan.json | 执行计划 |
| inputs\_snapshot.json | 最终解析输入（强烈要求） |
| report.md | 回测解释性报告 |
| equity.png | 净值曲线 |

inputs\_snapshot.json 内容：

* strategy\_version  
* resolved universe  
* resolved calendar  
* execution model  
* fallback 是否发生

  ---

## **11\. Error Model（统一）**

{ "code": "VALIDATION\_ERROR | DATA\_UNAVAILABLE | EXECUTION\_GUARD\_BLOCKED | INTERNAL", "message": "string", "details": {} }

---

## **12\. v0 必跑测试用例（验收标准）**

用例：

在 QQQ 确认 4H MACD 死叉，且 15:58 收盘价仍低于“昨日收盘计算的 MA5”，  
则于当日收盘通过 MOC 卖出部分 TQQQ。

验收点：

* decision\_time \= 15:58  
* fill\_time \= market close  
* MA5 使用 LAST\_CLOSED\_1D  
* 4H MACD 使用 last closed 4H bar  
* Trade.why 可完整解释

  ---

## **13\. Final Statement（定稿声明）**

本文档定义了 Vibe Trading System v0 的唯一后端语义标准。  
所有实现必须遵循本文档，不允许自行合理推断或扩展。

# 工程 Implementation Checklist

# **工程 Implementation Checklist**

## **0\. 全局约束（必须先确认）**

*  系统时区固定：America/New\_York  
*  使用 交易所日历（支持 DST / 提前收盘）  
*  禁止使用 EST / 本地时间 / UTC shortcut  
*  所有 lookback / window 必须带单位（禁止裸数字）

---

## **1\. NL → StrategySpec（Parser / SpecBuilder）**

### **输入**

*  支持 NaturalLanguageStrategyRequest  
*  支持 mode \= BACKTEST\_ONLY | PAPER | LIVE  
*  支持 overrides（universe / execution / risk）

### **输出：StrategySpec**

*  生成 strategy\_id  
*  生成 确定性的 strategy\_version（内容 hash）  
*  universe 明确区分：  
  *  signal\_symbol  
  *  trade\_symbol  
*  decision / execution / risk 字段齐全  
*  DSL 五层结构完整：  
  *  atomic  
  *  time  
  *  signal  
  *  logic  
  *  action

### **强制校验（失败即 VALIDATION\_ERROR）**

*  MA5 \= LAST\_CLOSED\_1D（禁止当日 MA）  
*  所有 lookback 带单位（如 "5d" / "20bars@4h"）  
*  timezone 只能是 America/New\_York

---

## **2\. Planner → ExecutionPlan**

### **ExecutionPlan 结构**

*  生成 decision\_schedule  
  *  type \= MARKET\_CLOSE\_OFFSET  
  *  offset \= \-2m  
  *  timezone \= America/New\_York

### **Node 编译（重点）**

对每个 node：

*  有 id  
*  有 type（DATA / INDICATOR / LOGIC / ACTION）  
*  显式声明 symbol \+ timeframe  
*  不允许 Runner / DataFactory 从 DSL 反推 symbol

❗️如果这里漏了 symbol / tf，直接算不合格

---

## **3\. Data Factory（数据层）**

### **数据真源**

*  1m 是唯一真源  
*  4H / 1D 只能由 1m 聚合  
*  禁止混用第三方 4H / 1D

### **4H 聚合规则（必须一致）**

*  使用 SESSION\_ALIGNED\_4H  
*  锚点 \= 交易所开盘（NYSE 09:30 ET）  
*  提前收盘日：最后一个 4H bar 自动缩短  
*  禁止 UTC / 自然日 resample

### **NDX Fallback**

*  若 NDX 分钟数据不可用 → fallback 到 QQQ  
*  在 DataHealth 中显式标记：  
  *  is\_fallback \= true  
  *  source \= fallback

### **DataHealth**

*  输出 missing\_ratio  
*  输出 gaps（即便 v0 先为空数组）

---

## **4\. Indicator Engine（信号层）**

### **通用规则**

*  所有指标 只使用已闭合 bar  
*  禁止未来函数

### **MA5**

*  tf \= 1d  
*  window \= "5d"  
*  bar\_selection \= LAST\_CLOSED\_1D  
*  align \= CARRY\_FORWARD

### **4H MACD**

*  使用 最近已闭合 4H bar  
*  值在 15:58 决策点 carry-forward

### **Event 语义（非常重要）**

*  MACD 死叉是 edge-triggered event  
*  只在发生的那个 4H bar 为 true  
*  不是持续状态

---

## **5\. Logic Engine（策略逻辑）**

*  支持 AND / OR / ALL / ANY  
*  逻辑只消费：  
  *  indicator 值  
  *  event  
*  不允许在 Logic 层直接访问原始数据

---

## **6\. Action → ExecutionIntent**

### **Quantity 解析**

*  支持 FRACTION\_OF\_POSITION  
*  qty 在 execution-time 计算

### **最小成交约束（必须）**

*  若 qty \< broker.min\_qty：  
  *  不下单  
  *  记录 log：qty\_too\_small  
  *  Action 视为 skipped（不是 failed）

### **幂等 & 冷却**

*  idempotency\_key \=

strategy\_version \+ trading\_day \+ action\_id

*   
*  cooldown \= 1 trading day  
*  cooldown 命中 → EXECUTION\_GUARD\_BLOCKED

---

## **7\. Backtest Engine（核心验收点）**

### **时间线（必须严格）**

*  decision\_time \= market\_close \- 2m  
*  order\_submit\_time \= decision\_time  
*  fill\_time \= market\_close

### **成交价**

*  使用当日收盘价（或提前收盘 close）  
*  应用 slippage \+ commission

### **Trade 结构（必须齐）**

*  decision\_time  
*  fill\_time  
*  fill\_price  
*  cost（slippage / commission）  
*  why：  
  *  macd\_4h\_cross  
  *  close\_15\_58  
  *  ma5\_last\_closed  
  *  signal\_symbol  
  *  is\_fallback

---

## **8\. Execution Service（Paper / Live）**

### **Paper**

*  复用 Backtest fill 逻辑  
*  订单 / 成交状态完整

### **Live（若启用）**

*  仅支持 MOC  
*  支持 reject / cancel  
*  与 Backtest 使用同一 idempotency 逻辑

---

## **9\. Workspace / Observability（前端强依赖）**

### **Workspace Steps（固定顺序）**

*  parse  
*  plan  
*  data  
*  backtest  
*  report  
*  deploy

### **Step 状态**

*  PENDING / RUNNING / DONE / FAILED / SKIPPED  
*  每 step 支持 logs\[\]

### **必备 Artifacts**

*  dsl.json  
*  plan.json  
*  inputs\_snapshot.json（必须）  
*  report.md  
*  equity.png

---

## **10\. Error Model（统一）**

*  VALIDATION\_ERROR  
*  DATA\_UNAVAILABLE  
*  EXECUTION\_GUARD\_BLOCKED  
*  INTERNAL

所有 API 错误必须返回 { code, message, details }

---

## **11\. v0 验收测试（必须跑通）**

策略：

QQQ 出现 4H MACD 死叉，且 15:58 close \< 昨日收盘 MA5 →  
MOC 卖出部分 TQQQ

### **验收点**

*  decision\_time \= 15:58  
*  fill\_time \= 收盘  
*  MA5 使用 LAST\_CLOSED\_1D  
*  4H MACD 使用 last closed 4H bar  
*  Trade.why 可完整解释

---

## **✅ 完成定义（Definition of Done）**

*  所有 checklist 项均可勾选  
*  不存在“工程自行理解”的行为  
*  回测结果可解释、可回放  
*  前端 Workspace 无需 hardcode 语义

# Schema 分层要求

# **Schema 分层要求**

## **1\. 总览分层**

| 层级 | Schema 名 | 角色 | 对前端/外部是否是 Contract | 备注 |
| ----- | ----- | ----- | ----- | ----- |
| API | NaturalLanguageStrategyRequest | POST /runs 请求体 | ✅ 是 | 前端直接构造 |
| API | RunStatusResponse（含 RunStatus \+ Workspace） | GET /runs/{id}/status | ✅ 是 | Workspace 驱动 UI |
| API | BacktestReportResponse（含 BacktestReport） | GET /runs/{id}/report | ✅ 是 | 报告页主数据 |
| API | DeploymentRequest | POST /runs/{id}/deploy 请求体 | ✅ 是 | 部署入口 |
| API | Deployment / DeploymentResponse | POST /runs/{id}/deploy 响应体 | ✅ 是 | 展示部署状态 |
| API | ErrorObject | 所有 4xx/5xx 错误 | ✅ 是 | 统一错误模型 |
| API-共享 | Workspace / WorkspaceStep / ArtifactRef / LogEntry | 嵌入在 RunStatus 中 | ✅ 是 | 前端按此渲染 steps/logs/artifacts |
| API-共享 | BacktestMetrics | BacktestReport 内部 | ✅ 是 | 前端图表 / KPI |
| API-共享 | Trade | BacktestReport 内部 | ✅ 是 | 交易明细表 |

---

## **2\. Internal Schema（对内使用，不视为前端 Contract）**

| 模块 | Schema 名 | Contract 归属 | 说明 |
| ----- | ----- | ----- | ----- |
| Strategy | StrategySpec | ❌ Internal | Parser 输出，后端内部标准，不承诺前端直接使用 |
| Strategy / DSL | AtomicLayer / TimeLayer / SignalLayer / LogicLayer / ActionLayer | ❌ Internal | 作为 StrategySpec.dsl 的细分 schema，前端只看 dsl.json artifact，不做编译耦合 |
| Planner | ExecutionPlan | ❌ Internal | plan.json 是 artifact，可变结构；只对 Runner/Worker 是 contract |
| Data | DataRequest | ❌ Internal | DataFactory 内部协议 |
| Data | Bar / BarSeries / DataHealth | ❌ Internal | 仅内部使用，外部只看到聚合结果（在 report / why 里） |
| Indicator | IndicatorJob / IndicatorSeries / EventSeries | ❌ Internal | 指标计算层内部结构 |
| Backtest | BacktestJob | ❌ Internal | Runner → BacktestEngine 内部结构 |
| Execution | ExecutionIntent | ❌ Internal | Logic → ExecutionService 内部结构 |
| Execution | Order / Fill | ❌ Internal | 仅 paper/live 执行层使用；前端只通过 Trade & 状态 artifact 间接看到 |
| Infra | Run（内部实体） | ❌ Internal | DB 模型；对外只暴露 RunStatus/Report/Deploy 三套 API 结构 |

---

## **3\. Contract 稳定性说明**

* 强稳定（尽量不改）  
  * 所有 API 层 schema：  
    * NaturalLanguageStrategyRequest  
    * RunStatusResponse（含 Workspace 结构）  
    * BacktestReportResponse（含 Trades / Metrics）  
    * DeploymentRequest / DeploymentResponse  
    * ErrorObject  
  * 改动需要：  
    * 版本协商（v0 → v1）  
    * 或向后兼容（仅增加可选字段）  
* 中等稳定（后端内部模块间的 contract）  
  * StrategySpec  
  * ExecutionPlan  
  * DataRequest / BarSeries / DataHealth  
  * ExecutionIntent  
  * 这些可以随 v0.x 优化，但要：  
    * 同步给所有 Worker / Service owner  
    * 确保 artifact（比如 dsl.json / plan.json）旧版本仍可读取或有 migrate  
* 低稳定（实现细节）  
  * IndicatorJob / IndicatorSeries / EventSeries  
  * BacktestJob  
  * Order / Fill  
  * 可以随着性能/实现优化调整，只要对上层 Trade、Report 的语义不变即可。

# Schema Json示例

## **Schema Json示例**

## **1\.** strategy\_spec.schema.json

（StrategySpec \+ DSL 五层，Internal Schema）

{ "$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "strategy\_spec.schema.json", "title": "StrategySpec", "type": "object", "required": \[ "strategy\_id", "strategy\_version", "name", "timezone", "calendar", "universe", "decision", "execution", "risk", "dsl", "meta" \], "properties": { "strategy\_id": { "type": "string" }, "strategy\_version": { "type": "string" }, "name": { "type": "string" }, "timezone": { "type": "string", "const": "America/New\_York" }, "calendar": { "type": "object", "required": \["type", "value"\], "properties": { "type": { "type": "string", "const": "exchange" }, "value": { "type": "string", "const": "XNYS" } } }, "universe": { "type": "object", "required": \["signal\_symbol", "trade\_symbol"\], "properties": { "signal\_symbol": { "type": "string" }, "signal\_symbol\_fallbacks": { "type": "array", "items": { "type": "string" } }, "trade\_symbol": { "type": "string" } } }, "decision": { "type": "object", "required": \["decision\_time\_rule"\], "properties": { "decision\_time\_rule": { "type": "object", "required": \["type", "offset"\], "properties": { "type": { "type": "string", "const": "MARKET\_CLOSE\_OFFSET" }, "offset": { "type": "string", "pattern": "^-?\[0-9\]+m$", "const": "-2m" } } } } }, "execution": { "type": "object", "required": \["model"\], "properties": { "model": { "type": "string", "enum": \["MOC"\] }, "slippage\_bps": { "type": "number", "default": 0 }, "commission\_per\_share": { "type": "number", "default": 0 }, "commission\_per\_trade": { "type": "number", "default": 0 } } }, "risk": { "type": "object", "properties": { "cooldown": { "type": "object", "required": \["scope", "value"\], "properties": { "scope": { "type": "string", "enum": \["SYMBOL\_ACTION"\] }, "value": { "type": "string" } } }, "max\_orders\_per\_day": { "type": "integer", "default": 1 } } }, "dsl": { "type": "object", "required": \["atomic", "time", "signal", "logic", "action"\], "properties": { "atomic": { "$ref": "\#/definitions/AtomicLayer" }, "time": { "$ref": "\#/definitions/TimeLayer" }, "signal": { "$ref": "\#/definitions/SignalLayer" }, "logic": { "$ref": "\#/definitions/LogicLayer" }, "action": { "$ref": "\#/definitions/ActionLayer" } } }, "meta": { "type": "object", "properties": { "created\_at": { "type": "string", "format": "date-time" }, "author": { "type": "string" }, "notes": { "type": "string" } } } }, "definitions": { "Duration": { "oneOf": \[ { "type": "string", "pattern": "^\[0-9\]+(d|h|m|s)$" }, { "type": "string", "pattern": "^\[0-9\]+bars@(1m|5m|15m|30m|1h|4h|1d)$" }, { "type": "object", "required": \["tf", "bars"\], "properties": { "tf": { "type": "string", "enum": \["1m", "5m", "15m", "30m", "1h", "4h", "1d"\] }, "bars": { "type": "integer", "minimum": 1 } } } \] }, "Timeframe": { "type": "string", "enum": \["1m", "5m", "15m", "30m", "1h", "4h", "1d"\] }, "AlignRule": { "type": "string", "enum": \["LAST\_CLOSED\_BAR", "CARRY\_FORWARD"\] }, "AtomicLayer": { "type": "object", "properties": { "symbols": { "type": "array", "items": { "type": "object", "required": \["name", "ticker"\], "properties": { "name": { "type": "string" }, "ticker": { "type": "string" } } } }, "constants": { "type": "object", "properties": { "sell\_fraction": { "type": "number", "minimum": 0, "maximum": 1, "default": 0.3 } }, "additionalProperties": true } } }, "TimeLayer": { "type": "object", "required": \["primary\_tf", "derived\_tfs", "session", "aggregation"\], "properties": { "primary\_tf": { "$ref": "\#/definitions/Timeframe" }, "derived\_tfs": { "type": "array", "items": { "$ref": "\#/definitions/Timeframe" } }, "session": { "type": "object", "required": \["calendar", "timezone"\], "properties": { "calendar": { "type": "string", "const": "XNYS" }, "timezone": { "type": "string", "const": "America/New\_York" } } }, "aggregation": { "type": "object", "properties": { "4h": { "type": "object", "required": \["source\_tf", "bar\_close\_rule", "align"\], "properties": { "source\_tf": { "type": "string", "const": "1m" }, "bar\_close\_rule": { "type": "string", "const": "SESSION\_ALIGNED\_4H" }, "align": { "$ref": "\#/definitions/AlignRule" } } }, "1d": { "type": "object", "required": \["source\_tf", "bar\_close\_rule", "align"\], "properties": { "source\_tf": { "type": "string", "const": "1m" }, "bar\_close\_rule": { "type": "string", "const": "EXCHANGE\_DAILY" }, "align": { "$ref": "\#/definitions/AlignRule" } } } }, "additionalProperties": true } } }, "SignalIndicator": { "type": "object", "required": \["id", "symbol\_ref", "tf", "type", "params", "align"\], "properties": { "id": { "type": "string" }, "symbol\_ref": { "type": "string" }, "tf": { "$ref": "\#/definitions/Timeframe" }, "type": { "type": "string" }, "params": { "type": "object" }, "align": { "$ref": "\#/definitions/AlignRule" } } }, "SignalEvent": { "type": "object", "required": \["id", "type"\], "properties": { "id": { "type": "string" }, "type": { "type": "string", "enum": \["CROSS", "THRESHOLD"\] }, "left": { "type": "object" }, "right": { "type": "object" }, "direction": { "type": "string", "enum": \["UP", "DOWN", "ANY"\] }, "scope": { "type": "string", "enum": \["LAST\_CLOSED\_4H\_BAR", "LAST\_CLOSED\_1D", "BAR"\] } } }, "SignalLayer": { "type": "object", "properties": { "indicators": { "type": "array", "items": { "$ref": "\#/definitions/SignalIndicator" } }, "events": { "type": "array", "items": { "$ref": "\#/definitions/SignalEvent" } } } }, "LogicCondition": { "type": "object", "properties": { "all": { "type": "array", "items": { "$ref": "\#/definitions/LogicCondition" } }, "any": { "type": "array", "items": { "$ref": "\#/definitions/LogicCondition" } }, "not": { "$ref": "\#/definitions/LogicCondition" }, "event\_id": { "type": "string" }, "scope": { "type": "string" }, "op": { "type": "string", "enum": \["\<", "\<=", "\>", "\>=", "==", "\!="\] }, "left": { "type": "object" }, "right": { "type": "object" } }, "additionalProperties": false }, "LogicRule": { "type": "object", "required": \["id", "when", "then"\], "properties": { "id": { "type": "string" }, "when": { "$ref": "\#/definitions/LogicCondition" }, "then": { "type": "array", "items": { "type": "object", "required": \["action\_id"\], "properties": { "action\_id": { "type": "string" } } } } } }, "LogicLayer": { "type": "object", "properties": { "rules": { "type": "array", "items": { "$ref": "\#/definitions/LogicRule" } } } }, "Action": { "type": "object", "required": \[ "id", "type", "symbol\_ref", "side", "qty", "order\_type" \], "properties": { "id": { "type": "string" }, "type": { "type": "string", "enum": \["ORDER"\] }, "symbol\_ref": { "type": "string" }, "side": { "type": "string", "enum": \["BUY", "SELL"\] }, "qty": { "type": "object", "required": \["mode"\], "properties": { "mode": { "type": "string", "enum": \[ "FRACTION\_OF\_POSITION", "ABSOLUTE", "NOTIONAL\_USD" \] }, "value": { "type": "number" }, "value\_ref": { "type": "string" } } }, "order\_type": { "type": "string", "enum": \["MOC"\] }, "time\_in\_force": { "type": "string", "enum": \["DAY"\], "default": "DAY" }, "cooldown": { "$ref": "\#/definitions/Duration" }, "idempotency\_scope": { "type": "string", "enum": \["DECISION\_DAY"\] } } }, "ActionLayer": { "type": "object", "properties": { "actions": { "type": "array", "items": { "$ref": "\#/definitions/Action" } } } } } }

---

## **2\.** run\_api.schema.json

（/runs \+ /runs/{id}/status，API Contract）

{ "$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "run\_api.schema.json", "title": "Run API Schemas", "type": "object", "definitions": { "NaturalLanguageStrategyRequest": { "type": "object", "required": \["input\_type", "nl", "mode"\], "properties": { "input\_type": { "type": "string", "enum": \["NATURAL\_LANGUAGE"\] }, "nl": { "type": "string" }, "mode": { "type": "string", "enum": \["BACKTEST\_ONLY", "PAPER", "LIVE"\] }, "as\_of": { "type": "string", "format": "date-time" }, "overrides": { "type": "object", "properties": { "universe": { "type": "object", "properties": { "signal\_symbol": { "type": "string" }, "trade\_symbol": { "type": "string" } } }, "execution": { "type": "object", "properties": { "model": { "type": "string", "enum": \["MOC"\] }, "slippage\_bps": { "type": "number" } } }, "risk": { "type": "object", "properties": { "cooldown": { "type": "string" } } } }, "additionalProperties": true } }, "additionalProperties": false }, "ErrorObject": { "type": "object", "required": \["code", "message"\], "properties": { "code": { "type": "string", "enum": \[ "VALIDATION\_ERROR", "DATA\_UNAVAILABLE", "EXECUTION\_GUARD\_BLOCKED", "INTERNAL" \] }, "message": { "type": "string" }, "details": { "type": "object" } } }, "LogEntry": { "type": "object", "required": \["ts", "level", "msg"\], "properties": { "ts": { "type": "string", "format": "date-time" }, "level": { "type": "string", "enum": \["DEBUG", "INFO", "WARN", "ERROR"\] }, "msg": { "type": "string" }, "kv": { "type": "object" } } }, "ArtifactRef": { "type": "object", "required": \["id", "type", "name", "uri"\], "properties": { "id": { "type": "string" }, "type": { "type": "string", "enum": \["json", "markdown", "image", "csv", "binary"\] }, "name": { "type": "string" }, "uri": { "type": "string" } } }, "WorkspaceStep": { "type": "object", "required": \["id", "state", "label"\], "properties": { "id": { "type": "string" }, "state": { "type": "string", "enum": \["PENDING", "RUNNING", "DONE", "FAILED", "SKIPPED"\] }, "label": { "type": "string" }, "progress": { "type": "number", "minimum": 0, "maximum": 1 }, "started\_at": { "type": "string", "format": "date-time" }, "ended\_at": { "type": "string", "format": "date-time" }, "logs": { "type": "array", "items": { "$ref": "\#/definitions/LogEntry" } } } }, "Workspace": { "type": "object", "properties": { "steps": { "type": "array", "items": { "$ref": "\#/definitions/WorkspaceStep" } }, "artifacts": { "type": "array", "items": { "$ref": "\#/definitions/ArtifactRef" } } } }, "RunStatusResponse": { "type": "object", "required": \["run\_id", "status", "updated\_at", "workspace"\], "properties": { "run\_id": { "type": "string" }, "status": { "type": "string", "enum": \["CREATED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"\] }, "updated\_at": { "type": "string", "format": "date-time" }, "workspace": { "$ref": "\#/definitions/Workspace" }, "error": { "$ref": "\#/definitions/ErrorObject" } } }, "RunCreateResponse": { "type": "object", "required": \["run\_id", "status", "workspace"\], "properties": { "run\_id": { "type": "string" }, "status": { "type": "string", "enum": \["CREATED", "RUNNING", "FAILED"\] }, "strategy\_id": { "type": "string" }, "strategy\_version": { "type": "string" }, "workspace": { "$ref": "\#/definitions/Workspace" } } } } }

---

## **3\.** backtest\_report.schema.json

（/runs/{id}/report，API Contract）

{ "$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "backtest\_report.schema.json", "title": "Backtest Report", "type": "object", "definitions": { "BacktestMetrics": { "type": "object", "properties": { "cagr": { "type": "number" }, "max\_drawdown": { "type": "number" }, "sharpe": { "type": "number" }, "trades": { "type": "integer" }, "decision\_days": { "type": "integer" }, "trade\_days": { "type": "integer" } } }, "Trade": { "type": "object", "required": \[ "decision\_time", "fill\_time", "symbol", "side", "qty", "fill\_price" \], "properties": { "decision\_time": { "type": "string", "format": "date-time" }, "fill\_time": { "type": "string", "format": "date-time" }, "symbol": { "type": "string" }, "side": { "type": "string", "enum": \["BUY", "SELL"\] }, "qty": { "type": "number" }, "fill\_price": { "type": "number" }, "cost": { "type": "object", "properties": { "slippage": { "type": "number" }, "commission": { "type": "number" } } }, "why": { "type": "object" } } }, "ArtifactRef": { "type": "object", "required": \["id", "type", "name", "uri"\], "properties": { "id": { "type": "string" }, "type": { "type": "string", "enum": \["json", "markdown", "image", "csv", "binary"\] }, "name": { "type": "string" }, "uri": { "type": "string" } } }, "BacktestReportResponse": { "type": "object", "required": \["run\_id", "summary", "metrics", "trades"\], "properties": { "run\_id": { "type": "string" }, "summary": { "type": "object", "properties": { "strategy\_name": { "type": "string" }, "mode": { "type": "string" }, "symbols": { "type": "object", "properties": { "signal": { "type": "string" }, "trade": { "type": "string" } } }, "decision\_time\_rule": { "type": "string" }, "execution\_model": { "type": "string", "enum": \["MOC"\] } } }, "metrics": { "$ref": "\#/definitions/BacktestMetrics" }, "trades": { "type": "array", "items": { "$ref": "\#/definitions/Trade" } }, "artifacts": { "type": "array", "items": { "$ref": "\#/definitions/ArtifactRef" } } } } } }

---

## **4\.** deployment\_api.schema.json

（/runs/{id}/deploy，API Contract）

{ "$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "deployment\_api.schema.json", "title": "Deployment API", "type": "object", "definitions": { "DeploymentRequest": { "type": "object", "required": \["target"\], "properties": { "target": { "type": "string", "enum": \["PAPER", "LIVE"\] }, "effective\_from": { "type": "string", "format": "date" }, "broker": { "type": "object", "properties": { "name": { "type": "string" } } }, "guards": { "type": "object", "properties": { "require\_backtest\_succeeded": { "type": "boolean" }, "max\_daily\_orders": { "type": "integer" } } } }, "additionalProperties": false }, "DeploymentResponse": { "type": "object", "required": \["deployment\_id", "run\_id", "status", "scheduler"\], "properties": { "deployment\_id": { "type": "string" }, "run\_id": { "type": "string" }, "status": { "type": "string", "enum": \["DEPLOYED", "DISABLED"\] }, "scheduler": { "type": "object", "properties": { "decision\_time\_rule": { "type": "string" }, "timezone": { "type": "string" } } } } } } }

---

## **5\.** data\_internal.schema.json

（DataFactory 内部，Internal Schema）

{ "$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "data\_internal.schema.json", "title": "Data Internal", "type": "object", "definitions": { "DataRequest": { "type": "object", "required": \["symbol", "timeframe", "start", "end"\], "properties": { "symbol": { "type": "string" }, "timeframe": { "type": "string", "enum": \["1m", "5m", "15m", "30m", "1h", "4h", "1d"\] }, "start": { "type": "string", "format": "date-time" }, "end": { "type": "string", "format": "date-time" }, "calendar": { "type": "string" } } }, "Bar": { "type": "object", "required": \["start", "end", "open", "high", "low", "close"\], "properties": { "start": { "type": "string", "format": "date-time" }, "end": { "type": "string", "format": "date-time" }, "open": { "type": "number" }, "high": { "type": "number" }, "low": { "type": "number" }, "close": { "type": "number" }, "volume": { "type": "number" } } }, "DataGap": { "type": "object", "properties": { "start": { "type": "string", "format": "date-time" }, "end": { "type": "string", "format": "date-time" }, "bars\_missing": { "type": "integer" } } }, "DataHealth": { "type": "object", "properties": { "source": { "type": "string" }, "is\_fallback": { "type": "boolean", "default": false }, "missing\_ratio": { "type": "number" }, "gaps": { "type": "array", "items": { "$ref": "\#/definitions/DataGap" } } } }, "BarSeries": { "type": "object", "required": \["symbol", "timeframe", "bars"\], "properties": { "symbol": { "type": "string" }, "timeframe": { "type": "string" }, "bars": { "type": "array", "items": { "$ref": "\#/definitions/Bar" } }, "health": { "$ref": "\#/definitions/DataHealth" } } } } }

---

## **6\.** plan\_internal.schema.json

（ExecutionPlan，Internal Schema）

{ "$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "plan\_internal.schema.json", "title": "ExecutionPlan", "type": "object", "definitions": { "PlanNode": { "type": "object", "required": \["id", "type"\], "properties": { "id": { "type": "string" }, "type": { "type": "string", "enum": \["DATA", "INDICATOR", "LOGIC", "ACTION"\] }, "symbol": { "type": "string" }, "timeframe": { "type": "string" }, "inputs": { "type": "array", "items": { "type": "string" } }, "outputs": { "type": "array", "items": { "type": "string" } }, "config": { "type": "object" } } }, "ExecutionPlan": { "type": "object", "required": \["version", "decision\_schedule", "nodes"\], "properties": { "version": { "type": "string" }, "decision\_schedule": { "type": "object", "required": \["type", "offset", "timezone"\], "properties": { "type": { "type": "string", "enum": \["MARKET\_CLOSE\_OFFSET"\] }, "offset": { "type": "string", "pattern": "^-?\[0-9\]+m$" }, "timezone": { "type": "string" } } }, "nodes": { "type": "array", "items": { "$ref": "\#/definitions/PlanNode" } } } } } }

---

## **7\.** execution\_internal.schema.json

（ExecutionIntent / Order / Fill，Internal Schema）

{ "$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "execution\_internal.schema.json", "title": "Execution Internal", "type": "object", "definitions": { "ExecutionIntent": { "type": "object", "required": \[ "symbol", "side", "qty", "order\_type", "time\_in\_force", "decision\_time", "idempotency\_key" \], "properties": { "symbol": { "type": "string" }, "side": { "type": "string", "enum": \["BUY", "SELL"\] }, "qty": { "type": "number" }, "order\_type": { "type": "string", "enum": \["MOC"\] }, "time\_in\_force": { "type": "string", "enum": \["DAY"\] }, "decision\_time": { "type": "string", "format": "date-time" }, "idempotency\_key": { "type": "string" }, "metadata": { "type": "object" } } }, "Order": { "type": "object", "required": \[ "order\_id", "symbol", "side", "qty", "order\_type", "status" \], "properties": { "order\_id": { "type": "string" }, "symbol": { "type": "string" }, "side": { "type": "string", "enum": \["BUY", "SELL"\] }, "qty": { "type": "number" }, "order\_type": { "type": "string", "enum": \["MOC"\] }, "status": { "type": "string", "enum": \["NEW", "SUBMITTED", "FILLED", "REJECTED", "CANCELED"\] } } }, "Fill": { "type": "object", "required": \["order\_id", "fill\_time", "fill\_price", "qty"\], "properties": { "order\_id": { "type": "string" }, "fill\_time": { "type": "string", "format": "date-time" }, "fill\_price": { "type": "number" }, "qty": { "type": "number" } } } } }

# 代码-Prompt示例

# **代码示例**

# **1\. NL Strategy Parser**

NL API 层 (/runs)  
   ↓  
ParserService（你定义的接口）  
   ├─ LlmClient（对接 OpenAI / 内部模型）  
   ├─ OutputValidator（用 strategy\_spec.schema.json 校验）  
   └─ DefaultFiller（把所有默认值写进 StrategySpec）  
注意点：

1. LlmClient：只负责 prompt \+ 调模型 \+ 拿回 raw JSON/string。  
2. ParserService：  
   * 负责重试、限流、缓存（同一 NL 文本不重复烧钱）。  
   * 出口只有两种结果：  
     * 成功 → 完整 StrategySpec  
     * 失败 → 标准 VALIDATION\_ERROR 或 INTERNAL。  
3. 其他模块（Planner / Runner / Backtest）不认识 LLM，只认识 StrategySpec。

## **1.1 模块结构**

ParserService  
├── LlmClient  
│   └── call(prompt) \-\> raw\_text  
├── PromptBuilder  
│   └── build(nl\_text, context) \-\> prompt  
├── JsonExtractor  
│   └── extract(raw\_text) \-\> dict  
├── SchemaValidator  
│   └── validate(dict, strategy\_spec.schema.json)  
├── DefaultResolver  
│   └── fill\_defaults(dict) \-\> StrategySpec  
└── Cache  
    └── get/set(hash(nl\_text))

## **1.2 核心接口定义**

### **1.2.1. ParserService 接口**

class ParserService: def parse\_nl( self, user\_id: str, request: NaturalLanguageStrategyRequest ) \-\> StrategySpec: ...

保证：

* 返回的一定是 schema-valid \+ fully-resolved 的 StrategySpec  
* 或直接抛结构化错误

---

### **1.2.2 LlmClient（最小能力）**

class LlmClient: def call(self, prompt: str, timeout\_s: int \= 20) \-\> str: """ \- 只负责调用模型 \- 不关心策略语义 \- 不做 JSON 校验 """

实现里可以是 OpenAI / Azure / 内部模型，Parser 不关心。

## **1.3 主流程伪代码（重点）**

def parse\_nl(self, user\_id, request): *\# 0\. 缓存（省钱 & 稳定）* cache\_key \= hash(user\_id \+ request.nl) cached \= cache.get(cache\_key) if cached: return cached *\# 1\. 构建 Prompt* prompt \= PromptBuilder.build( nl\_text=request.nl, context={ "timezone": "America/New\_York", "execution\_model": "MOC", "rules": \[ "MA5 must be LAST\_CLOSED\_1D", "decision\_time \= market\_close \- 2m", "lookback must include units" \] } ) *\# 2\. 调用 LLM* try: raw\_text \= llm\_client.call(prompt) except TimeoutError: raise InternalError("LLM\_TIMEOUT") *\# 3\. 提取 JSON* try: raw\_dict \= JsonExtractor.extract(raw\_text) except Exception: raise ValidationError("INVALID\_LLM\_OUTPUT") *\# 4\. Schema 校验（强）* errors \= SchemaValidator.validate( raw\_dict, schema="strategy\_spec.schema.json" ) if errors: raise ValidationError( message="StrategySpec schema validation failed", details=errors ) *\# 5\. 填默认值（非常关键）* spec \= DefaultResolver.fill\_defaults(raw\_dict) *\# 6\. 强制写死规则再校验一遍* self.\_enforce\_hard\_rules(spec) *\# 7\. 写 meta* spec.meta\["parser\_version"\] \= "nl\_v1" spec.meta\["llm\_model"\] \= "gpt-4.1" spec.meta\["source"\] \= "nl" *\# 8\. 缓存* cache.set(cache\_key, spec) return spec

## **1.4 Hard Rules（二次校验，不能只信 LLM）**

def \_enforce\_hard\_rules(self, spec: StrategySpec): assert spec.timezone \== "America/New\_York" *\# MA5* for ind in spec.dsl.signal.indicators: if ind.type \== "SMA" and ind.params.get("window") \== "5d": assert ind.params.get("bar\_selection") \== "LAST\_CLOSED\_1D" *\# decision time* assert spec.decision.decision\_time\_rule.type \== "MARKET\_CLOSE\_OFFSET" assert spec.decision.decision\_time\_rule.offset \== "-2m" *\# lookback 单位* for ind in spec.dsl.signal.indicators: assert lookback\_has\_unit(ind.params)

## 

## **1.5 Prompt模板**

要求这里的输入输出按照规定json格式  
主要目的就是从用户的自然语言中抓取关键词，对策略进行填充

### **1.5.1. System Prompt（一次性配置）**

You are a trading strategy compiler. Your job: \- Convert natural language trading strategy descriptions into a STRICT JSON object called StrategySpec. \- StrategySpec MUST be fully specified and valid according to the provided rules. \- You are NOT allowed to leave fields ambiguous or "to be defined later". VERY IMPORTANT: \- You MUST obey all "Hard Rules" below, even if the user's description is ambiguous or contradicts them. \- If the user description conflicts with a Hard Rule, you MUST follow the Hard Rule and still produce a consistent StrategySpec. Hard Rules (Vibe Trading v0): 1\) Timezone is always "America/New\_York". 2\) Exchange calendar is always "XNYS" (US equities). 3\) Decision time is always "market\_close \- 2 minutes": \- normal day: 15:58 ET \- early close: close\_time \- 2 minutes 4\) Execution model is always "MOC" (Market-On-Close): \- Orders decided at decision\_time. \- Fills occur at the official market close price for the day. 5\) MA5 definition is FIXED: \- MA5 is based on LAST\_CLOSED 1D bars (end of yesterday's session). \- Never use today's partially formed 1D bar for MA5. 6\) Timeframes: \- Primary timeframe: 1m. \- 4h and 1d bars MUST be aggregated from 1m data. \- 4h bars are aligned to the trading session (SESSION\_ALIGNED\_4H), starting from session open. 7\) Multi-timeframe alignment: \- For decision at 15:58: \* 1m values use the last closed 1m bar at or before 15:58. \* 4h indicators use the last CLOSED 4h bar (carry-forward semantics). \* 1d indicators use LAST\_CLOSED\_1D (yesterday’s close). 8\) Lookback windows MUST always include units, such as "5d", "20bars@4h", or { "tf": "4h", "bars": 5 }. \- Bare integers without units are NOT allowed. 9\) Signals MUST NOT use future information: \- You can only use bars that are fully closed as of the decision\_time. Universe & Symbols: \- There is always at least one "signal" symbol and one "trade" symbol. \- If the user does not explicitly specify, assume: \- signal\_symbol \= "QQQ" \- trade\_symbol \= "TQQQ" \- You may add additional internal symbol references ("signal", "trade") but the underlying tickers must be clear. Events: \- CROSS events are edge-triggered: \- A MACD bearish cross (macd\_bear\_cross) is TRUE only at the bar where MACD crosses below its signal. \- It is NOT a persistent boolean state. Your output: \- MUST be valid JSON. \- MUST match the StrategySpec skeleton described below. \- MUST be syntactically correct (parsable JSON). \- MUST not contain comments or trailing commas. StrategySpec skeleton (high-level): { "strategy\_id": "string", "strategy\_version": "string (you may leave an empty string)", "name": "string", "timezone": "America/New\_York", "calendar": { "type": "exchange", "value": "XNYS" }, "universe": { "signal\_symbol": "QQQ", "signal\_symbol\_fallbacks": \["NDX", "QQQ"\], "trade\_symbol": "TQQQ" }, "decision": { "decision\_time\_rule": { "type": "MARKET\_CLOSE\_OFFSET", "offset": "-2m" } }, "execution": { "model": "MOC", "slippage\_bps": 2, "commission\_per\_share": 0.0, "commission\_per\_trade": 0.0 }, "risk": { "cooldown": { "scope": "SYMBOL\_ACTION", "value": "1d" }, "max\_orders\_per\_day": 1 }, "dsl": { "atomic": { ... }, "time": { ... }, "signal": { ... }, "logic": { ... }, "action": { ... } }, "meta": { "created\_at": "2026-01-01T00:00:00Z", "author": "nl\_user", "notes": "" } } Atomic layer: \- Define symbol references and constants (e.g. sell\_fraction). Time layer: \- primary\_tf: "1m" \- derived\_tfs: \["4h", "1d"\] \- aggregation for 4h and 1d as described in the Hard Rules. Signal layer: \- indicators\[\]: each with {id, symbol\_ref, tf, type, params, align} \- events\[\]: for cross/down logic (e.g. "macd\_bear\_cross"). Logic layer: \- rules\[\]: each with {id, when, then\[\]} \- when: boolean expression built from events and indicator comparisons. Action layer: \- actions\[\]: each with {id, type, symbol\_ref, side, qty, order\_type, ...} \- For partial sells, use: { "id": "sell\_trade\_symbol\_partial", "type": "ORDER", "symbol\_ref": "trade", "side": "SELL", "qty": { "mode": "FRACTION\_OF\_POSITION", "value": 0.3 }, "order\_type": "MOC", "time\_in\_force": "DAY", "cooldown": "1d", "idempotency\_scope": "DECISION\_DAY" } IMPORTANT: \- When the user’s description is vague, you MUST choose reasonable, consistent defaults that respect the Hard Rules. \- Never ask follow-up questions; always return a complete StrategySpec. Output instructions: \- Output ONLY the JSON object. \- DO NOT include any explanation, commentary, markdown, or backticks. \- If you need to approximate something, choose a clear, concrete value.  
---

### **1.5.2 User Prompt 模板（在代码里填充的那一层）**

假设你在后端拿到 request.nl（用户自然语言描述），以及可能的 user\_id、模式等，可以这样构造 user message：

User natural language strategy description: "{nl\_text}" Additional context: \- mode: "{mode}" \# e.g. BACKTEST\_ONLY / PAPER / LIVE \- user\_id: "{user\_id}" \# do NOT include PII, use internal id only Task: 1\) Read the strategy description above. 2\) Infer a concrete, executable StrategySpec that follows all Hard Rules. 3\) Fill in all required fields, including: \- universe (signal\_symbol, trade\_symbol) \- decision rules \- execution model (MOC) \- risk (cooldown, max\_orders\_per\_day) \- DSL layers: atomic, time, signal, logic, action 4\) Make sure the DSL implements the described behavior as closely as possible. For this specific product (Vibe Trading v0), always: \- Use "QQQ" as signal symbol and "TQQQ" as trade symbol if the user does not specify. \- Use 1m data as the primary timeframe, and aggregate 4h and 1d from 1m. \- For MA5, always use LAST\_CLOSED\_1D (yesterday’s close) and window "5d". \- For MACD(4h), compute on 4h bars and use the last CLOSED 4h bar at decision time. \- Define at least one logic rule that connects the signals to the actions. Example user intent (for your reference of style): \- "When 4H MACD on QQQ turns bearish and the 15:58 close is still below the 5-day moving average (based on yesterday’s close), sell part of my TQQQ position into the close." IMPORTANT: \- Return ONLY the JSON of StrategySpec. \- Do not wrap it in quotes or Markdown. \- The JSON MUST be syntactically valid.

# **2\. 回测引擎关键（多周期对齐 / MOC / 成本 / 幂等 / cooldown）**

## **2.1. 多周期对齐：4H carry-forward 到 15:58**

def get\_decision\_timestamp(trading\_day, calendar): close\_ts \= calendar.market\_close(trading\_day) *\# handles early close \+ DST* return close\_ts \- timedelta(minutes=2) *\# 15:58 or early\_close-2m* def last\_closed\_bar(bars\_tf, ts): *\# bars\_tf: list of bars with \[start, end, ohlc\]* *\# return the bar whose end \<= ts and is the latest* return max(\[b for b in bars\_tf if b.end \<= ts\], key=lambda b: b.end) def compute\_signals\_at(decision\_ts): *\# 1m close at 15:58* bar\_1m \= last\_closed\_bar(bars\_1m, decision\_ts) close\_1m \= bar\_1m.close *\# 4h MACD uses LAST\_CLOSED\_4H bar, then carry-forward* bar\_4h \= last\_closed\_bar(bars\_4h, decision\_ts) macd\_val, macd\_sig \= macd\_series\_4h.value\_at(bar\_4h.end), macd\_series\_4h.signal\_at(bar\_4h.end) macd\_cross\_down \= crossed\_down(macd\_series\_4h, macd\_signal\_4h, at=bar\_4h.end) *\# MA5 uses LAST\_CLOSED\_1D (yesterday)* bar\_1d\_last\_closed \= last\_closed\_bar(bars\_1d, decision\_ts).previous\_trading\_day\_bar ma5 \= sma(bars\_1d\_close, window=5, end\_at=bar\_1d\_last\_closed.end) return { "close\_1m": close\_1m, "macd\_cross\_down": macd\_cross\_down, "ma5\_last\_closed": ma5 }

注：previous\_trading\_day\_bar 必须走日历（周末/假期跳过），保证“截至昨日收盘”。

## **2.2. 15:58 决策 \+ MOC 成交（fill 用 close）**

def simulate\_day(trading\_day): decision\_ts \= get\_decision\_timestamp(trading\_day, calendar) signals \= compute\_signals\_at(decision\_ts) decision \= (signals\["macd\_cross\_down"\] and (signals\["close\_1m"\] \< signals\["ma5\_last\_closed"\])) if decision: order \= build\_order(symbol="TQQQ", side="SELL", qty=fraction\_of\_position(0.3), order\_type="MOC") *\# fill at market close* fill\_ts \= calendar.market\_close(trading\_day) fill\_price \= bars\_1m\_close\_at("TQQQ", fill\_ts) *\# or daily close if easier* fill\_price \= apply\_slippage(fill\_price, side="SELL", bps=slippage\_bps) cost \= commission\_model(order) execute\_fill(order, fill\_ts, fill\_price, cost, decision\_ts, why=signals)

## **2.3. 成本/滑点模型（v0 简化）**

def apply\_slippage(price, side, bps): *\# SELL gets worse: price \* (1 \- bps/10000)* mult \= (1 \- bps/10000) if side \== "SELL" else (1 \+ bps/10000) return price \* mult

## **2.4. 幂等 \+ cooldown（避免重复卖）**

def idempotency\_key(strategy\_version, trading\_day, action\_id): return f"{strategy\_version}:{trading\_day}:{action\_id}" def can\_fire(action\_id, trading\_day): *\# cooldown "1d" \=\> if already fired today, block* return not store.exists(idempotency\_key(strategy\_version, trading\_day, action\_id)) def mark\_fired(action\_id, trading\_day): store.put(idempotency\_key(strategy\_version, trading\_day, action\_id), True) *\# in runner:* if decision and can\_fire("sell\_trade\_symbol\_partial", trading\_day): place\_order(...) mark\_fired(...)

[image1]: <data:image/png;base64,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>

[image2]: <data:image/png;base64,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>