# 省 Token 方案 · 调研

> 2026-10-01 · 只做调研与整理，未改任何代码
> 依据：① Headroom 官方文档（本机安装的 `headroom-ai 0.39.1` 自带完整 README + docs.headroomlabs.ai）② 本机 `/stats` 与 hub 用量日志实测 ③ 开源方案横向调研

---

## 0. 结论速览

**① 「省 token」这件事已有一个 74k★ 的成熟开源项目在做，而且它做的正是你认为对的那件事。**
Headroom（`headroomlabs-ai/headroom`，**74,230★**，Apache-2.0，2026-10-01 仍在提交）的核心设计叫
**live-zone compression**——「**只压新增的字节，冻结前缀逐字节不变，所以上游缓存活着**」。
这基本就是你昨晚实测结论（「压历史是净亏、只压增量才净赚」）的工程化版本。

**② 但你这条链路上真正的杠杆不在压缩，在缓存命中率。**
本机 `/stats` 实测（31 次请求）：只有 **6 次**发生过压缩，总共省 **714 token**；同期
**72,816 token 是按全价（未命中缓存）计费的，缓存命中率仅 11.6%**。
压缩省下的 714 token 只有未命中体积的 **0.98%**。
→ **把命中率从 11.6% 拉回 90%，比任何压缩算法都值钱。**

**③ 最没被利用的开关是「输出压缩」。**
Headroom 有 `HEADROOM_OUTPUT_SHAPER`（**默认关**，你也没开），官方估算可砍 **31.7% 输出 token**；
而输出单价在你这条链路上约为输入未命中的 **3–4 倍**，且输出**永远不可能被缓存**。

**④ 不要自研压缩内核。** 该做的不是重造 headroom，而是「把已有能力用对 + 把『省了多少』变成可验证的数字」。

**⑤ 修正我昨晚的结论。** 我当时说「headroom 省钱价值 ≈ 0」，**用词过重**。准确表述：
**在探针那种短对话负载上它几乎不压（官方文档解释了原因），在工具输出密集的 agent 负载上才发力；
而你的实测显示，真正没赚到的钱不在压缩，在缓存命中。**

---

## 1. 先把「省 token」拆成四本账

用本机 hub 用量日志反推的 credit 口径（同一条链路、同一模型 `deepseek-v4.1-flash`）：

| 账 | 相对单价 | 本链路实测样本 |
|---|---|---|
| 输入 · **命中上游缓存** | **≈ 1/12**（官方文档标价是 1/50） | 8032 token → **0.01** credit |
| 输入 · **未命中** | **1.0** | 8032 token → **0.12** credit；4336 → 0.06 |
| **输出** | **≈ 3–4** | 由 credit 反推（见 §3.4，非精确） |
| **请求级跳过**（语义/精确缓存） | **0** | 本链路未启用 |

三条推论决定了所有方案的排序：

1. **一份 token 一旦被上游缓存，再发几乎免费**（还顺带省了 TTFT 和带宽）。
   → **任何方案都不得重写「已经发出去过」的字节。这是地基，不是优化项。**
2. **输出 token 单价是输入未命中的 3–4 倍，且不可能被缓存。**
   → 压输出是「单位收益最高」的杠杆，此前完全没动。
3. **压缩只在「这段内容本来就要冷读」时才净赚。**
   → 只压「新增量」= 白赚；改写历史 = 拿 1/12 的缓存价换 1.0 的全价，净亏。

> 一句话判据：**压 1 个「本来已缓存」的 token，省 2 分赔 100 分；压 1 个「本来就要冷读」的 token，省 100 分赔 0。**

---

## 2. Headroom 官方文档要点（0.39.1 自带 README + 官方 docs）

### 2.1 定位与量级

| 项 | 值 |
|---|---|
| 仓库 | `headroomlabs-ai/headroom`（**74,230★**，Apache-2.0，最后提交 2026-10-01） |
| 官方 Slogan | The Context Optimization Layer for LLM Applications — **Cut costs by 50-90%** |
| GitHub 简介里的真实数字 | **"20% fewer tokens for coding agents, 60-95% fewer tokens for JSON, same answers"** |
| 形态 | Library（`compress()`）· **Proxy**（`headroom proxy --port 8787`）· `headroom wrap <agent>` · MCP server |
| 本地性 | 压缩全程在本机，prompt/文件内容不出本机 |

