# 👁 eye — 给纯文本模型配"外挂的眼睛"

图片 → (OCR + 在线 VLM) → 纯文本 → 注入模型上下文。纯文本模型(如 DeepSeek V4-Flash)也能"看图"。

## 给别人用之前:先说清需求

这个插件解决的是 **DSH(DeepSeek Harness)里纯文本模型看不到图片** 的问题。使用者需要:

| 前提 | 说明 |
|---|---|
| DSH Web 已运行 | 本文档基于 `dsh web`(0.1.0-rc 系) |
| Windows | OCR 走系统 WinRT(免费);VLM 路径跨平台 |
| 模型路由 | 目标模型是纯文本的(如 deepseek-v4-flash);模型本身支持图片时插件自动放行,无需干预 |
| sharp | DSH 自带(dsh-attachment-local 的依赖),无需单独安装 |

---

## 安装方式一:会话级(快速试用,2 分钟)

适用于任何 DSH 用户,重启后需重装。

1. 把本仓库的 `host.js` 内容给 AI,让其执行:`cordis_define`(新建插件,`idPrefix: "eye"`,`code.host` ← host.js,`code.client` ← client.js)
2. `cordis_run` 激活,在界面批准
3. 生效后:
   - 侧边栏底部出现 **👁 诊断 / 切换到eye** 按钮(点"切换到eye"把模型切到 eye-vision)
   - 设置 → **eye 视觉桥** 页面(可填 VLM key)
   - 模型选择器里出现提供商 **"eye 视觉桥(deepseek)"**(也可以从这里选)
4. 直接拖图上传发送 → 图片自动转文本 → 模型回答

> 重启后插件消失,按 `REINSTALL-EYE.md`(工作区里那份)2 分钟重装即可。

## 安装方式二:永久(Host 核心,重启保留)

只装核心能力(eye-vision 路由 + 图片拦截 + `eye_see` 工具),无设置页 UI。

1. 把 `host-native/` 里的包复制到 **你自己的 dsh 安装的 node_modules** 下,目录名 `dsh-eye-host`:
   - 用 `npm run dsh` / 工作区安装的 → `你的项目/node_modules/dsh-eye-host/`
   - 用 `npx @deepseek-ai/dsh` 的 → `npx 缓存目录/node_modules/dsh-eye-host/`
2. 创建 `$DSH_HOME/cordis.patch.yml`(没有就新建):
   ```yaml
   - id: eye-host
     name: dsh-eye-host
   ```
3. 重启 dsh。默认模型若曾设为 eye-vision 会自动生效;否则在模型选择器选 "eye 视觉桥(deepseek)"。
4. 回滚:删除 `cordis.patch.yml` 即可。

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

- 不配 VLM 也能用:OCR 开箱即用(需 Windows OCR 语言包,Win10+ 中文系统一般自带)
- 配置后图片识别 = OCR 文字 + VLM 语义描述双路径,艺术字/图表识别更准确
- `eye_see` 工具:`mode` = `auto`(OCR+VLM)/ `ocr` / `vlm`

## 环境适配(重要)

| 项 | 说明 |
|---|---|
| deepseek 提供商 id | 代码里 `TARGET_PROVIDER = 'deepseek-official'`。若对方部署里提供商名不同(如 `deepseek`),改这一处;可用 `eye_see` 的姊妹命令 `eye_diag`(会话插件里)查 `listProviders()` |
| 图片格式 | 上传图片经 sharp 统一转 PNG,WebP/JPEG/GIF 均可 |
| 沙箱 | 字节处理全在子进程完成(不过沙箱桥);OCR 中间文件走进程自己的 `$env:TEMP` |

## 原理(WorkBuddy 同款架构)

```
聊天拖图 → eye-vision 路由(绕过发送受理门)
→ llm/stream 拦截 → node 读附件 + sharp 转 PNG → base64
→ PowerShell WinRT OCR + (可选)VLM 语义描述
→ 纯文本注入 → 文本模型推理
```

1. **OCR 路径**:Windows WinRT OCR(PowerShell 5.1,本地免费),提取文字
2. **VLM 路径**:OpenAI 兼容多模态接口(glm-4v / qwen-vl 等),生成语义描述
3. 产物是**纯文本**,恰好匹配文本模型输入格式;绝不产生 image 块(DeepSeek 适配器会拒收)

## 文件

| 文件 | 说明 |
|---|---|
| `host.js` / `client.js` | 会话级动态插件源码(完整功能:设置页 + 按钮 + 工具) |
| `host-native/` | 永久版原生插件包(仅 Host 核心) |
| `REINSTALL-EYE.md`(工作区) | 重启后快速重装指南 |

## 踩坑记录(开发参考)

- `llm/stream` 瀑布监听器必须是 **async generator**(调度器 `yield* listener(...)`;async 函数返回 Promise 会报 "not async iterable")
- 沙箱桥会把 `Uint8Array` 按 UTF-8 重编码污染字节(`0x89` → `C2 89`)→ 字节获取必须走子进程直接读盘
- Windows 沙箱对工作区路径的遮蔽有 bug(`UNABLE_TO_MASK_PATH`,路径长度溢出)→ OCR 中间文件放进程自己的 `$env:TEMP`
- WinRT OCR 有 ~2600px 上限 → sharp 统一缩放 ≤2048
