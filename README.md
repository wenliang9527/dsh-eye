# 👁 eye — 给纯文本模型配"外挂的眼睛"

图片 → (OCR + 在线 VLM) → 纯文本 → 注入模型上下文。纯文本模型(如 DeepSeek V4-Flash)也能"看图"。

## 原理(WorkBuddy 同款架构)

1. **OCR 路径**:Windows 自带 WinRT OCR(PowerShell 5.1 调用,本地免费),提取图片文字 —— 适合截图、票据、文档
2. **VLM 路径**:把图片 base64 发给 OpenAI 兼容的多模态接口(如混元/GLM/Qwen-VL),生成结构化语义描述 —— 适合图表、界面、场景
3. 两条路径的产物都是**纯文本**,恰好匹配文本模型的输入格式;绝不产生 image 内容块(DeepSeek 适配器遇到 image 块会直接抛 UNSUPPORTED_CONTENT)

## 安装(DSH 会话内)

1. `cordis_define`:新建插件,`idPrefix: "eye"`,`code.host` ← 本文件内容(`host.js`)
2. `cordis_run` 激活(Host 半区,无需批准)
3. 激活后模型获得 `eye_see` 工具:参数 `file_path`(图片路径)+ 可选 `mode`(`auto`/`ocr`/`vlm`)

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

- 不配 VLM 也能用:OCR 路径开箱即用(需 Windows OCR 语言包,Win10+ 中文系统一般自带)
- `mode: "auto"` = OCR + VLM 都跑;`"ocr"` 只跑 OCR;`"vlm"` 只跑 VLM

## 文件

| 文件 | 说明 |
|---|---|
| `host.js` | Host 半区源码(eye_see 工具 + 辅助脚本内嵌) |
| `client.js` | Client 半区(暂为空骨架,后续可加拖图上传/按钮 UI) |

## 说明

- 仅限 Windows(OCR 依赖 WinRT;VLM 路径跨平台)
- 辅助脚本(`eye-ocr.ps1` / `eye-vlm.mjs`)首次调用时自动写入工作区 `.eye/`(已 gitignore)
- VLM 接口需 OpenAI 兼容格式(chat/completions + image_url)
- 已本地实测:OCR 正确识别测试图文字