### 2.2 流水线

```
CacheAligner → ContentRouter → CCR
                 ├─ SmartCrusher    (JSON / 数组)
                 ├─ CodeCompressor  (AST, tree-sitter, 11 语言)
                 └─ Kompress-v2-base(text, 自研 HF 模型, ModernBERT ONNX)
```

- **CacheAligner**：标记「会破坏 provider KV-cache 前缀」的易变内容。官方原文：
  **"It never rewrites prompts."**（只打标、不改写）
- **ContentRouter**：判内容类型，路由到对应压缩器。
- **CCR（Compress-Cache-Retrieve）**：**可逆压缩**——压缩后把原文存本地、注入
  `headroom_retrieve` 工具，模型需要时取回。这是解决「有损压缩丢信息」风险的范式。

### 2.3 ★ 核心机制：live-zone（官方原文，最该记住的一段）

> **Live-zone compression — only new bytes are compressed (fresh tool output, the latest turn).
> The frozen prefix stays byte-identical, so the provider cache survives, and history is never dropped.**

Context Management 页进一步说明：

> Headroom **never drops messages**… compresses only the **newest content blocks**（最新用户消息 + 最新的 tool result）。
> The **cache hot zone** — the system prompt, tool definitions, and older turns — **is never mutated**.
> Leaving the prefix untouched preserves provider prompt caching, so cache hit rates stay stable across turns.

→ 这就是你实测结论的官方版本。**「只压增量」不是权宜之计，是 headroom 的核心设计。**

### 2.4 官方效果数字（都是本机可复现的 seed 基准）

| 场景 | Before | After | 省 |
|---|---:|---:|---:|
| Code search（100 条结果） | 17,199 | 13,597 | **21%** |
| SRE incident debugging | 55,957 | 24,340 | **57%** |
| Codebase exploration | 58,801 | 33,895 | **42%** |
| GitHub issue triage | 46,067 | 32,429 | **30%** |

按内容类型的单样本压缩率（Limitations 页）：

| 内容类型 | 压缩率 | 说明 |
|---|---|---|
| JSON · 字符串数组（路径/日志行/标签） | **~95%** | 去重 + 采样 |
| JSON · 数字数组（指标/时序） | **~97%** | 统计摘要 |
| JSON · 对象数组（搜索结果/API/DB 行） | **~52%** | 主力场景 |
| JSON · 混合类型数组 | ~45% | 分组后各自压 |
| 结构化日志 | 差异极大 | 取决于重复度 |
| **纯文本 / 散文** | **很少** | 需 optional 的 kompress ML 路径，且**增加延迟** |
| **代码** | **直通（passthrough）** | 见下 |
| **RAG 上下文** | **直通** | 不压 |
| Agent 多轮会话 | 官方称「本页未独立测量」 | break-even ~ 净赚 |

**压缩开销**：0.21ms p50（10K token JSON），1.4ms（100K）——延迟可忽略。

**质量**：GSM8K 0.870→0.870（N=100）、TruthfulQA 0.530→0.560、SQuAD v2 97%@19% 压缩、BFCL 97%@32% 压缩。

### 2.5 它**不**压什么（这解释了你的 0%）

- 短消息（`min_tokens_to_compress` 默认 50；`coding` 预设调到 10）
- **源码**——直通（`protect_recent_code=4`：最近 4 条消息里的代码不压；
  `protect_analysis_context=True`：最近一条用户消息含 analyze/review/explain/fix/debug **则全文代码都不压**）
- **grep / search 结果**——已是紧凑格式
- **图片**——按固定 ~1600 token 计，不压
- **系统提示**——为兼容前缀缓存而保留
- 数组 <5 项、内容 <200 token、仅含 bool 的数组、无数组值的 JSON 对象、坏 JSON（静默直通）

> 官方自己列的「Headroom 加值很少」场景：**短对话交换、纯代码会话（读/写文件）、单轮无累积上下文**。

### 2.6 ★ 输出侧省 token（默认关闭，你没开）

- **Verbosity steering**：在**系统提示末尾**追加一段「简洁点、别复述上下文」的短提示
  —— 放末尾是为了**让前缀缓存继续命中**。
