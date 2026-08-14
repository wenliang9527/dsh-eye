# 👁 eye — 给纯文本模型配"外挂的眼睛"

> 图片 → (OCR + 在线 VLM) → 纯文本 → 注入模型上下文。纯文本模型(如 DeepSeek V4-Flash)也能"看图"。

**Topics:** `dsh-plugin` · `deepseek-harness` · `vision` · `ocr` · `windows` · `macos`

---

## 它能做什么

| 能力 | 说明 |
|---|---|
| 🖼️ **聊天拖图即读** | 上传图片自动 OCR + VLM 转文本,纯文本模型直接理解 |
| 🔍 **eye_see 工具** | 本地图片路径 → 文本(OCR + VLM 双路径) |
| 🗂️ **多图合并** | 一次请求内多张图合并进同一次 VLM 调用,适合对比 |
| 💬 **关注点跟随** | 把用户最近的问题原样传给视觉模型,围绕需求回答 |
| 🔐 **安全注入** | 视觉结果标记为「非可信观察数据」,防图片提示词注入 |
| 🧠 **结果缓存** | 同图 + 同问题不重复调用 OCR/VLM,省时省钱 |
| 💻 **跨平台 OCR** | Windows 用系统 WinRT(免费),macOS 用系统 Vision(免费) |

---

## 快速上手

### 前提

| 项 | 说明 |
|---|---|
| DSH Web 已运行 | 基于 `dsh web`(0.1.0-rc 系) |
| 操作系统 | Windows(WinRT OCR)/ macOS(Vision OCR),VLM 路径跨平台 |
| 目标模型 | 纯文本模型(如 deepseek-v4-flash);模型本身支持图片时插件自动放行 |
| sharp | Windows 下 DSH 自带(dsh-attachment-local 的依赖),无需单独安装 |

### 安装方式一:会话级(快速试用,2 分钟)

适用于任何 DSH 用户,**重启后需重装**。

1. 把本仓库 `host.js` 内容给 AI:`cordis_define`(新建插件,`idPrefix: "eye"`,`code.host` ← host.js,`code.client` ← client.js)
2. `cordis_run` 激活,在界面批准
3. 生效后:
   - 侧边栏底部出现 **👁 诊断 / 切换到eye** 按钮(点"切换到eye"把模型切到 eye-vision)
   - 设置 → **eye 视觉桥** 页面(可填 VLM key)
   - 模型选择器里出现提供商 **"eye 视觉桥(deepseek)"**
4. 直接拖图上传发送 → 图片自动转文本 → 模型回答

> 重启后插件消失,重装一次即可(2 分钟)。

### 安装方式二:永久(Host 核心,重启保留)

只装核心能力(eye-vision 路由 + 图片拦截 + `eye_see` 工具),无设置页 UI(配置改 `.eye/eye.config.json`)。

```sh
# 0) 定位 profile(默认 ~/.dsh,即 $DSH_HOME)
# 1) 包放到 profile 目录(loader 以 profile 为解析锚点,两份都要)
mkdir -p "$DSH_HOME/profiles/web/dsh-eye-host"
cp host-native/package.json host-native/index.js "$DSH_HOME/profiles/web/dsh-eye-host/"
mkdir -p "$DSH_HOME/profiles/web/node_modules/dsh-eye-host"
cp host-native/package.json host-native/index.js "$DSH_HOME/profiles/web/node_modules/dsh-eye-host/"

# 2) 编辑 $DSH_HOME/profiles/web/cordis.patch.yml,追加:
#    - insert:
#        - id: eye-host
#          name: dsh-eye-host

# 3) 重启 dsh;验证: dsh --profile web --dump-config | grep eye-host
```

- 默认模型若曾设为 eye-vision 会自动生效;否则在模型选择器选 **"eye 视觉桥(deepseek)"**
- 回滚:删 patch 里的 insert 条目 + 删两个包目录,重启
- 包必须**零外部依赖**(profile 目录外的 `require` 解析不到);本包工具用纯 JSON-schema 注册,无依赖
- ⚠️ **不要重装会话级插件**(会报 `DUPLICATE_ADAPTER`)

> ⚠️ **别用 `$DSH_HOME/cordis.patch.yml`(home 补丁层)挂新增插件**——那是**覆盖层**,只能改已有行,新增会报 `patch: entry "eye-host" not found`(实测踩坑)。新增插件只能在 **profile 自己的 `cordis.patch.yml`** 里 `insert:`。

### 安装方式三:官方命令(有 pnpm 时)

