# iskill-headroom-workbuddy

把 WorkBuddy 桌面端内置模型接成一个**任何人都能用的 OpenAI 兼容 API**，供 WorkBuddy / Cursor / 任意 OpenAI 客户端使用。

> **一句话定位：hub 让内置模型「用得上」，headroom 让它「跑得远」。**

```
WorkBuddy 客户端 → Headroom(:8787 守住缓存 + 压增量) → workbuddy2api-hub(:8788 转换) → 官方内置模型
```

| 端口 | 角色 | 带来什么 |
|---|---|---|
| `8788` | **workbuddy2api-hub** | 私有协议转 OpenAI + 看板 OAuth 加账号 + 多账号双区域调度 + 每日保活 —— **没有它，内置模型根本接不出来** |
| `8787` | **Headroom** | 冻结历史前缀**守住上游 prompt cache**（命中 = 未命中的 2%），只压**最新那条增量** —— 让会话**跑得更远、更省** |
| `8786` | 本技能控制台 | 链路健康 / 加账号 / 生效 Key / 日志（可选） |

> 完整操作说明见 `SKILL.md`；**省 token 方案的调研已归档在 `docs/token-savings-research.md`**
> （headroom 官方文档 + 本机实测 + 开源横向对比，结论：真正的杠杆是**上游缓存命中率**，不是压缩比）。
> 本文件侧重**归档「自动获取 WorkBuddy token」的整套探索经验**，以备将来复用。

---

## 一、为什么会有这份存档

早期方案（syh0119/workbuddy2api）要求用户手工提供 `CODEBUDDY_AUTH_TOKEN`——即桌面端登录后的 Bearer。为了免去「开 F12 手抄 token」，我们对 WorkBuddy 桌面端做了完整的逆向与抓包实验，产出了 5 条可行/不可行路线（见第二节）。

**现在这一环已经被上游解决**：`workbuddy2api-hub` 自带看板 OAuth 加账号，点一次官方登录链接即自动入库，并且有定时调度器每日 22:00 自动 refresh token 保活。所以本技能**不再需要抓包**。

但抓包经验本身是可复用的（任何 Electron/Chromium 应用的 `Authorization` 抓取、任意应用的本机凭据取证），故完整留档于此，脚本原件在 `references/legacy-token-capture/`。

---

## 二、路线速查表（结论先行）

| # | 路线 | 可行性 | 结论 |
|---|---|---|---|
| A | 直接读桌面端凭据文件 | ✗ | 自 2026-09-24 起改为 `$wbEncrypted` 信封（AES-256-GCM）加密存储，无密钥无法解密 |
| B | 挂 CDP 到桌面端抓 `Network.requestWillBeSent` | ✗（对本应用） | 机制本身 100% 可行（已用真实 Chrome 验证），但 WorkBuddy 的模型请求**不经过 renderer 网络栈**，CDP 永远抓不到 |
| C | Chromium **netlog** 抓请求头 | ✓ | 机制已端到端验证成功；覆盖整个 Chromium 网络栈，无需 CA/代理。**当时首选** |
| D | MITM 代理（`--proxy-server` + `--ignore-certificate-errors`） | ？ | 未实测的兜底方案，对 Node 侧请求同样有效，但需装 CA |
| E | **上游 OAuth 加账号** | ✓✓ | 当前采用。免抓包、免维护 token，且有自动保活 |

---

## 三、路线 A 复盘：凭据加密链完全逆向（据此判定 A 不可行）

WorkBuddy 桌面端（VSCode 系 CodeBuddy Electron 应用）把登录态写在：

```
~/Library/Application Support/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info
```

内容形态为「信封」：

```json
{"$wbEncrypted": 1,
 "envelope": "<base64( {suite:1, keyId:"<16位hex>", nonce, authTag, ciphertext} )>"}
```

### 加解密参数（从 `app.asar` 的可读 ESM 中还原）

| 项 | 值 |
|---|---|
| 算法 | `aes-256-gcm`，`authTagLength: 16` |
| 密钥派生 | `protectorKey = SHA-256(atRestSecretKey)`（`atRestSecretKey` 是 32 字节的 base64 字符串） |
| keyId | `SHA-256(protectorKey).hex[0:16]` |
| AAD | `"WB-AAD\0" + [1] + lenPrefixed(formatId) + lenPrefixed("sym-v1") + uint32(suite) + lenPrefixed(keyId) + [framingCode] + [0] + [0]` |
| framingCode | 字段用 `WBEV1`/2，整文件用 `WBEF1`/1 |
| context 约束 | `sym-v1` 只允许 `{framing}`，**禁止 fieldPath**（故 AAD 可精确构造） |