- **Effort routing**：当一轮只是「工具结果回来后继续」时（读文件、跑通测试）**下调思考强度**；
  新问题与报错保持全强度。
- **两条都作用于 OpenAI 兼容的 `/v1/chat/completions` 与 `/v1/responses`**（我们这条链路正是）。
- 开关：`export HEADROOM_OUTPUT_SHAPER=1`（**off by default**）
- 官方数字：`headroom output-savings` → **`Reduction: 31.7% (95% CI 27.7% … 35.7%) [estimated]`**
  —— 输出节省是**反事实**的（看不到模型「本来会写什么」），所以官方标 `[estimated]`；
  要实测就设 `HEADROOM_OUTPUT_HOLDOUT=0.1` 留出 10% 对照。

### 2.7 两个必须知道的默认值

| 开关 | 默认 | 说明 |
|---|---|---|
| `HEADROOM_TELEMETRY` | **off**（opt-in） | 本地聚合，不出机器 |
| `HEADROOM_BEACON` | **⚠️ on（opt-out）** | 上传匿名压缩统计（token 数/压缩比/跳过原因/模型 id/OS 架构），**不含 prompt、代码、路径**。`HEADROOM_BEACON=off` / `DO_NOT_TRACK=1` / `--offline` 关闭 |

> 本机部署脚本已设 `HEADROOM_TELEMETRY=off` + `HEADROOM_OFFLINE=1`，beacon 应已关闭——但**建议显式再写一行 `HEADROOM_BEACON=off`**，因为它 fail-open（不认识的值会上传）。

### 2.8 官方给「无压缩」用户的建议（有争议）

`/stats` 的 `tip` 字段原文：

> **"Most requests are prefix-frozen. Set `HEADROOM_MODE=token` to compress frozen messages and extend your session by ~25-35%."**

注意它的措辞是 **"extend your session"（延长会话）**，不是 "save money"。
官方把 `token` 模式定位成**上下文窗口扩容**手段——这与我们实测一致（重压历史会丢缓存）。
**但这条建议在我们这条链路上是有代价的：重写历史 = 全价重读。别照抄。**

### 2.9 一个值得注意的旁证

官方 Limitations 页明写：**「LLMLingua is not part of Headroom 0.37.0」**——
headroom 早期用过 LLMLingua（`[llmlingua]` extra），在 0.9.x 就被移除，现在文本压缩走自研 Kompress。
**一个 74k★ 项目主动把 LLMLingua 拿掉，是它性价比不高的强信号。**

---

## 3. 本机实测：你这条链路的真实数字

### 3.1 `/stats`（`http://127.0.0.1:8787/stats`，uptime ≈ 3.8h，31 次 API 请求）

```
mode: cache        savings_profile: coding
compress_user_messages: true     compress_system_messages: false
min_tokens_to_crush: 10          protect_recent: 0

compression:
  requests_compressed     : 6 / 31
  avg_compression_pct     : 4.1
  best_compression_pct    : 4.1        (best_detail: 2,925 → 2,806)
  total_tokens_removed    : 714
  total_tokens_before     : 92,625
uncompressed_requests     : { prefix_frozen: 16 }

prefix_cache (totals):
  requests                : 21
  hit_requests            : 3
  hit_rate                : 11.6 %      ← ★ 关键数字
  cache_read_tokens       : 19,072
  uncached_input_tokens   : 72,816      ← ★ 全价计费的部分
  bust_count              : 0
  new_input_tokens        : 145,655
  new_input_saved_tokens  : 714  (0.49 %)
  read_discount           : "50%"       ← headroom 用的是通用默认值
  cache_pricing_source    : "provider_default"   ← 所以它的美元数字对本链路无效

tokens.output             : 631
tokens.output_saved       : 0          ← 输出压缩没开
tokens.active_savings_percent : 1.23

compression_vs_cache: { tokens_saved_by_compression: 714, tokens_lost_to_cache_bust: 0, net: +714 }
compressions_by_strategy: { text: 4, code_aware: 7 }
```

### 3.2 三个结论

1. **压缩不是主要矛盾。** 省 714 token vs 全价计费 72,816 token —— **0.98%**。
2. **缓存命中率才是。** 21 次请求只有 3 次命中（11.6%）。一个健康的多轮 agent 会话，
   命中率应该 85%+（只有新增量是冷的）。**每把一段 4336 token 从冷读变命中，credit 从 0.06 → 0.01。**