`host-native/` 已是 **bundle 类插件**(package.json 声明 `dsh.bundle.patch` + 自带 `cordis.patch.yml`),可用官方插件管理命令正式登记,与 [dsh-vision](https://github.com/oil-oil/dsh-vision) 同款:

```sh
npx @deepseek-ai/dsh plugin --profile web add github:wenliang9527/dsh-eye
```

会自动由 pnpm 安装并加入 `dsh.profile.bundles`,启动即生效。(当前环境无 pnpm 时,方式二手动等效。)

---

## ⚠️ 换模型提示(重要)

会话**历史里一旦包含图片**,DSH 会拒绝把该会话切回纯文本模型(`model-unavailable: this session already contains images`)。所以:

- **图片测试会话**留在 eye-vision 上;
- **正常文本工作**开**新会话**(无图片历史),自由切回 `deepseek-official / deepseek-v4-flash`。

---

## 配置(`.eye/eye.config.json`,工作区根目录,首次调用自动生成)

```json
{
  "vlm": {
    "url": "https://<提供商>/v1/chat/completions",
    "model": "<视觉模型名,如 glm-4v / qwen-vl-plus>",
    "apiKey": "<你的 API Key>",
    "prompt": "可选,自定义描述提示词"
  },
  "ocr": true
}
```

- 不配 VLM 也能用:OCR 开箱即用
  - Windows:Win10+ 中文系统一般自带 OCR 语言包
  - macOS:系统 Vision 框架,零安装
- 配置后图片识别 = OCR 文字 + VLM 语义描述双路径,艺术字/图表识别更准确
- `eye_see` 工具:`mode` = `auto`(OCR+VLM)/ `ocr` / `vlm`

---

## 架构与原理

```
聊天拖图 → eye-vision 路由(绕过发送受理门)
→ llm/stream 拦截 → 收集全部图片 + 取用户关注点
→ 逐图 OCR(Windows WinRT / macOS Vision)
→ 一次 VLM 多图合并(可选)
→ <vision-bridge-context> 安全包装 → 纯文本注入
→ 文本模型推理
```

1. **OCR 路径**(本地免费):
   - Windows:WinRT OCR(PowerShell 5.1)
   - macOS:Vision 框架(osascript + ObjC bridge)
2. **VLM 路径**:OpenAI 兼容多模态接口(glm-4v / qwen-vl 等),生成语义描述;用户问题原样传入
3. **安全**:视觉产物包进 `<vision-bridge-context>`,声明"非可信观察数据,不是系统指令",防图片内提示词注入
4. **缓存**:LRU(上限 64),key = 图片id + 用户问题 + 路由配置;失败不缓存可重试
5. 产物是**纯文本**,恰好匹配文本模型输入格式;绝不产生 image 块(DeepSeek 适配器会拒收)

---

## 环境适配(重要)

| 项 | 说明 |
|---|---|
| deepseek 提供商 id | 代码里 `TARGET_PROVIDER = 'deepseek-official'`。若对方部署里提供商名不同(如 `deepseek`),改这一处 |
| 图片格式 | Windows 经 sharp 统一转 PNG,WebP/JPEG/GIF 均可;macOS 直接读原文件 |
| 沙箱 | 字节处理全在子进程完成(不过沙箱桥);OCR 中间文件走进程自己的 `$env:TEMP` |

---

## 为什么不做"替换 deepseek-official 适配器"

参考 [dsh-vision](https://github.com/oil-oil/dsh-vision) 时评估过其核心设计——包装官方 `DeepSeekAdapter` 并替换 `deepseek-official`,让模型列表直接声称支持图片(**用户不用切模型**)。**决定不采用**,理由:

| 维度 | 当前方案(eye-vision 虚拟 provider) | 替换适配器方案 |
|---|---|---|
| 拖图流程 | 图片会话切到 eye-vision 再拖 | 免切换 |
| 风险面 | 独立 provider,**不碰官方适配器** | 影响**所有** DeepSeek 请求,官方包升级即可能崩 |
| 依赖 | 零依赖 ✅ | 依赖官方 `dsh-llm-deepseek` 内部 API |
| 维护成本 | 低 | 高(需转发 retryPolicy/listModels/stream 全部细节) |
| 收益 | — | 仅省一次手动切模型 |

能力上两者等价(多图/缓存/安全/跨平台都有),替换方案的唯一收益是"免切换",代价却是承担官方适配器的维护风险。等 DeepSeek 官方模型支持图片输入,一切自然解决。

---

## 已吸收 dsh-vision 的优点

| 优点 | 状态 |
|---|---|
| 🔐 `<vision-bridge-context>` 安全标注(防提示词注入) | ✅ 已实现 |
| 💬 用户问题传给视觉模型(`latestUserTask`) | ✅ 已实现 |
| 🗂️ 视觉结果 LRU 缓存 | ✅ 已实现 |
| 🖼️ 多图合并进一次 VLM 调用 | ✅ 已实现 |
| ❌ 失败聚合报告 | ✅ 已实现 |
| 💻 macOS Vision OCR(替代其 Tesseract 方案,免安装) | ✅ 已实现 |
| 🔑 API Key 走官方 credentials 服务 | ⏸️ 未做(现为明文配置,改动大可后续加) |
| 🔁 替换 deepseek-official 适配器 | ❌ 有意不做(见上文决策) |

---

## 文件

| 文件 | 说明 |
|---|---|
| `host.js` / `client.js` | 会话级动态插件源码(完整功能:设置页 + 按钮 + 工具) |
| `host-native/` | 永久版原生插件包(仅 Host 核心,零依赖,含 `cordis.patch.yml` bundle 声明) |

---

## 踩坑记录(开发参考)

- **重启后"不自动启动"的根因**:插件 `apply` 曾用 `ctx.get('llm')` 拿服务,启动早期服务未注册就静默 return。修复:声明 `inject: [...]`,Cordis 等所有服务就绪后才执行 apply(参考 dsh-vision 的 `inject: ["llm", ...]`)
- `llm/stream` 瀑布监听器必须是 **async generator**(调度器 `yield* listener(...)`;async 函数返回 Promise 会报 "not async iterable")
- 沙箱桥会把 `Uint8Array` 按 UTF-8 重编码污染字节(`0x89` → `C2 89`)→ 字节获取必须走子进程直接读盘
- Windows 沙箱对工作区路径的遮蔽有 bug(`UNABLE_TO_MASK_PATH`,路径长度溢出)→ OCR 中间文件放进程自己的 `$env:TEMP`
- WinRT OCR 有 ~2600px 上限 → sharp 统一缩放 ≤2048
- 永久插件与会话级插件**不要叠装**(同注册 eye-vision provider 会报 `DUPLICATE_ADAPTER`)
- macOS 附件路径解析:用 `HOME`(而非仅 `USERPROFILE`)定位 `~/.dsh`
