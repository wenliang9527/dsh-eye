// ============================================================
//  eye — HOST half
//  👁 给纯文本模型配"外挂的眼睛"
//  1) eye_see 工具:本地图片路径 → OCR + VLM → 纯文本
//  2) llm/stream 拦截:聊天上传的图片块 → 自动转文本(突破图片发不出去的限制)
//  使用:把本文件内容粘贴到 cordis_define 的 code.host(idPrefix: "eye")
// ============================================================
return {
  apply(ctx) {
    const fs = ctx.get('fs')
    const sandboxPolicy = ctx.get('sandboxPolicy')
    const llm = ctx.get('llm')
    if (fs === undefined || sandboxPolicy === undefined || llm === undefined) return

    // ---- Windows WinRT OCR 脚本(stdin 收 base64,PowerShell 5.1)----
    const OCR_STDIN_PS1 = [
      'param()',
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
      '$b64 = [Console]::In.ReadToEnd().Trim()',
      'if ($b64.Length -eq 0) { Write-Output "__OCR_ERROR__: empty stdin"; exit 1 }',
      '$tmp = Join-Path $env:TEMP ("eye-ocr-" + [guid]::NewGuid().ToString("N") + ".png")',
      '[IO.File]::WriteAllBytes($tmp, [Convert]::FromBase64String($b64))',
      'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
      "$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
      'function Await($WinRtTask, $ResultType) {',
      '  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)',
      '  $netTask = $asTask.Invoke($null, @($WinRtTask))',
      '  $netTask.Wait(-1) | Out-Null',
      '  $netTask.Result',
      '}',
      '[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] > $null',
      '[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] > $null',
      '[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime] > $null',
      'try {',
      '  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($tmp)) ([Windows.Storage.StorageFile])',
      '  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])',
      '  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])',
      '  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])',
      '} catch {',
      '  Write-Output "__OCR_ERROR__: $($_.Exception.Message)"',
      '  Remove-Item $tmp -Force -ErrorAction SilentlyContinue',
      '  exit 1',
      '}',
      '$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()',
      'if ($null -eq $engine) {',
      '  $langs = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages',
      '  if ($langs.Count -gt 0) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($langs[0]) }',
      '}',
      'if ($null -eq $engine) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue; Write-Output "__OCR_UNAVAILABLE__"; exit 0 }',
      '$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])',
      'foreach ($line in $result.Lines) { Write-Output $line.Text }',
      'Remove-Item $tmp -Force -ErrorAction SilentlyContinue',
    ].join('\r\n') + '\r\n'

    // ---- VLM 描述脚本(stdin 收 base64,独立 node,OpenAI 兼容)----
    const VLM_STDIN_MJS = [
      "import { readFileSync } from 'node:fs'",
      'const [configPath, mediaType] = process.argv.slice(2)',
      "const b64 = readFileSync(0, 'utf8').trim()",
      "if (!b64) { console.error('empty stdin'); process.exit(2) }",
      "const cfg = JSON.parse(readFileSync(configPath, 'utf8'))",
      'const vlm = cfg && cfg.vlm',
      'if (!vlm || !vlm.url || !vlm.model || !vlm.apiKey) {',
      "  console.error('eye.config.json 缺少 vlm.url / vlm.model / vlm.apiKey')",
      '  process.exit(3)',
      '}',
      "const mime = /^image\\/(png|jpeg|webp|gif)$/.test(mediaType || '') ? mediaType : 'image/png'",
      "const prompt = vlm.prompt || '请详细描述这张图片:包括画面内容、图表数据、界面元素、文字等。'",
      'const res = await fetch(vlm.url, {',
      "  method: 'POST',",
      "  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + vlm.apiKey },",
      '  body: JSON.stringify({',
      '    model: vlm.model,',
      "    messages: [{ role: 'user', content: [",
      "      { type: 'text', text: prompt },",
      "      { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },",
      '    ] }],',
      '    max_tokens: 1024,',
      '  }),',
      '  signal: AbortSignal.timeout(90000),',
      '})',
      'if (!res.ok) {',
      '  const body = (await res.text()).slice(0, 800)',
      '  console.error(`VLM HTTP ${res.status}: ${body}`)',
      '  process.exit(2)',
      '}',
      'const json = await res.json()',
      'const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content',
      "if (typeof content !== 'string') { console.error('VLM 响应缺少 choices[0].message.content'); process.exit(2) }",
      'console.log(content)',
    ].join('\n') + '\n'

    const policy = sandboxPolicy.resolve()
    const root = policy.workspaceRoot || sandboxPolicy.workspaceRoot
    const disposers = []

    // ---------- 工具函数 ----------
    const resolveExe = async (sub, name, fallback) => {
      try { return await sub.resolveExecutable(name) } catch (e) { return fallback }
    }

    // 跑子进程并收集输出(stdin 可选,100s 超时兜底 terminate)
    const runSub = async (sub, argv, maxOut, stdinData) => {
      const handle = sub.spawn({
        argv,
        cwd: root,
        stdio: {
          stdin: stdinData !== undefined ? { data: stdinData } : 'ignore',
          stdout: { maxBytes: maxOut, spill: { maxBytes: 8 * 1024 * 1024 } },
          stderr: { maxBytes: maxOut, spill: { maxBytes: 8 * 1024 * 1024 } },
        },
        graceMs: 3000,
      })
      let killTimer
      const timers = ctx.get('timer')
      if (timers) killTimer = timers.timeout(() => { try { handle.terminate() } catch (e) {} }, 100000)
      const outcome = await handle.done
      if (killTimer) killTimer()
      const read = (r) => { try { return r.readFrom(0).text } catch (e) { return '' } }
      return { exitCode: outcome.exitCode, stdout: read(handle.collected.stdout), stderr: read(handle.collected.stderr) }
    }

    const bytesToBase64 = (bytes) => {
      let binary = ''
      const chunk = 0x8000
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
      }
      return btoa(binary)
    }

    const mediaTypeForPath = (p) => {
      const lower = String(p).toLowerCase()
      if (lower.endsWith('.png')) return 'image/png'
      if (lower.endsWith('.webp')) return 'image/webp'
      if (lower.endsWith('.gif')) return 'image/gif'
      return 'image/jpeg'
    }

    const ensure = async (name, content) => {
      const t = await fs.resolve('.eye/' + name, { cwd: root })
      const info = await fs.stat(t)
      if (!info) await fs.writeText(t, content, undefined, undefined, policy)
      return fs.processPath(t)
    }

    const loadConfig = async () => {
      const cfgTarget = await fs.resolve('.eye/eye.config.json', { cwd: root })
      let cfg = {}
      const cfgInfo = await fs.stat(cfgTarget)
      if (cfgInfo) {
        try { cfg = JSON.parse(await fs.readText(cfgTarget)) } catch (e) { cfg = {} }
      } else {
        await fs.writeText(cfgTarget, '{\n  "vlm": { "url": "", "model": "", "apiKey": "" },\n  "ocr": true\n}\n', undefined, undefined, policy)
      }
      return { cfg, cfgPath: fs.processPath(cfgTarget) }
    }

    // 一张图(base64)→ 文本(OCR + VLM 双路径)
    const describeBytes = async (b64, mediaType, cfg, cfgPath) => {
      const sub = ctx.get('subprocess')
      if (sub === undefined) return '[eye: subprocess 服务不可用]'
      const ocrScriptPath = await ensure('eye-ocr-stdin.ps1', OCR_STDIN_PS1)
      const vlmScriptPath = await ensure('eye-vlm-stdin.mjs', VLM_STDIN_MJS)
      const parts = []
      if (cfg.ocr !== false) {
        const ps = await resolveExe(sub, 'powershell', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
        const r = await runSub(sub, [ps, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ocrScriptPath], 1000000, b64)
        const out = r.stdout.trim()
        if (out === '__OCR_UNAVAILABLE__') parts.push('[OCR 不可用: 系统未安装 OCR 语言包]')
        else if (r.exitCode !== 0 && out.startsWith('__OCR_ERROR__')) parts.push(out)
        else parts.push(out)
      }
      if (cfg.vlm && cfg.vlm.url && cfg.vlm.model && cfg.vlm.apiKey) {
        const node = await resolveExe(sub, 'node', 'node')
        const r = await runSub(sub, [node, vlmScriptPath, cfgPath, mediaType || 'image/png'], 4000000, b64)
        if (r.exitCode === 0) parts.push(r.stdout.trim())
        else parts.push('[VLM 失败: ' + (r.stderr.trim() || 'exit ' + r.exitCode) + ']')
      }
      return parts.length > 0 ? parts.join('\n') : '[eye: 无可用的视觉路径]'
    }

    // ---------- 虚拟模型提供商 eye-vision:声称支持图片,转发给 deepseek-official ----------
    // 注意:本部署中真实 deepseek 适配器的提供商 id 是 deepseek-official(不是 deepseek)
    const VISION_PROVIDER = 'eye-vision'
    const TARGET_PROVIDER = 'deepseek-official'

    const visionAdapter = {
      providerInfo(provider) {
        return { id: provider, name: 'eye 视觉桥(deepseek)' }
      },
      providerRetryPolicy() {},
      async listModels(provider) {
        try {
          const models = await llm.listModels(TARGET_PROVIDER)
          // 运行时校验要求 model.provider === provider,必须重映射为 eye-vision
          return Array.isArray(models)
            ? models.map((m) => ({
                provider,
                id: m.id,
                name: m.name,
                ...(m.description !== undefined ? { description: m.description } : {}),
              }))
            : []
        } catch (e) { return [] }
      },
      async resolveModel(provider, model, signal) {
        let base = null
        try { base = await llm.resolveModelInfo(TARGET_PROVIDER, model, signal) } catch (e) {}
        return {
          provider,
          id: model,
          name: model,
          inputModalities: ['text', 'image'],
          ...(base && base.context ? { context: base.context } : {}),
          ...(base && base.defaultMaxTokens !== undefined ? { defaultMaxTokens: base.defaultMaxTokens } : {}),
          ...(base && base.reasoning ? { reasoning: base.reasoning } : {}),
        }
      },
      async *stream(options) {
        yield* llm.stream({ ...options, provider: TARGET_PROVIDER })
      },
    }
    disposers.push(llm.registerAdapter([VISION_PROVIDER], visionAdapter))

    // ---------- llm/stream 拦截:图片块 → eye 文本 ----------
    // 注意:waterfall 调度器对监听器做 yield*(listener(...)),监听器必须返回异步可迭代对象,
    // 因此必须是 async generator(普通 async 函数返回 Promise 会报 "not async iterable")
    const onLlmStream = async function* (options, next) {
      try {
        const messages = options && Array.isArray(options.messages) ? options.messages : []
        const hasImage = messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b && b.type === 'image'))
        if (!hasImage) { yield* next(); return }
        // 路由门控:看真正执行模型(eye-vision 会转发给 deepseek)是否支持图片
        const effectiveProvider = options.provider === VISION_PROVIDER ? TARGET_PROVIDER : options.provider
        try {
          const info = await llm.resolveModelInfo(effectiveProvider, options.model)
          if (info && Array.isArray(info.inputModalities) && info.inputModalities.includes('image')) { yield* next(); return }
        } catch (e) {}
        const attachments = ctx.get('attachments')
        if (attachments === undefined) { yield* next(); return }
        const { cfg, cfgPath } = await loadConfig()
        const transformed = []
        for (const message of messages) {
          const content = message.content
          if (!Array.isArray(content) || !content.some((b) => b && b.type === 'image')) {
            transformed.push(message)
            continue
          }
          const blocks = []
          for (const block of content) {
            if (block.type !== 'image') { blocks.push(block); continue }
            const ref = block.attachment
            if (!ref || !ref.attachmentId) { blocks.push(block); continue }
            try {
              const stored = await attachments.readImage(ref, undefined)
              const data = stored && stored.data ? stored.data : null
              if (!data) { blocks.push(block); continue }
              const b64 = bytesToBase64(data)
              const text = await describeBytes(b64, ref.mediaType || 'image/png', cfg, cfgPath)
              blocks.push({ type: 'text', text: '[用户上传的图片已由 eye 转换为文本(图片本身已展示在会话中)]\n' + text })
            } catch (err) {
              const message = err && err.message ? err.message : String(err)
              blocks.push({ type: 'text', text: '[eye 转换图片失败: ' + message + ']' })
            }
          }
          transformed.push({ ...message, content: blocks })
        }
        // 重入 llm.stream(手建请求不受深度冻结限制);转换后无图片块,各 listener 直接放行
        yield* llm.stream({ ...options, messages: transformed })
      } catch (err) {
        yield* next()
      }
    }
    disposers.push(ctx.on('llm/stream', onLlmStream))

    // ---------- eye_see 工具(直接看本地文件:readBytes + stdin 脚本) ----------
    const see = async (filePath, mode) => {
      const sub = ctx.get('subprocess')
      if (sub === undefined) return { ok: false, text: 'eye: subprocess 服务不可用' }
      const lower = String(filePath).toLowerCase()
      if (!/\.(png|jpe?g|webp|gif)$/.test(lower)) {
        return { ok: false, text: 'eye: 只支持 png/jpg/jpeg/webp/gif(得到 ' + filePath + ')' }
      }
      try {
        const imgTarget = await fs.resolve(filePath, { cwd: root })
        const imgInfo = await fs.stat(imgTarget)
        if (!imgInfo) return { ok: false, text: 'eye: 文件不存在: ' + filePath }
        const data = await fs.readBytes(imgTarget, undefined, 10 * 1024 * 1024)
        const b64 = bytesToBase64(data)
        const { cfg, cfgPath } = await loadConfig()
        const ocrEnabled = cfg.ocr !== false
        const vlmConfigured = !!(cfg.vlm && cfg.vlm.url && cfg.vlm.model && cfg.vlm.apiKey)
        const doOcr = ocrEnabled && (mode === 'auto' || mode === 'ocr')
        const doVlm = (mode === 'auto' || mode === 'vlm') && (vlmConfigured || mode === 'vlm')
        const ocrScriptPath = await ensure('eye-ocr-stdin.ps1', OCR_STDIN_PS1)
        const vlmScriptPath = await ensure('eye-vlm-stdin.mjs', VLM_STDIN_MJS)
        let ocrText = ''
        if (doOcr) {
          const ps = await resolveExe(sub, 'powershell', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
          const r = await runSub(sub, [ps, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ocrScriptPath], 1000000, b64)
          const out = r.stdout.trim()
          if (out === '__OCR_UNAVAILABLE__') ocrText = '[OCR 不可用:系统未安装 OCR 语言包]'
          else if (r.exitCode !== 0 && out.startsWith('__OCR_ERROR__')) ocrText = out
          else ocrText = out
        }
        let vlmText = ''
        if (doVlm) {
          if (!vlmConfigured) {
            vlmText = '[VLM 未配置: 在 ' + cfgPath + ' 填写 vlm.url / vlm.model / vlm.apiKey]'
          } else {
            const node = await resolveExe(sub, 'node', 'node')
            const r = await runSub(sub, [node, vlmScriptPath, cfgPath, mediaTypeForPath(filePath)], 4000000, b64)
            if (r.exitCode === 0) vlmText = r.stdout.trim()
            else vlmText = '[VLM 失败: ' + (r.stderr.trim() || 'exit ' + r.exitCode) + ']'
          }
        }
        const parts = []
        parts.push('[eye] 图片: ' + filePath)
        if (ocrText) parts.push('<OCR>\n' + ocrText)
        if (vlmText) parts.push('<VLM>\n' + vlmText)
        return { ok: true, text: parts.join('\n\n') }
      } catch (err) {
        const message = err && err.message ? err.message : String(err)
        return { ok: false, text: 'eye 失败: ' + message }
      }
    }

    const tool = harness.defineTool({
      name: 'eye_see',
      description: '读取图片并把内容转成纯文本(OCR + VLM 双路径)供纯文本模型理解:配置 .eye/eye.config.json',
      parameters: {
        file_path: { type: 'string', required: true, description: '图片路径(png/jpg/jpeg/webp/gif)' },
        mode: { type: 'string', enum: ['auto', 'ocr', 'vlm'] },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            text: { type: 'string', required: true },
          },
        },
        render(args, value) {
          return [{ type: 'text', text: value && value.text ? value.text : String(value) }]
        },
      },
      execute: async (args) => see(args.file_path, args.mode || 'auto'),
    })
    disposers.push(harness.registerTool(ctx, tool))

    return () => {
      for (const d of disposers) {
        if (typeof d === 'function') d()
      }
    }
  },
}
