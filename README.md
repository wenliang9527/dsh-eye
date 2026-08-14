# 👁 eye — 给纯文本模型配"外挂的眼睛"

图片 → (OCR + 在线 VLM) → 纯文本 → 注入模型上下文。纯文本模型(如 DeepSeek V4-Flash)也能"看图"。

## 两大能力

### 1. `eye_see` 工具(看本地文件)

对模型说"看一下 `<图片路径>`",eye 读文件 → OCR + VLM → 返回纯文本描述。

### 2. llm/stream 拦截(聊天上传图片,突破"图片发不出去"的限制)

在模型调用瀑布里拦截:检测到消息含 image 内容块 → 从附件服务取图片字节 → OCR + VLM 转文本 → 用转换后的文本消息重入 `llm.stream`。

- **图片本身仍显示在会话里**(历史保留),模型收到的是文本描述
- **路由门控**:目标模型本身支持图片(`inputModalities` 含 image)时直接放行,不拦截
- 纯文本模型(DeepSeek 适配器)不再因为 image 块抛 `UNSUPPORTED_CONTENT`

## 原理(WorkBuddy 同款架构)

1. **OCR 路径**:Windows 自带 WinRT OCR(PowerShell 5.1 调用,本地免费),提取图片文字 —— 适合截图、票据、文档
2. **VLM 路径**:图片 base64 发给 OpenAI 兼容多模态接口(如混元/GLM/Qwen-VL),生成语义描述 —— 适合图表、界面、场景
3. 产物是**纯文本**,恰好匹配文本模型输入格式

## 安装(DSH 会话内)

1. `cordis_define`:新建插件,`idPrefix: "eye"`,`code.host` ← `host.js` 内容
2. `cordis_run` 激活(Host 半区,无需批准)
3. 生效:模型获得 `eye_see` 工具;聊天上传图片自动走文本转换

## 配置(`.eye/eye.config.json`,工作区根目录,首次调用自动生成模板)

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
- `eye_see` 的 `mode`: `auto`(OCR+VLM)/ `ocr` / `vlm`

## 文件

| 文件 | 说明 |
|---|---|
| `host.js` | Host 半区源码(eye_see 工具 + llm/stream 拦截 + 辅助脚本内嵌) |
| `client.js` | Client 半区(暂为空骨架) |

## 说明

- 仅限 Windows(OCR 依赖 WinRT;VLM 路径跨平台)
- 辅助脚本(`eye-ocr-stdin.ps1` / `eye-vlm-stdin.mjs`)首次调用时自动写入工作区 `.eye/`(gitignore)
- VLM 接口需 OpenAI 兼容格式(chat/completions + image_url)
- 子进程用 collect 流收集输出,100s 超时兜底 terminate
- 踩坑记录:`llm/stream` 瀑布监听器必须是 **async generator**(调度器 `yield* listener(...)`;普通 async 函数返回 Promise 会报 "not async iterable")
- 已本地实测:OCR 正确识别测试图文字