### 密钥封装链

```
~/.workbuddy/keyblob = {"version":1,"keyId":"c21e24c1aa670272",
                        "slots":[{"type":"static-v1",
                                  "protectorKeyId":"9127dea1b44020a7",
                                  "wrapped":"<envelope>"}]}
```

即：**protector key**（keyId `9127dea1b44020a7`）解封出 **at-rest 主密钥**（`c21e24c1aa670272`），后者才是真正加密 auth 字段的密钥。

### 为什么解不开（决定性卡点）

- `atRestSecretKey` **不落盘、也不在任何进程环境变量里**。env 里只有策略 `WORKBUDDY_AT_REST_ENCRYPTION=fields`，那**不是密钥**。
- 密钥由原生层 `electron.workbuddyStorage.loggerGet()` 持有，经凭据引导 socket（`CODEBUDDY_SIDECAR_CREDENTIAL_BOOTSTRAP_SOCKET`）在运行时下发。
- 用 **keyId 反查验证器**（`sha256(候选) → 须等于 9127dea1b44020a7`）扫描了 App 二进制（`Electron Framework`）与全部 JS 包（`app.asar`、`codebuddy-headless.js`、`codebuddy-lite-wb.mjs`）里所有 44 字符 base64 候选——**全部不命中**，证明它不是明文常量。
- 附带结论：`codebuddy-headless.js` 是完整的 CodeBuddy CLI，但**脱离 App 单独跑会卡死**（拿不到凭据引导），印证密钥由 App 注入。

> 复用小工具：`references/legacy-token-capture/` 未包含，但逻辑很简单——把候选当作 `atRestSecretKey`，算 `sha256` 取 hex 前 16 位与 keyId 比对。这是「不试错就能排除候选」的利器。

---

## 四、路线 B 复盘：CDP 抓包（机制可行，但本应用抓不到）

### 机制已验证成功（真实 Chrome 端到端）

用 puppeteer 缓存的 Chrome 以 `--remote-debugging-port=9222` 启动 → CDP 连上 → 建 page target → `attachToTarget` → `Network.enable` → 页面发一个带 `Authorization: Bearer <marker>` 的请求，成功在 `Network.requestWillBeSent` 里抓到该头：

```
[✓] 抓到 Network.requestWillBeSent -> Authorization: Bearer DEMO_TOKEN_ABC123_XYZ
```

### 但对 WorkBuddy 桌面端失效（结构性原因）

- 桌面端**未开调试端口**（`9222/9229` ECONNREFUSED、高位端口 `49223` 返回 HTTP 404、无 `DevToolsActivePort` 文件），需重启带参。
- 即使重启带参（`enable_cdp.sh` 实测 `CDP 就绪: http://127.0.0.1:9222`，`Chrome/138.0.7204.251`），`get_token_cdp.mjs` 只能 attach 到 `file:///Applications/WorkBuddy.app/...` 这类扩展页面——**监听期永远等不到模型请求**。
- 根因：WorkBuddy 是 VSCode 系应用，**模型请求不经 renderer 页面**（走扩展宿主 / 主进程），CDP 在结构上就抓不到。v2 脚本加了 `Target.setDiscoverTargets` 动态挂载懒创建的 webview，依然抓不到。

> 结论：CDP 抓包用于**普通网页/Web 应用**很好用；用于**Electron 扩展宿主发起的请求**会失效，别再浪费时间。

---

## 五、路线 C 复盘：Chromium netlog（已端到端验证 ✓，当时首选）

### 原理

```
--log-net-log=<file> --net-log-capture-mode=IncludeSensitive
```

会把**请求头（含 `Authorization`）**完整写进 netlog JSON。相比 CDP：
- 覆盖**整个 Chromium 网络栈**（主进程 net / renderer / iframe / webview），不依赖「挂对 target」
- **不需要装 CA、不需要代理**

已用真实 Chrome 验证：页面发一条带 `Authorization: Bearer <marker>` 的请求 → netlog 完整记录该头，解析脚本命中并还原出请求 URL。

### 用法

```bash
# 1) 一次性以「抓包参数」重启目标应用（本技能归档脚本针对 WorkBuddy.app）
bash references/legacy-token-capture/enable_cdp.sh
#    它同时开两条通道：
#      CDP   : --remote-debugging-port=9222 --enable-remote-debugging-webview
#      netlog: --log-net-log=<runtime>/netlog.json --net-log-capture-mode=IncludeSensitive

# 2) 在应用里触发一次目标请求（如发一条消息）

# 3) 解析 netlog 取 Bearer
node references/legacy-token-capture/get_token_netlog.mjs --verbose
#    --file <path>  指定 netlog（调试）
#    --dry-run      只打印不写文件

# 4) ⚠️ 用完立刻关掉抓包（不关会一直写）
bash references/legacy-token-capture/enable_cdp.sh --restore
bash references/legacy-token-capture/enable_cdp.sh --status   # 复核
```

