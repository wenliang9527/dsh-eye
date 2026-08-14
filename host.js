// ============================================================
//  eye — HOST half
//  👁 给纯文本模型配"外挂的眼睛":eye_see 工具
//  图片 → (OCR + 在线 VLM) → 纯文本 → 注入模型上下文
//  使用:把本文件内容粘贴到 cordis_define 的 code.host(idPrefix: "eye")
// ============================================================
return {
  apply(ctx) {
    const fs = ctx.get('fs')
    const sandboxPolicy = ctx.get('sandboxPolicy')
    if (fs === undefined || sandboxPolicy === undefined) return

    // ---- Windows WinRT OCR 脚本(PowerShell 5.1),首次使用时写入工作区 .eye/ ----
    const OCR_PS1 = [
      'param([string]$Path)',
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
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
      '  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])',
      '  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])',
      '  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])',
      '  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])',
      '} catch {',
      '  Write-Output "__OCR_ERROR__: $($_.Exception.Message)"',
      '  exit 1',
      '}',
      '$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()',
      'if ($null -eq $engine) {',
      '  $langs = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages',
      '  if ($langs.Count -gt 0) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($langs[0]) }',
      '}',
      'if ($null -eq $engine) { Write-Output "__OCR_UNAVAILABLE__"; exit 0 }',
      '$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])',
      'foreach ($line in $result.Lines) { Write-Output $line.Text }',
    ].join('\r\n') + '\r\n'

    // ---- VLM 描述脚本(独立 node,OpenAI 兼容 chat/completions),首次使用时写入 .eye/ ----
    const VLM_MJS = [
      "import { readFileSync } from 'node:fs'",
      'const [imagePath, configPath] = process.argv.slice(2)',
      "const cfg = JSON.parse(readFileSync(configPath, 'utf8'))",
      'const vlm = cfg && cfg.vlm',
      'if (!vlm || !vlm.url || !vlm.model || !vlm.apiKey) {',
      "  console.error('eye.config.json 缺少 vlm.url / vlm.model / vlm.apiKey')",
      '  process.exit(3)',
      '}',
      'const lower = String(imagePath).toLowerCase()',
      "const mime = lower.endsWith('.png') ? 'image/png' : lower.endsWith('.webp') ? 'image/webp' : lower.endsWith('.gif') ? 'image/gif' : 'image/jpeg'",
      "const b64 = readFileSync(imagePath).toString('base64')",
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

    const resolveExe = async (sub, name, fallback) => {
      try { return await sub.resolveExecutable(name) } catch (e) { return fallback }
    }

    // 跑一个子进程并收集输出(collect 流,超时 100s 兜底 terminate)
    const runSub = async (sub, argv, maxOut) => {
      const handle = sub.spawn({
        argv,
        cwd: root,
        stdio: {
          stdin: 'ignore',
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

    // 核心:看一张图,返回纯文本
    const see = async (filePath, mode) => {
      const sub = ctx.get('subprocess')
      if (sub === undefined) return { ok: false, text: 'eye: subprocess 服务不可用' }
      const lower = String(filePath).toLowerCase()
      if (!/\.(png|jpe?g|webp|gif)$/.test(lower)) {
        return { ok: false, text: 'eye: 只支持 png/jpg/jpeg/webp/gif(得到 ' + filePath + ')' }
      }
      try {
        // 解析图片路径
        const imgTarget = await fs.resolve(filePath, { cwd: root })
        const imgInfo = await fs.stat(imgTarget)
        if (!imgInfo) return { ok: false, text: 'eye: 文件不存在: ' + filePath }
        const imgPath = fs.processPath(imgTarget)

        // 确保辅助脚本存在(首次调用写入)
        const ensure = async (name, content) => {
          const t = await fs.resolve('.eye/' + name, { cwd: root })
          const info = await fs.stat(t)
          if (!info) await fs.writeText(t, content, undefined, undefined, policy)
          return fs.processPath(t)
        }
        const ocrScriptPath = await ensure('eye-ocr.ps1', OCR_PS1)
        const vlmScriptPath = await ensure('eye-vlm.mjs', VLM_MJS)

        // 配置(.eye/eye.config.json,缺失时写模板)
        const cfgTarget = await fs.resolve('.eye/eye.config.json', { cwd: root })
        let cfg = {}
        const cfgInfo = await fs.stat(cfgTarget)
        if (cfgInfo) {
          try { cfg = JSON.parse(await fs.readText(cfgTarget)) } catch (e) { cfg = {} }
        } else {
          await fs.writeText(cfgTarget, '{\n  "vlm": { "url": "", "model": "", "apiKey": "" },\n  "ocr": true\n}\n', undefined, undefined, policy)
        }
        const cfgPath = fs.processPath(cfgTarget)

        const ocrEnabled = cfg.ocr !== false
        const vlmConfigured = !!(cfg.vlm && cfg.vlm.url && cfg.vlm.model && cfg.vlm.apiKey)
        const doOcr = ocrEnabled && (mode === 'auto' || mode === 'ocr')
        const doVlm = (mode === 'auto' || mode === 'vlm') && (vlmConfigured || mode === 'vlm')

        // OCR:Windows 自带 WinRT OCR(PowerShell 5.1)
        let ocrText = ''
        if (doOcr) {
          const ps = await resolveExe(sub, 'powershell', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
          const r = await runSub(sub, [ps, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ocrScriptPath, imgPath], 1000000)
          const out = r.stdout.trim()
          if (out === '__OCR_UNAVAILABLE__') ocrText = '[OCR 不可用:系统未安装 OCR 语言包]'
          else if (r.exitCode !== 0 && out.startsWith('__OCR_ERROR__')) ocrText = out
          else ocrText = out
        }

        // VLM:OpenAI 兼容接口(node 自带 TLS,沙箱下可用)
        let vlmText = ''
        if (doVlm) {
          if (!vlmConfigured) {
            vlmText = '[VLM 未配置: 在 ' + cfgPath + ' 填写 vlm.url / vlm.model / vlm.apiKey]'
          } else {
            const node = await resolveExe(sub, 'node', 'node')
            const r = await runSub(sub, [node, vlmScriptPath, imgPath, cfgPath], 4000000)
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

    const disposers = []
    const tool = harness.defineTool({
      name: 'eye_see',
      description: '读取图片并把内容转成纯文本(OCR + VLM 双路径)供纯文本模型理解:OCR 提取文字, VLM 生成语义描述。配置: .eye/eye.config.json',
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