3. **`bust_count = 0`** —— headroom 没有破坏缓存（这点它是清白的，符合设计）。

> ⚠️ **诚实说明**：这 31 次请求几乎全是探针/测试流量（短对话、无大段工具输出、每轮前缀都在变）。
> 上表能证明的是「**在短对话负载上压缩几乎不发生**」，**不能**用来推断真实 WorkBuddy agent 会话的压缩率。
> **要下结论，必须在真实 agent 会话上跑一轮采集**（见 §6 的采集器）。

### 3.3 与昨晚「压完更贵」那次实测的对照（保留）

| 请求 | prompt token | 命中缓存 | credit |
|---|---:|---:|---:|
| 未压缩（命中缓存） | 4,336 | 4,096 | **0.01** |
| headroom 压缩 78.5% 后 | 1,213 | **0** | **0.02** |

token 只剩 28%，账单翻倍——因为压缩产生的是**全新前缀**，缓存全失效。
（附注：这是探针场景；在 cache 模式下 headroom 的常态是 `bust_count=0`，即这属于少数情形。）

### 3.4 credit 口径反推（供参考，非精确）

用最小二乘拟合 hub 日志：`credit ≈ 1.38e-5 × 未命中输入 + 4.2e-5 × 输出`，即
**输出 ≈ 输入未命中的 3 倍**（另有 0.01 取整底）。与官方定价（输出 $0.60 / 输入未命中 $0.15 = 4×）方向一致。

---

## 4. 横向调研：其他开源方案

> star 数均于 2026-10-01 经 GitHub API 核实。标注「未核实」的条目来自二手来源，采用前需自行验证。

### 4.1 提示词压缩（有损，prompt compression）

| 项目 | 仓库 | ★ | 原理 | 效果 | 局限 |
|---|---|---:|---|---|---|
| **LLMLingua / LongLLMLingua / LLMLingua-2** | `microsoft/LLMLingua` | **6,720** (MIT) | 小模型按困惑度删低信息 token；v2 改用编码器做 token 二分类 | 宣称最高 20×；LLMLingua-2 为 2–5× 且快 1.6–2.9× | **有损**；需跑小模型；**压缩比不稳定**；对结构化/分类任务损伤大 |
| Selective Context | `liyucheng09/Selective_Context` | 未核实 | 自信息过滤 | ~50% 上下文缩减 | 仓库疑似停滞（2024） |
| RECOMP | `carriex/recomp` | 未核实 | 抽取式 + 抽象式摘要，**用答案正确率做训练信号** | RAG 上下文可压到 ~5% | **需训练压缩器** |
| 500xCompressor | `ZongqianLi/500xCompressor` | 未核实 | 软提示，把 ~500 token 压成 1 个 KV | 6×–480× | **需训练 LoRA**；绑定特定底座 |

**关于「20× 无痛」这个说法的核实**：该结论**只在精选 reasoning / RAG 数据集上成立**。
二手来源（arXiv 2505.00019，未核实）称 LLMLingua 系在长 prompt（>8000 token）下**压缩比不达标**、
对结构化任务损伤最高可达 50%+。
**本机旁证**：Tamp 的 README 直接给了 LLMLingua-2 的真实翻车例子——
**「LLMLingua-2 paraphrases, and a paraphrased file path is a broken file path」**（改写会打碎文件路径）。
**最强旁证**：headroom 自己把 LLMLingua 移除了（§2.9）。

→ **结论：优先级最低。** 且即便用，也只能对「新增量」用；对本链路还有破坏缓存的额外风险。

### 4.2 KV cache 压缩 —— **整类不可用**

| 项目 | 原理 | 省 token/省钱？ | 能用于「只调 API」？ |
|---|---|---|---|
| H2O / SnapKV / StreamingLLM / KIVI / PyramidKV… | 在推理引擎内驱逐/量化 KV 张量 | **不减少计费 token**，只省显存、降 TTFT | **不能** |

**明确结论**：这一整类需要在模型服务侧操作 KV 张量，**你只能调 API、拿不到权重 → 整类不可用**。
你能间接利用的是**上游的 prefix caching**（靠「保持前缀字节不变」去命中），这正是 §1 的地基。

