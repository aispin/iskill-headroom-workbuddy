# 文档（`docs/`）

本目录放 `iskill-headroom-workbuddy2api` 的**调研与设计文档**——仅供阅读，不是运行时依赖，删掉不影响脚本。

| 文档 | 说明 |
|---|---|
| [`token-savings-research.md`](token-savings-research.md) | **省 Token 方案调研**（2026-10-01）：headroom 官方文档要点、四本账单价口径、本机 `/stats` 实测、开源横向对比、按 ROI 排序的杠杆、自研形态 A/B/C |

> ⚠️ **别把这个目录当落地页的发布源。** `iskill-promo-page` 的 `init.mjs --out docs`
> 会往这里铺站点（对非空目录默认拒写，加 `--force` 就会和调研文档混在一起，并随 Pages 一起公开）。
> 本仓库发布落地页请用 `promo-page/` + GitHub Actions 工作流。

## 本技能的定位（2026-10-02 定稿，**已执行**）

调研结论是 **本链路真正的杠杆是上游缓存命中率（命中 vs 未命中 ≈ 1 : 12），压缩只占 1% 量级**。
据此把定位从「省 token 的压缩代理」改写为**双价值**，一句话：

> **hub 让内置模型「用得上」，headroom 让它「跑得远」。**

| 价值 | 组件 | 一句话 |
|---|---|---|
| 能用 | workbuddy2api-hub | 私有协议转 OpenAI + 看板 OAuth 加账号 + 多账号双区域调度 + 每日保活 |
| 耐用 | Headroom | 冻结前缀守住上游缓存（命中 = 未命中的 2%）+ 只压最新增量 → 会话跑得更远 |

**已同步的四处**（原「待拍板清单」）：

1. `SKILL.md` frontmatter `description` + 开篇新增「一句话定位」双价值表；
2. `README.md` 首段 + 职责表（`8787` / `8788` 两行的「带来什么」重写）；
3. 对外文案 `promo-page/assets/content.js`（中英各 6 处）与 `dashboard/src/i18n/dict.ts`（`app.desc` 中英 + `chain.headroom.desc`）；
4. **`78.5%` 主卖点已撤下** —— 那次压缩的代价是前缀重写 → `cached_tokens=0` → 账单翻倍，
   与调研结论相冲；换成 **`1 : 12` 上游缓存杠杆** + **`0 次抓包`**（hub 的差异化价值）。

> 顺带纠了两处事实错误：① `SKILL.md` 曾写「普通 user/assistant 文本消息一律算稳定（不可压）」——
> 实际活区内 user 消息**是**压缩目标（`coding` 档 `compress_user_messages=true`），真正的分界是**有没有活区**；
> ② `/stats` 的 `prefix_cache.read_discount` 按 provider 默认猜成 `50%`（DeepSeek 实为 98%），
> 导致面板把缓存省下的钱算成 0。
