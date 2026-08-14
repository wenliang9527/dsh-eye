# 👁 eye

插件功能描述(待补充)。

## 文件

| 文件 | 说明 |
|---|---|
| `host.js` | Host 半区源码,粘贴到 `cordis_define` 的 `code.host` |
| `client.js` | Client 半区源码,粘贴到 `cordis_define` 的 `code.client` |

## 加载调试

1. 在本工作区的 DSH 会话里让 AI 用 `cordis_define` 新建插件(`idPrefix: "eye"`)
2. 粘贴 `host.js` / `client.js` 内容
3. `cordis_run` 激活并在界面批准授权

> 详细流程参考 `../one-click-launcher/plugin/INSTALL.md`。
