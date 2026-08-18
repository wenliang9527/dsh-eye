// ============================================================
//  eye — CLIENT half
//  👁 1) 设置页"eye 视觉桥":配置 VLM 接口/模型名/API Key + OCR 开关
//     2) 侧边栏"👁 诊断 / 切换到eye"按钮
//  使用:把本文件内容粘贴到 cordis_define 的 code.client
// ============================================================
return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    // ---- 设置页:eye 视觉桥(配置 VLM key/模型名)----
    const EyeSettings = () => {
      const [vlm, setVlm] = React.useState({ url: '', model: '', apiKey: '' })
      const [ocr, setOcr] = React.useState(true)
      const [status, setStatus] = React.useState('')
      React.useEffect(() => {
        host.call('eye.loadConfig', {}).then((r) => {
          if (!r) return
          if (r.vlm) setVlm({ url: r.vlm.url || '', model: r.vlm.model || '', apiKey: r.vlm.apiKey || '' })
          if (typeof r.ocr === 'boolean') setOcr(r.ocr)
        }).catch(() => {})
      }, [])
      const save = async () => {
        setStatus('保存中...')
        try {
          const r = await host.call('eye.saveConfig', { vlm: { url: vlm.url.trim(), model: vlm.model.trim(), apiKey: vlm.apiKey.trim() }, ocr })
          setStatus(r && r.ok ? '已保存 ✓(立即生效)' : '保存失败: ' + (r && r.error ? r.error : 'unknown'))
        } catch (e) { setStatus('异常: ' + String(e && e.message ? e.message : e)) }
      }
      const row = (label, value, onChange, type) => React.createElement('label', { style: { display: 'block', margin: '10px 0', fontSize: 13, color: '#333' } },
        label,
        React.createElement('input', { type: type || 'text', value, onChange, style: { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '6px 8px', fontSize: 13, border: '1px solid #ccc', borderRadius: 6 } }),
      )
      const saveBtn = React.createElement('button', { onClick: save, style: { marginTop: 8, padding: '6px 16px', cursor: 'pointer', fontSize: 13 } }, '保存')
      const statusEl = status ? React.createElement('div', { style: { marginTop: 8, fontSize: 12, color: status.indexOf('✓') >= 0 ? '#2e7d32' : '#c62828' } }, status) : null
      return React.createElement('div', { style: { maxWidth: 420, padding: '4px 2px' } },
        React.createElement('h3', { style: { margin: '0 0 4px', fontSize: 15 } }, 'eye 视觉桥设置'),
        React.createElement('div', { style: { fontSize: 12, color: '#666', marginBottom: 8 } }, '配置一个支持视觉的模型(OpenAI 兼容接口),图片识别会更准确(OCR + VLM 双路径)。留空则仅使用本地 OCR。'),
        row('接口地址 URL(如 https://xxx/v1/chat/completions)', vlm.url, (e) => setVlm({ ...vlm, url: e.target.value })),
        row('模型名称 model(如 glm-4v / qwen-vl-plus)', vlm.model, (e) => setVlm({ ...vlm, model: e.target.value })),
        row('API Key', vlm.apiKey, (e) => setVlm({ ...vlm, apiKey: e.target.value }), 'password'),
        React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 13 } },
          React.createElement('input', { type: 'checkbox', checked: ocr, onChange: (e) => setOcr(e.target.checked) }),
          '启用本地 OCR(Windows 自带,免费)',
        ),
        saveBtn,
        statusEl,
      )
    }

    // ---- 侧边栏诊断/切换按钮 ----
    const currentSessionId = () => {
      try {
        const svc = ctx.get('sessions')
        if (svc && svc.list) {
          const snap = svc.list.getSnapshot()
          if (snap && snap.current) return snap.current
        }
      } catch (e) {}
      return undefined
    }
    const EyeDebug = () => {
      const [state, setState] = React.useState({ idle: true, busy: false, text: '' })
      const api = () => {
        const conn = ctx.get('connection')
        return conn && conn.api && conn.api.sessions ? conn.api.sessions : undefined
      }
      const onDiag = async () => {
        if (state.busy) return
        const sessions = api()
        const sessionId = currentSessionId()
        if (!sessions) { setState({ idle: false, busy: false, text: 'connection.api.sessions 不可用' }); return }
        if (!sessionId) { setState({ idle: false, busy: false, text: '未找到当前会话' }); return }
        setState({ idle: false, busy: true, text: '查询中...' })
        try {
          const { result } = await sessions.models({ sessionId })
          if (!result.ok) { setState({ idle: false, busy: false, text: 'models RPC 失败: ' + result.error.code + ': ' + result.error.message }); return }
          const current = result.value.current ? result.value.current.provider + '/' + result.value.current.model : 'none'
          const groups = (result.value.groups || []).map((g) => g.id + '(' + g.models.length + ')').join(', ') || '无'
          const failures = (result.value.failures || []).map((f) => f.id + ': ' + f.message).join('; ')
          setState({ idle: false, busy: false, text: '当前=' + current + ' | 组=' + groups + (failures ? ' | 失败=' + failures : '') })
        } catch (err) { setState({ idle: false, busy: false, text: '异常: ' + String(err && err.message || err) }) }
      }
      // 切换目标模型:优先沿用当前会话模型,其次取 eye-vision 组首个模型,兜底默认
      const resolveSwitchModel = async (sessions, sessionId, fallback) => {
        try {
          const { result } = await sessions.models({ sessionId })
          if (result && result.ok) {
            const cur = result.value && result.value.current
            if (cur && cur.model) return cur.model
            if (Array.isArray(result.value.groups)) {
              const group = result.value.groups.find((g) => g.id === 'eye-vision')
              if (group && Array.isArray(group.models) && group.models.length > 0) {
                const first = group.models[0]
                return (first && (first.id || first.model)) || fallback
              }
            }
          }
        } catch (e) {}
        return fallback
      }
      const onSwitch = async () => {
        if (state.busy) return
        const sessions = api()
        const sessionId = currentSessionId()
        if (!sessions || !sessionId) return
        setState({ idle: false, busy: true, text: '切换中...' })
        try {
          const model = await resolveSwitchModel(sessions, sessionId, 'deepseek-v4-flash')
          const { result } = await sessions.selectModel({ sessionId, provider: 'eye-vision', model })
          if (result && result.ok) {
            setState({ idle: false, busy: false, text: '已切换到 eye-vision/' + model + ' ✓ 现在可以拖图发送' })
          } else {
            setState({ idle: false, busy: false, text: '切换失败: ' + (result && result.error ? result.error.code + ': ' + result.error.message : 'no response') })
          }
        } catch (err) { setState({ idle: false, busy: false, text: '异常: ' + String(err && err.message || err) }) }
      }
      const base = { margin: '0 4px', padding: '3px 8px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }
      const btnDiag = React.createElement('button', { onClick: onDiag, disabled: state.busy, style: base }, state.busy ? '...' : '👁 诊断')
      const btnSwitch = React.createElement('button', { onClick: onSwitch, disabled: state.busy, style: base }, '切换到eye')
      const text = state.idle ? null : React.createElement('span', { style: { fontSize: 11, color: '#666', margin: '0 4px', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'middle' } }, state.text)
      return React.createElement('div', { style: { display: 'flex', alignItems: 'center', minWidth: 0, padding: '0 4px' } }, btnDiag, btnSwitch, text)
    }

    slots.inject('sidebar.footer.action', () => slots.register(
      { name: 'sidebar.footer.action', id: 'eye-debug', order: 200, label: () => 'eye诊断' },
      () => React.createElement(EyeDebug),
    ))
    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'eye-vision', order: 30, label: () => 'eye 视觉桥' },
      () => React.createElement(EyeSettings),
    ))
  },
}
