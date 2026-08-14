// ============================================================
//  eye — HOST half
//  使用:把本文件内容粘贴到 cordis_define 的 code.host
//  Host 半区职责:文件、命令、Agent/会话、模型工具、Client RPC 等
//  参考:../one-click-launcher/plugin/host.js(完整示例)
// ============================================================
return {
  apply(ctx) {
    // 可选服务用 ctx.get() 读取并判空
    // const fs = ctx.get('fs')
    // if (fs === undefined) return

    // 示例:注册 Client 可调用的 RPC(Client 端用 host.call('eye.ping', {}))
    // return harness.handle('eye.ping', async (args) => ({ pong: true }))

    // 示例:注册动态模型工具
    // 注意 defineTool 契约:output 必须含 { schema, render, presentationMeta? },
    // schema 用值模式 DSL(必填属性用 required: true,object 需显式 additionalProperties)
    // const tool = harness.defineTool({
    //   name: 'eye_ping',
    //   description: '...',
    //   parameters: { type: 'object', properties: {} },
    //   output: {
    //     schema: { type: 'object', additionalProperties: false, properties: {} },
    //     render(args, value) { return [{ type: 'text', text: '...' }] },
    //   },
    //   execute: async () => ({ ok: true }),
    // })
    // return harness.registerTool(ctx, tool)
  },
}