### ⚠️ netlog 是「常驻」的，不是一次性的

这一步当时踩得很实：**抓包开关跟着进程一直活着**，不重启应用就不会停。
2026-10-01 复盘时发现桌面端已连续抓了约 2.5 小时，`netlog.json` 涨到 **80 MB**（≈ 9 KB/s ≈ 0.7 GB/天），
且文件里含**明文 `Authorization: Bearer` 与 Cookie**（前 8 MB 就扫到 12 处 Bearer）。

所以：

- 开启期间应用的所有网络请求（含令牌明文）都在落盘 → **用完必须 `--restore`**。
- `--restore` 会不带任何参数重启应用，并删除 netlog 文件。
- 技能主 `status.sh` 会主动检测并告警（输出末尾的「桌面端仍在抓包」）。
- 正常情况**根本不需要开这个** —— 加账号走 hub 看板的 OAuth，不碰桌面端 token。

### 工程要点（踩过的坑）

- **netlog 是流式写入的**，强杀/崩溃会截断成不完整 JSON。解析器必须**容错**：截到最后一条完整事件补 `]}` 还原。归档脚本已实现（实测能从被 SIGKILL 截断的文件里还原 781 条事件）。
- 头部键名大小写不固定，按小写匹配 `authorization`；用事件 `source.id` 关联出请求 URL。
- 命中的端点域名做优先级判定（`tencent/copilot/workbuddy` 优先），否则兜底任意 Bearer 并告警。
- ⚠️ `~/.workbuddy/traces/**` 里的 `Bearer …` 是**本地 MCP 连接器**的鉴权头，**不是模型 token**，别误采信。

---

## 六、路线 D：MITM 代理（未实测的兜底）

若某天遇到「连 netlog 也抓不到」的场景（例如请求由 **Node 扩展宿主**发起，不经 Chromium 网络栈），可考虑：

```
--proxy-server=http://127.0.0.1:<port> --ignore-certificate-errors
```

配合本地 MITM 代理（需生成并信任 CA）拦截 HTTPS 明文。代价比 netlog 高，故仅作兜底。

---

## 七、当前方案（路线 E）：交给上游 OAuth

`workbuddy2api-hub` 的看板里点「+ 添加账号 (OAuth)」→ 选区域（国际版 / 国内版）→ 完成官方登录 → **程序自动检测回调并入库**。之后：

- 定时调度器每日 **22:00** 全库扫描，Token 剩余寿命不足 2 小时自动 refresh 保活
- 多账号可分别绑定出口代理，429 时可自动切换出站身份
- 桌面端导入（`--import-desktop`）已被上游标记「暂不可用」——原因正是第三节的加密信封，**与我们逆向出的结论完全一致**

**所以在新的架构下，token 抓包整条链路都不再需要。** 保留本存档是为了：① 复用抓包/取证手段；② 解释「为什么不要试图去读桌面端凭据文件」。

---

## 八、脚本清单

### 跨平台入口（仓库根）

**双击就能用** —— 弹出菜单（启动 / 停止 / 重启 / 状态 / 控制台 / 加账号 / 体检）：

| 文件 | 平台 | 说明 |
|---|---|---|
| `hwb.command` | macOS | Finder 里双击即执行（系统用「终端」打开） |
| `hwb.cmd` | Windows | **双击这个**。`.ps1` 双击是打开记事本，`.cmd` 才用它把 `.ps1` 调起来 |
| `hwb.ps1` | Windows | PowerShell 入口，也可 `.\hwb.ps1 status` 带动作调用 |
| `scripts/hwb.py` | 全平台 | **唯一真源**：所有逻辑都在这里（纯标准库） |

### 兼容薄壳（`scripts/*.sh`）

每个只有 ~10 行，作用是把参数转给 `hwb.py`。**改逻辑请改 `hwb.py`**。
保持这些文件名是为了兼容既有文档与习惯。