### 4.3 语义缓存 / 精确缓存

| 项目 | 仓库 | ★ | 原理 | 省 token | 局限 |
|---|---|---:|---|---|---|
| GPTCache | `zilliztech/GPTCache` | **8,207** (MIT) | 查询向量化 + 相似度检索，命中则**整次调用跳过** | 高重叠场景 50–90% 成本下降 | 需 embedding + 向量库；误命中风险 |
| LiteLLM caching | `BerriAI/litellm` | 未核实 | 网关层响应缓存（Redis/内存/S3） | 省整次调用 | **响应缓存 ≠ prefix 缓存**，别混淆 |
| Helicone / Portkey | … | 未核实 | 代理式可观测 + 响应/语义缓存 | 省重复调用 | 缓存是**整响应级** |

**关键区分**：**语义缓存**（跳过整次调用）与 **provider prefix 缓存**（仍调用但输入更便宜）是两层，可叠加。
**语义缓存对「每轮都在变的 agent 会话」命中率极低**；对「大量用户问相似问题」才是主力。
→ **对你这个场景，语义缓存基本无效。**

### 4.4 上下文管理 / 记忆层（agent 侧）

| 项目 | 仓库 | ★ | 是否省 token | 局限 |
|---|---|---:|---|---|
| Claude Code `/compact`（+API compaction） | Anthropic 官方 | — | 省，但有损 | **重写历史 = 破坏 prefix cache**；「摘要的摘要」会退化 |
| mem0 | `mem0ai/mem0` | **66,422** (Apache-2.0) | 二手来源称 ~90%（每次检索 ~6.9k vs 全量 ~26k） | 需 LLM 抽取（本身花钱）；**架构级改造，非代理套壳** |
| Letta / MemGPT、Zep / Graphiti | … | 未核实 | 省（避免全量历史入上下文） | 需把 agent 跑在其 runtime；冷启动重 |

→ **记忆层确实省 token，但省的是「长期历史常驻」的成本，属于架构改造，与「套在链路中间的代理」目标不契合。**

### 4.5 工具输出 / 大块内容的处理 ★ 最相关

| 项目 | 仓库 | ★ | 原理 | 效果 |
|---|---|---:|---|---|
| **Headroom** | `headroomlabs-ai/headroom` | **74,230** | CacheAligner + live-zone + CCR 可逆压缩 | 官方：编码 agent 20%、JSON 60–95% |
| **Tamp** | `sliday/tamp` | **92** (未标 license，活跃 2026-09) | 本地 HTTP 代理，多级流水线压 `tool_result` | 宣称 **52.6% 输入 / 60–70% 含输出** |
| repomix | `yamadashy/repomix` | **28,634** (MIT) | 打包整个仓库为单文件，tree-sitter 提签名 | 官方称压缩模式 ~70%——但是**打包工具**，不拦运行时 |
| TokenJuice | openclaw PR#155 | — | 确定性规则引擎压工具输出，**零 LLM** | 未核实 |

**Tamp 的流水线值得单独看**（它比 headroom 更"手艺人"，几个 stage 很有参考价值）：

| stage | 做法 | 备注 |
|---|---|---|
| `cmd-strip` | 剥进度条/spinner | **无损** |
| `minify` | 去 JSON 空白 | **无损** |
| `toon` | **数组列式编码** | **无损** |
| `strip-lines` | 去行号前缀 | **无损** |
| `whitespace` | 折叠空行 | **无损** |
| `dedup` | 重复内容换引用 | **无损** |
| `diff` | **相似的重读换成 diff** | **无损**，收益极大 |
| `prune` | 删低价值元数据 | 近无损 |
| `llmlingua` | 神经压缩 | **有损**，需 Python sidecar |
| `graph` | 会话级去重（同一文件读两次 → 第二次 **-99%**） | opt-in |
| `px-render` | **把密集 tool_result 渲染成 PNG 图片块** | opt-in；图片 token 按像素计价，4–64KB 的 grep/代码块可降 ~80% |

**★ Tamp 最重要的一段原文（与我们实测完全一致）**：

> `stale-inputs` and `stale-images` **rewrite older turns, which invalidates the prompt cache.
> Both stay opt-in for that reason; weigh the token saving against cache-read pricing.**

