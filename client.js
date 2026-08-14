// ============================================================
//  eye — CLIENT half
//  使用:把本文件内容粘贴到 cordis_define 的 code.client
//  Client 半区职责:页面 UI(插槽)、主题、Tool 卡片等
//  参考:../one-click-launcher/plugin/client.js(完整示例)
// ============================================================
return {
  apply(ctx) {
    // 注册 UI 前先查询插槽契约:Slots.listSubTree(不传 root 看目录,传 root 看精确契约)
    // const slots = ctx.get('slots')
    // if (slots === undefined) return
    // slots.inject('sidebar.footer.action', () => slots.register(
    //   { name: 'sidebar.footer.action', id: 'eye', order: 200, label: () => 'eye' },
    //   () => React.createElement('button', null, 'eye'),
    // ))
  },
}