| 脚本 | 作用 |
|---|---|
| `start.sh` | 一键起服务：clone/更新 hub → 生成密钥与配置 → 装 Headroom → 启动 hub + Headroom → 自检 → 打印客户端配置 |
| `stop.sh` | 停止两个服务（含按端口兜底清理，带误杀守卫） |
| `restart.sh` | stop + start |
| `status.sh` | 进程 / 账号池 / 出口区域 / 省 token / 生效 API Key（`--raw` 输出原始 JSON） |
| `login.sh` | 打开看板并等待 OAuth 账号入库（`--no-wait` / `--timeout N`） |
| `dashboard.sh` | 启动 / 构建 / 停止本地控制台（`--build` / `--stop` / `--fg` / `--status`） |

### 只在 macOS / Linux 上的辅助脚本

这两个是排障与研究工具，没做跨平台适配（Windows 上用不到）：

| 脚本 | 作用 |
|---|---|
| `test-compression.sh` | Headroom 压缩 A/B 对照（临时实例，跑完自清理） |
| `compression_probe.py` | 压缩探针（结构化输出压缩前后差异） |
| `dashboard.py` | 控制台后端（纯 stdlib，127.0.0.1:8786，托管前端产物 + `/api/*`）—— 这个是跨平台的，由 `hwb.py dashboard` 调起 |

> Windows 上不需要这些 `.sh`：等价写法是 `powershell -File hwb.ps1 <动作>`
> 或直接 `py -3 scripts\hwb.py <动作>`。
> 跨平台设计与踩坑（僵尸进程、`os.kill` 在 Windows 会杀进程、`.ps1` 要 BOM…）见
> [`references/cross-platform.md`](references/cross-platform.md)。

### 控制台前端（`dashboard/`）

React + Vite + TS + Tailwind 工程，构建产物 `dashboard/dist/` 由 `dashboard.py` 单端口托管（**运行时不需要 Node**）。

| 文件 | 作用 |
|---|---|
| `dashboard/package.json` | React 19 / Vite 8 / TS 7 / Tailwind 4（`npm run dev` 开发、`npm run build` 构建） |
| `dashboard/vite.config.ts` | `base: "./"`（相对路径，便于单端口托管）+ dev 时 `/api` 反代到 8786 |
| `dashboard/src/App.tsx` | 页面装配 |
| `dashboard/src/hooks/useStatus.ts` | 5 秒轮询 `/api/status` |
| `dashboard/src/api.ts` / `src/types.ts` | 接口封装与类型（与 `dashboard.py` 返回结构一一对应） |
| `dashboard/src/components/` | `ChainCard`(链路) / `PoolCard`(账号池+OAuth) / `SavingsCard`(省流) / `ClientCard`(客户端配置) / `AccountsTable` / `LogsCard` / `ui.tsx` |
| `dashboard/public/` | 站点图标：`favicon.svg`（矢量主件）+ `favicon-32.png` + `apple-touch-icon.png` |
| `dashboard/tools/make-icon.py` | 图标生成脚本（零依赖纯几何）：品牌绿 `#10C8A1` 底板 + 手绘白鲸，改形状/配色后重跑即覆盖 `public/favicon.svg` |

### 历史归档（`references/legacy-token-capture/`）

| 文件 | 作用 | 状态 |
|---|---|---|
| `get_token_netlog.mjs` | 从 netlog 提取 Bearer（容错解析） | 机制有效，当前链路不再需要 |
| `get_token_cdp.mjs` | CDP 动态挂载 target 抓 Bearer | 对本应用结构性失效（第四节） |
| `enable_cdp.sh` | 以抓包参数重启 WorkBuddy 桌面端 | 可复用（改 `APP` 路径即可用于其它 Chromium 应用） |
| `token.sh` | 复用/更新 `workbuddy2api/.env` 的 token | 随旧项目废弃 |
| `env.example` | 旧 `workbuddy2api` 的 `.env` 模板 | 随旧项目废弃 |

---

## 九、运行时目录

所有运行态数据都在 `~/.iskill-headroom-workbuddy/`，技能目录只放文档与脚本：

```
~/.iskill-headroom-workbuddy/
├── workbuddy2api-hub/     # 上游源码（零依赖，git 仓库）
├── hub-accounts/          # 账号凭证 + settings.json（与源码分离，升级不丢）
├── hub-usage/             # 请求流水 usage.jsonl
├── hub.env                # 本技能生成的 API_KEY / PANEL_PASSWORD / HUB_PORT
├── headroom.env           # Headroom 配置（OPENAI_TARGET_API_URL 指向 hub）
├── venv/                  # 仅供 Headroom 使用（hub 与控制台都是纯 stdlib，不需要）
├── logs/                  # hub.log / headroom.log / dashboard.log / dashboard-build.log
├── dashboard.pid
└── pids.json              # hub / headroom 的 PID
```

> 用环境变量 `ISKILL_RUNTIME` 可整体挪到别处。