→ **两个独立项目（headroom 的 live-zone、Tamp 的 stale-* 开关）都独立得出了同一个结论：
「动历史 = 毁缓存，必须默认关」。** 这不是我们的猜测，是这个领域的共识。

### 4.6 缓存友好型网关

| 项目 | 有「保上游 prefix cache」能力？ | 说明 |
|---|---|---|
| LiteLLM | ✅ | 可为**不带 cache_control 的客户端**自动在 system + 末尾轮注入缓存断点（`enable_anthropic_prompt_caching`）。**它自己不改写前缀**。 |
| OpenRouter | ✅ | **sticky routing**：传稳定 `session_id` 把同会话请求粘回持暖缓存的同一端点 |
| Portkey / Helicone | ⚠️ 部分 | 以响应/语义缓存为主；**未见**主动保前缀稳定的能力 |
| Higress / llm-d / GKE Inference Gateway | ✅ 但需自托管推理 | 按最长前缀路由到同一 pod —— **不适用于你调官方 API** |

**对你的可用要点**：真正能帮上的是「① 不改写已发送前缀 ② 网关层别引入破坏前缀的变量
③（可选）为不设 cache_control 的客户端补断点」。

### 4.7 谁明确在做「只压增量、不动已缓存前缀」？

| 项目 | 原文证据 |
|---|---|
| **Headroom** | ① CacheAligner：*"flags volatile content that would bust a provider KV-cache prefix. **It never rewrites prompts.**"* ② live-zone：*"**only new bytes are compressed**… The frozen prefix stays **byte-identical**, so the provider cache survives."* |
| **Tamp** | 会重写历史的 `stale-inputs` / `stale-images` **默认关**，并明确说明「会破坏 prompt cache」 |

→ **有，而且不止一个。你的判断是对的，而且已经是这个领域的共识。**

---

## 5. 按 ROI 排序的杠杆清单

| 优先级 | 杠杆 | 本链路量级 | 现状 | 说明 |
|---|---|---|---|---|
| **L1** | **提高上游 prefix cache 命中率**（保持前缀字节稳定） | **最大**：命中 vs 未命中 = **1 : 12** | 命中率仅 **11.6%** ← **主战场** | 不新增依赖，只需「不让易变内容进前缀」。headroom 的 CacheAligner 只**标记**不修，真正的活在这里。 |
| **L2** | 压 live-zone 新增内容（工具输出/JSON/日志） | headroom 实测 **0.5–4%**（探针负载）；官方编码 agent **20%**、JSON 60–95% | 已启用 | headroom 已做到位，别重造。 |
| **L3** | **压输出 token** | 官方估 **31.7% 输出**；输出单价 = 输入未命中的 **3–4×** | **未启用**（`HEADROOM_OUTPUT_SHAPER` 默认关） | **单位收益最高且零改造**。唯一的"免费午餐"。 |
| **L4** | 请求级（语义/精确）缓存 | 0（整次跳过） | 未启用 | 对 agent 会话命中率极低，**不建议投入**。 |
| **L5** | 记忆层（mem0/Zep） | 大，但省的是「长期历史常驻」 | 未启用 | **架构级改造**，与「代理套壳」目标不契合。 |
| **L6** | LLMLingua 类有损提示词压缩 | 宣称 2–20×，实测争议大 | 未启用 | **伤质量 + 毁缓存，优先级最低**。headroom 自己已移除它。 |

---

## 6. 对「自研 skill」的形态建议（待你拍板，尚未动手）

**先说不要做什么**：不要重写压缩内核（headroom 74k★ 已经把它做到位了，做不过它）；
不要碰 KV cache 压缩（拿不到权重）；不要做语义缓存（agent 会话用不上）。

**三个候选形态：**

**形态 A —— 缓存命中率管家（推荐，命中 L1，收益最大）**
一个「诊断 + 修复」工具，而不是压缩器：
- **诊断**：把 hub 日志与 headroom `/stats` 合成一个「每次请求为什么没命中」的归因表
  （`system_sha` / `prefix_sha` / `msgs_sha` 的变化点就是元凶）。
- **修复**：定位并消除客户端 payload 里的**缓存破坏源**——时间戳、随机 id、每次都变的
  system prompt、顺序不固定的工具定义、浮动的 memory 注入。
