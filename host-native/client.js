// ============================================================
//  dsh-eye-host — Client bundle(设置 → 插件 →「eye 视觉桥」卡片)
//  ============================================================
//  浏览器启动图协议:window.__ModuleLoader__.load({ id, factory })
//  - id 必须等于包名 "dsh-eye-host"(与 loader 条目名一致)
//  - factory(require) 惰性执行,返回模块导出;loader 取 exports.default ?? exports
//  - require 可解析平台种子字(staticModules):react 等
//  - 配置通过官方 credentials 服务读写(单向写入,浏览器读不到 key 明文):
//      EYE_VLM_URL / EYE_VLM_MODEL / EYE_VLM_API_KEY / EYE_VLM_PROMPT / EYE_OCR
//    host 半区 loadConfig 优先读 credentials,回退 .eye/eye.config.json
//  ============================================================

window.__ModuleLoader__.load({
  id: 'dsh-eye-host',
  factory: (require) => {
    const React = require('react')

    const CRED_REFS = {
      url: 'EYE_VLM_URL',
      model: 'EYE_VLM_MODEL',
      apiKey: 'EYE_VLM_API_KEY',
      prompt: 'EYE_VLM_PROMPT',
      ocr: 'EYE_OCR',
    }

    const FIELDS = [
      { key: 'url', label: 'VLM API 地址', placeholder: 'https://<提供商>/v1/chat/completions', secret: false },
      { key: 'model', label: '视觉模型', placeholder: 'glm-4v / qwen-vl-plus', secret: false },
      { key: 'apiKey', label: 'API Key', placeholder: 'sk-...', secret: true },
      { key: 'prompt', label: '描述提示词(可选)', placeholder: '留空用默认提示词', secret: false },
    ]

    // 预置提供商模板:选中自动填充 URL + 模型名(不触碰 API Key)
    const VLM_PRESETS = [
      { label: '自定义(手动填写)', url: '', model: '' },
      { label: '智谱 GLM-4V-Flash(免费)', url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4v-flash' },
      { label: '通义千问 qwen-vl-plus', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-vl-plus' },
      { label: '硅基流动 Qwen2.5-VL', url: 'https://api.siliconflow.cn/v1/chat/completions', model: 'Qwen/Qwen2.5-VL-7B-Instruct' },
      { label: 'Kimi moonshot-vision', url: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k-vision-preview' },
    ]

    return {
      inject: ['slots', 'connection'],
      apply(ctx) {
        const slots = ctx.get('slots')
        const connection = ctx.get('connection')
        if (!slots || !connection) return
        const api = connection.api

        // —— 卡片组件:表单 + 已配置徽章 + 保存 ——
        const EyeSettingsCard = (props) => {
          const [open, setOpen] = React.useState(false)
          const [drafts, setDrafts] = React.useState({ url: '', model: '', apiKey: '', prompt: '', ocr: '' })
          const [facts, setFacts] = React.useState(null)   // { ref -> configured }
          const [status, setStatus] = React.useState('')    // '' | saving | saved | error:msg
          const [loaded, setLoaded] = React.useState(false)

          const allRefs = Object.values(CRED_REFS)
          const dirty = Object.entries(drafts).some(([k, v]) => {
            if (k === 'ocr') return false
            return v.trim() !== ''
          })

          React.useEffect(() => {
            if (!open || loaded) return
            let active = true
            setStatus('')
            Promise.resolve(api.credentials.describe({ refs: allRefs })).then(
              (response) => {
                if (!active) return
                if (response && response.result && response.result.ok) {
                  setFacts(response.result.value.credentials || {})
                } else {
                  setFacts({})
                }
                setLoaded(true)
              },
              () => { if (active) { setFacts({}); setLoaded(true) } }
            )
            return () => { active = false }
          }, [open, loaded])

          const setDraft = (key, value) => setDrafts((current) => ({ ...current, [key]: value }))

          const onPreset = (e) => {
            const preset = VLM_PRESETS.find((p) => p.label === e.target.value)
            if (preset && preset.url) {
              setDrafts((current) => ({ ...current, url: preset.url, model: preset.model }))
              if (status !== '') setStatus('')
            }
          }

          const save = () => {
            const writes = []
            for (const [k, ref] of Object.entries(CRED_REFS)) {
              if (k === 'ocr') continue
              const value = (drafts[k] || '').trim()
              if (value === '') continue
              writes.push(Promise.resolve(api.credentials.set({ ref, value })))
            }
            if (writes.length === 0) { setStatus('error:没有可保存的新值'); return }
            setStatus('saving')
            Promise.all(writes).then((results) => {
              const ok = results.every((r) => r && r.result && r.result.ok)
              if (ok) {
                setStatus('saved')
                setDrafts({ url: '', model: '', apiKey: '', prompt: '', ocr: '' })
                setLoaded(false) // 重新拉取徽章
              } else {
                setStatus('error:保存失败')
              }
            }, () => setStatus('error:保存失败'))
          }

          const badge = (key) => {
            const ref = CRED_REFS[key]
            const configured = facts && facts[ref] && facts[ref].configured === true
            return React.createElement('span', {
              style: {
                marginLeft: 8,
                borderRadius: 999,
                padding: '1px 8px',
                fontSize: 11,
                background: 'var(--dsw-alias-bg-module-platform)',
                color: configured ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-tertiary)',
              },
            }, configured ? '已配置' : '未配置')
          }

          const header = React.createElement('button', {
            type: 'button',
            'aria-expanded': open,
            onClick: () => setOpen(!open),
            style: {
              width: '100%', appearance: 'none', border: 0, borderRadius: 12,
              padding: '14px 16px', background: 'none', color: 'inherit',
              font: 'inherit', textAlign: 'left', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 12,
            },
          },
            React.createElement('span', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 } },
              React.createElement('span', { style: { color: 'var(--dsw-alias-label-primary)', fontSize: 15, fontWeight: 600 } }, '👁 eye 视觉桥'),
              React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 13 } },
                '聊天图片自动 OCR+VLM 转文本 · 配置保存在官方凭据服务'),
            ),
            React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', transition: 'transform .16s', transform: open ? 'rotate(180deg)' : 'none' } }, '▾'),
          )

          if (!open) return React.createElement('li', { style: { listStyle: 'none' } }, header)

          const field = (spec) => React.createElement('div', {
            key: spec.key,
            style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0' },
          },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              React.createElement('label', { style: { flex: 1, color: 'var(--dsw-alias-label-primary)', fontSize: 13, fontWeight: 500 } }, spec.label),
              badge(spec.key),
            ),
            React.createElement('input', {
              type: spec.secret ? 'password' : 'text',
              autoComplete: 'off',
              placeholder: spec.placeholder,
              value: drafts[spec.key] || '',
              onChange: (e) => { setDraft(spec.key, e.target.value); if (status !== '') setStatus('') },
              style: {
                boxSizing: 'border-box', width: '100%', height: 34,
                border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
                padding: '0 12px', background: 'var(--dsw-alias-bg-layer-3)',
                color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 13,
              },
            }),
            React.createElement('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', lineHeight: 1.5 } },
              spec.secret ? 'Key 单向写入,保存后界面不读回明文' : '留空表示不修改当前值'),
          )

          const ocrRow = React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0' },
          },
            React.createElement('label', { style: { flex: 1, color: 'var(--dsw-alias-label-primary)', fontSize: 13, fontWeight: 500 } }, '本地 OCR'),
            badge('ocr'),
            React.createElement('button', {
              type: 'button',
              onClick: () => {
                const next = drafts.ocr === 'true' ? 'false' : 'true'
                setDraft('ocr', next)
                Promise.resolve(api.credentials.set({ ref: CRED_REFS.ocr, value: next })).then(
                  (r) => { if (r && r.result && r.result.ok) { setStatus('saved'); setLoaded(false) } else setStatus('error:保存失败') },
                  () => setStatus('error:保存失败'),
                )
              },
              style: {
                padding: '4px 14px', borderRadius: 8,
                border: '1px solid var(--dsw-alias-border-l2)', cursor: 'pointer',
                fontSize: 13, background: 'var(--dsw-alias-bg-layer-2)',
                color: 'var(--dsw-alias-label-primary)',
              },
            }, drafts.ocr === 'true' ? '关闭' : '开启'),
          )

          const statusLine = (() => {
            if (status === '') return null
            const isError = status.startsWith('error:')
            return React.createElement('p', {
              role: 'status',
              style: {
                flex: 1, minWidth: 0, margin: 0, fontSize: 12, lineHeight: 1.5,
                color: isError ? 'var(--dsw-alias-label-error)' : 'var(--dsw-alias-state-success-primary)',
              },
            }, status === 'saving' ? '保存中…' : status === 'saved' ? '已保存 ✓' : status.slice(6))
          })()

          const presetRow = React.createElement('div', {
            style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0' },
          },
            React.createElement('label', { style: { color: 'var(--dsw-alias-label-primary)', fontSize: 13, fontWeight: 500 } }, '预置提供商(自动填充 URL + 模型名)'),
            React.createElement('select', {
              value: '自定义(手动填写)',
              onChange: onPreset,
              style: {
                boxSizing: 'border-box', width: '100%', height: 34,
                border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
                padding: '0 12px', background: 'var(--dsw-alias-bg-layer-3)',
                color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 13,
              },
            },
              VLM_PRESETS.map((p) => React.createElement('option', { key: p.label, value: p.label }, p.label)),
            ),
          )

          const verifyHint = React.createElement('p', {
            style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', lineHeight: 1.5 },
          }, '💡 验证:保存后拖一张图片到聊天发送,模型能描述图片即生效')

          const footer = React.createElement('div', {
            style: {
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
              borderTop: '1px solid var(--dsw-alias-border-l2)', padding: '12px 0 4px',
            },
          },
            statusLine,
            React.createElement('button', {
              type: 'button',
              disabled: !dirty,
              onClick: () => setDrafts({ url: '', model: '', apiKey: '', prompt: '', ocr: '' }),
              style: {
                appearance: 'none', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
                padding: '5px 14px', font: 'inherit', fontSize: 13, cursor: 'pointer',
                background: 'none', color: 'var(--dsw-alias-label-secondary)',
                opacity: dirty ? 1 : 0.4,
              },
            }, '清空'),
            React.createElement('button', {
              type: 'button',
              disabled: !dirty || status === 'saving',
              onClick: save,
              style: {
                appearance: 'none', border: 0, borderRadius: 8, padding: '5px 14px',
                font: 'inherit', fontSize: 13, cursor: 'pointer',
                background: 'var(--dsw-alias-label-primary)',
                color: 'var(--dsw-alias-bg-layer-3)',
                opacity: dirty && status !== 'saving' ? 1 : 0.4,
              },
            }, status === 'saving' ? '保存中…' : '保存'),
          )

          return React.createElement('li', {
            style: {
              listStyle: 'none', border: '1px solid var(--dsw-alias-border-l2)',
              borderRadius: 12, background: 'var(--dsw-alias-bg-layer-2)',
            },
          },
            header,
            React.createElement('div', { style: { margin: '0 16px', borderTop: '1px solid var(--dsw-alias-border-l2)', paddingBottom: 8 } },
              presetRow,
              FIELDS.map(field),
              ocrRow,
              verifyHint,
              footer,
            ),
          )
        }

        return slots.inject('settings.plugin.item', () => slots.register(
          {
            name: 'settings.plugin.item',
            id: 'eye-host',
            order: 40,
            inject: () => ({}),
          },
          (props) => React.createElement(EyeSettingsCard, props),
        ))
      },
    }
  },
})