- **验收**：把命中率从 11.6% 抬到 80%+，并用 credit 账单核验。

**形态 B —— 输出瘦身器（低成本高收益，命中 L3）**
- 打开并**校验** `HEADROOM_OUTPUT_SHAPER`（含 `HEADROOM_OUTPUT_HOLDOUT=0.1` 做实测对照），
  再按本链路的真实单价换算成 credit 省了多少。
- 注意：verbosity steering 是往**系统提示末尾**加的——要确认它不会破坏前缀。

**形态 C —— 统一「省钱账本」（作为 A/B 的必需配套）**
- 现在三个数字源各说各话：hub 的 `credit`（真实账单）、headroom 的 `/stats`（假设 50% 折扣、美元数字无意义）、
  `~/.headroom/proxy_savings.json`（`unpriced` 占位价）。
- 做一个**以 credit 为准的单一口径**——否则所有优化都无法验收。

> **我的建议**：**A + C 为主，B 作为 A 的第一个动作。** 一句话概括这个 skill 的价值主张：
> **「不是帮你压缩上下文，而是帮你把上游缓存真正吃满，并告诉你省了多少 credit。」**

---

## 7. 需要修正的既有结论

| 位置 | 原文 | 问题 | 建议 |
|---|---|---|---|
| `iskill-headroom-workbuddy2api/SKILL.md`（今晚新加的一节） | 「本链路上 headroom 的『省钱』价值 ≈ 0」 | 结论建立在**探针流量**上（短对话、无大工具输出），不能代表真实 agent 会话；官方文档证明压缩效果**强依赖负载类型** | 补一句限定：「该结论来自短对话探针负载；工具输出密集时官方实测可达 20%（编码 agent）～57%（SRE 排障）」 |
| `scripts/start.sh` 的注释 | 「cache 模式…**不做有损压缩**」 | 与事实不符（cache 模式会压 live zone 的新增量，只是不重写历史） | 改为「只压最新增量，不重写历史」 |
| 本 skill 对 headroom 的定位 | 隐含「省 token 的压缩代理」 | 真正的杠杆是**缓存命中率**，压缩只占 1% 量级 | 改写为**双价值**：hub 让内置模型「用得上」，headroom 让它「跑得远」 |

> **2026-10-01 归档时的落地状态**
> - 第 1 条 **已落地**：`SKILL.md` 那句已补「强依赖负载类型」的限定（编码 agent 20% / JSON 60–95%），并指向本文件。
> - 第 2 条 **已落地**：`scripts/start.sh` 的注释改为「只压最新增量，不重写历史」。
> - 第 3 条 **2026-10-02 已落地**：定位改写为双价值（见上表末行）；`78.5%` 主卖点已从落地页撤下，
>   换成 `1 : 12` 上游缓存杠杆与 `0 次抓包`。
> - 第 3 条 **待拍板**：本 skill 是否重新定位为「缓存命中率管家」，尚未改动。

---

## 8. 附录：数据来源与复现

| 数据 | 来源 / 命令 |
|---|---|
| headroom 完整官方 README | `~/.iskill-headroom-workbuddy2api/venv/.../headroom_ai-0.39.1.dist-info/METADATA`（正文即 README） |
| headroom 在线文档索引 | `https://docs.headroomlabs.ai/llms.txt` |
| 本机省 token 统计 | `curl http://127.0.0.1:8787/stats`（重点看 `prefix_cache`、`compression`、`tokens`、`config`） |
| 本机逐笔节省事件 | `~/.headroom/savings_events.jsonl`（字段 `before/after/saved/cache`） |
| 本机逐请求账单 | `~/.iskill-headroom-workbuddy2api/hub-usage/usage.jsonl`（字段 `prompt_tokens/cached_tokens/credit/prefix_sha/system_sha`） |
| 仓库数据核实 | `gh api repos/<owner>/<repo> --jq '.stargazers_count,.pushed_at,.license.spdx_id'` |

**待补的一次关键验证**：在**真实 WorkBuddy agent 会话**（含大段工具输出）上跑一轮采集，
拿到真实的「压缩率 + 缓存命中率」，再决定 A/B/C 的投入顺序。**目前所有压缩率结论都建立在探针流量上。**
