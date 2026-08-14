'use strict'
// ============================================================
//  dsh-eye-host — eye 视觉桥(永久版,原生 cordis 插件,无外部依赖)
//  1) eye-vision 虚拟提供商:声称支持图片,流式转发给 deepseek-official
//  2) llm/stream 拦截:聊天上传图片块 → OCR+VLM → 文本
//  3) eye_see 工具:本地图片路径 → 文本
//  配置:.eye/eye.config.json(会话工作区根目录,gitignore)
// ============================================================

const REF_TO_PNG_B64_MJS = [
  "import sharp from 'sharp'",
  "import { readFileSync, existsSync } from 'node:fs'",
  "import path from 'node:path'",
  "import { stdout } from 'node:process'",
  'const [src] = process.argv.slice(2)',
  'const resolveSrc = (s) => {',
  "  if (typeof s === 'string' && s.startsWith('sha256:')) {",
  "    const hex = s.slice(7)",
  "    const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || 'C:\\\\Users\\\\default', '.dsh')",
  "    return path.join(home, 'attachments', 'v1', 'objects', hex.slice(0, 2), hex)",
  '  }',
  '  return s',
  '}',
  'const file = resolveSrc(src)',
  "if (!existsSync(file)) { console.error('file not found: ' + file); process.exit(2) }",
  'const buf = readFileSync(file)',
  'const outBuf = await sharp(buf, { limitInputPixels: 100000000 })',
  "  .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })",
  '  .png()',
  '  .toBuffer()',
  "stdout.write(outBuf.toString('base64'))",
].join('\n') + '\n'

const OCR_STDIN_PS1 = [
  'param()',
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
  '$b64 = [Console]::In.ReadToEnd().Trim()',
  'if ($b64.Length -eq 0) { Write-Output "__OCR_ERROR__: empty stdin"; exit 1 }',
  '$tmp = Join-Path $env:TEMP ("eye-ocr-" + [guid]::NewGuid().ToString("N") + ".png")',
  'try { [IO.File]::WriteAllBytes($tmp, [Convert]::FromBase64String($b64)) } catch { Write-Output "__OCR_ERROR__: bad base64: $($_.Exception.Message)"; exit 1 }',
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
  '  $ex = $_.Exception',
  '  while ($ex.InnerException) { $ex = $ex.InnerException }',
  '  Write-Output "__OCR_ERROR__: $($ex.Message)"',
  '  Remove-Item $tmp -Force -ErrorAction SilentlyContinue',
  '  exit 1',
  '}',
  '$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()',
  'if ($null -eq $engine) {',
  '  $langs = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages',
  '  if ($langs.Count -gt 0) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($langs[0]) }',
  '}',
  'if ($null -eq $engine) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue; Write-Output "__OCR_UNAVAILABLE__"; exit 0 }',
  'try {',
  '  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])',
  '} catch {',
  '  $ex = $_.Exception',
  '  while ($ex.InnerException) { $ex = $ex.InnerException }',
  '  Write-Output "__OCR_ERROR__: $($ex.Message)"',
  '  Remove-Item $tmp -Force -ErrorAction SilentlyContinue',
  '  exit 1',
  '}',
  'foreach ($line in $result.Lines) { Write-Output $line.Text }',
  'Remove-Item $tmp -Force -ErrorAction SilentlyContinue',
].join('\r\n') + '\r\n'

const VLM_FILE_MJS = [
  "import { readFileSync, existsSync } from 'node:fs'",
  "import path from 'node:path'",
  'const [src, mediaType, configPath] = process.argv.slice(2)',
  'const resolveSrc = (s) => {',
  "  if (typeof s === 'string' && s.startsWith('sha256:')) {",
  "    const hex = s.slice(7)",
  "    const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || 'C:\\\\Users\\\\default', '.dsh')",
  "    return path.join(home, 'attachments', 'v1', 'objects', hex.slice(0, 2), hex)",
  '  }',
  '  return s',
  '}',
  'const file = resolveSrc(src)',
  "if (!existsSync(file)) { console.error('file not found: ' + file); process.exit(2) }",
  "const cfg = JSON.parse(readFileSync(configPath, 'utf8'))",
  'const vlm = cfg && cfg.vlm',
  "if (!vlm || !vlm.url || !vlm.model || !vlm.apiKey) { console.error('eye.config.json 缺少 vlm.url / vlm.model / vlm.apiKey'); process.exit(3) }",
  "const mime = /^image\\/(png|jpeg|webp|gif)$/.test(mediaType || '') ? mediaType : 'image/png'",
  "const b64 = readFileSync(file).toString('base64')",
  "const prompt = vlm.prompt || '请详细描述这张图片:包括画面内容、图表数据、界面元素、文字等。'",
  'const res = await fetch(vlm.url, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + vlm.apiKey }, body: JSON.stringify({ model: vlm.model, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }] }], max_tokens: 1024 }), signal: AbortSignal.timeout(90000) })',
  'if (!res.ok) { const body = (await res.text()).slice(0, 800); console.error(`VLM HTTP ${res.status}: ${body}`); process.exit(2) }',
  'const json = await res.json()',
  'const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content',
  "if (typeof content !== 'string') { console.error('VLM 响应缺少 choices[0].message.content'); process.exit(2) }",
  'console.log(content)',
].join('\n') + '\n'

module.exports = {
  name: 'dsh-eye-host',
  // Cordis inject:声明硬依赖,所有服务就绪后才执行 apply。
  // 不能用 ctx.get() 拿服务(启动早期服务未注册会静默失败)——这是
  // 重启后"不自动启动"的根因,参考 dsh-vision 的 inject: ["llm", ...]。
  inject: ['fs', 'sandboxPolicy', 'llm', 'subprocess', 'timer', 'tools'],
  apply(ctx) {
    const fs = ctx.fs
    const sandboxPolicy = ctx.sandboxPolicy
    const llm = ctx.llm

    const policy = sandboxPolicy.resolve()
    const root = policy.workspaceRoot || sandboxPolicy.workspaceRoot
    const disposers = []

    const resolveExe = async (sub, name, fallback) => {
      try { return await sub.resolveExecutable(name) } catch (e) { return fallback }
    }

    const runSub = async (sub, argv, maxOut, stdinData) => {
      const handle = sub.spawn({
        argv,
        cwd: root,
        stdio: {
          stdin: stdinData !== undefined ? { data: stdinData } : 'ignore',
          stdout: { maxBytes: maxOut, spill: { maxBytes: 32 * 1024 * 1024 } },
          stderr: { maxBytes: maxOut, spill: { maxBytes: 32 * 1024 * 1024 } },
        },
        graceMs: 3000,
      })
      let killTimer
      const timers = ctx.timer
      if (timers) killTimer = timers.timeout(() => { try { handle.terminate() } catch (e) {} }, 100000)
      const outcome = await handle.done
      if (killTimer) killTimer()
      const read = (r) => { try { return r.readFrom(0).text } catch (e) { return '' } }
      return { exitCode: outcome.exitCode, stdout: read(handle.collected.stdout), stderr: read(handle.collected.stderr) }
    }

    const ensure = async (name, content) => {
      const t = await fs.resolve('.eye/' + name, { cwd: root })
      await fs.writeText(t, content, undefined, undefined, policy)
      return fs.processPath(t)
    }

    const loadConfig = async () => {
      const cfgTarget = await fs.resolve('.eye/eye.config.json', { cwd: root })
      let cfg = {}
      const cfgInfo = await fs.stat(cfgTarget)
      if (cfgInfo) { try { cfg = JSON.parse(await fs.readText(cfgTarget)) } catch (e) { cfg = {} } }
      else { await fs.writeText(cfgTarget, '{\n  "vlm": { "url": "", "model": "", "apiKey": "" },\n  "ocr": true\n}\n', undefined, undefined, policy) }
      return { cfg, cfgPath: fs.processPath(cfgTarget) }
    }

    const describeImage = async (src, mediaType, cfg, cfgPath) => {
      const sub = ctx.subprocess
      if (!sub) return '[eye: subprocess 服务不可用]'
      const toPngPath = await ensure('eye-to-png-b64.mjs', REF_TO_PNG_B64_MJS)
      const ocrPs1 = await ensure('eye-ocr-stdin.ps1', OCR_STDIN_PS1)
      const vlmMjs = await ensure('eye-vlm-file.mjs', VLM_FILE_MJS)
      const node = await resolveExe(sub, 'node', 'C:\\Program Files\\nodejs\\node.exe')
      const ps = await resolveExe(sub, 'powershell', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
      const parts = []
      if (cfg.ocr !== false) {
        const conv = await runSub(sub, [node, toPngPath, src], 16 * 1024 * 1024)
        const pngB64 = conv.stdout.trim()
        if (conv.exitCode !== 0 || !pngB64) {
          parts.push('[图片转换失败: exit=' + conv.exitCode + ' stderr=' + (conv.stderr.trim() || '(empty)') + ']')
        } else {
          const r = await runSub(sub, [ps, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ocrPs1], 1000000, pngB64)
          const out = r.stdout.trim()
          if (out === '__OCR_UNAVAILABLE__') parts.push('[OCR 不可用: 系统未安装 OCR 语言包]')
          else if (r.exitCode !== 0 && out.startsWith('__OCR_ERROR__')) parts.push(out)
          else parts.push(out)
        }
      }
      if (cfg.vlm && cfg.vlm.url && cfg.vlm.model && cfg.vlm.apiKey) {
        const r = await runSub(sub, [node, vlmMjs, src, mediaType || 'image/png', cfgPath], 4000000)
        if (r.exitCode === 0) parts.push(r.stdout.trim())
        else parts.push('[VLM 失败: ' + (r.stderr.trim() || 'exit ' + r.exitCode) + ']')
      }
      return parts.length > 0 ? parts.join('\n') : '[eye: 无可用的视觉路径]'
    }

    // ---- eye-vision 虚拟提供商:声称支持图片,转发给 deepseek-official ----
    const VISION_PROVIDER = 'eye-vision'
    const TARGET_PROVIDER = 'deepseek-official'

    const visionAdapter = {
      providerInfo(provider) { return { id: provider, name: 'eye 视觉桥(deepseek)' } },
      providerRetryPolicy() {},
      async listModels(provider) {
        try {
          const models = await llm.listModels(TARGET_PROVIDER)
          return Array.isArray(models) ? models.map((m) => ({ provider, id: m.id, name: m.name, ...(m.description !== undefined ? { description: m.description } : {}) })) : []
        } catch (e) { return [] }
      },
      async resolveModel(provider, model, signal) {
        let base = null
        try { base = await llm.resolveModelInfo(TARGET_PROVIDER, model, signal) } catch (e) {}
        return { provider, id: model, name: model, inputModalities: ['text', 'image'], ...(base && base.context ? { context: base.context } : {}), ...(base && base.defaultMaxTokens !== undefined ? { defaultMaxTokens: base.defaultMaxTokens } : {}), ...(base && base.reasoning ? { reasoning: base.reasoning } : {}) }
      },
      async *stream(options) { yield* llm.stream({ ...options, provider: TARGET_PROVIDER }) },
    }
    disposers.push(llm.registerAdapter([VISION_PROVIDER], visionAdapter))

    // ---- llm/stream 拦截:图片块 → eye 文本 ----
    const onLlmStream = async function* (options, next) {
      try {
        const messages = options && Array.isArray(options.messages) ? options.messages : []
        const hasImage = messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b && b.type === 'image'))
        if (!hasImage) { yield* next(); return }
        const effectiveProvider = options.provider === VISION_PROVIDER ? TARGET_PROVIDER : options.provider
        try {
          const info = await llm.resolveModelInfo(effectiveProvider, options.model)
          if (info && Array.isArray(info.inputModalities) && info.inputModalities.includes('image')) { yield* next(); return }
        } catch (e) {}
        const { cfg, cfgPath } = await loadConfig()
        const transformed = []
        for (const message of messages) {
          const content = message.content
          if (!Array.isArray(content) || !content.some((b) => b && b.type === 'image')) { transformed.push(message); continue }
          const blocks = []
          for (const block of content) {
            if (block.type !== 'image') { blocks.push(block); continue }
            const ref = block.attachment
            if (!ref || !ref.attachmentId) { blocks.push(block); continue }
            try {
              const text = await describeImage(ref.attachmentId, ref.mediaType || 'image/png', cfg, cfgPath)
              blocks.push({ type: 'text', text: '[用户上传的图片已由 eye 转换为文本(图片本身已展示在会话中)]\n' + text })
            } catch (err) { blocks.push({ type: 'text', text: '[eye 转换图片失败: ' + String(err && err.message || err) + ']' }) }
          }
          transformed.push({ ...message, content: blocks })
        }
        yield* llm.stream({ ...options, messages: transformed })
      } catch (err) { yield* next() }
    }
    disposers.push(ctx.on('llm/stream', onLlmStream))

    // ---- eye_see 工具(JSON-schema 形式,无外部依赖)----
    const mediaTypeForPath = (p) => {
      const lower = String(p).toLowerCase()
      if (lower.endsWith('.png')) return 'image/png'
      if (lower.endsWith('.webp')) return 'image/webp'
      if (lower.endsWith('.gif')) return 'image/gif'
      return 'image/jpeg'
    }

    const see = async (filePath, mode) => {
      const lower = String(filePath).toLowerCase()
      if (!/\.(png|jpe?g|webp|gif)$/.test(lower)) return { ok: false, text: 'eye: 只支持 png/jpg/jpeg/webp/gif(得到 ' + filePath + ')' }
      try {
        const imgTarget = await fs.resolve(filePath, { cwd: root })
        const imgInfo = await fs.stat(imgTarget)
        if (!imgInfo) return { ok: false, text: 'eye: 文件不存在: ' + filePath }
        const imgPath = fs.processPath(imgTarget)
        const { cfg, cfgPath } = await loadConfig()
        const ocrEnabled = cfg.ocr !== false
        const vlmConfigured = !!(cfg.vlm && cfg.vlm.url && cfg.vlm.model && cfg.vlm.apiKey)
        const doOcr = ocrEnabled && (mode === 'auto' || mode === 'ocr')
        const doVlm = (mode === 'auto' || mode === 'vlm') && (vlmConfigured || mode === 'vlm')
        if (!doOcr && !doVlm) return { ok: true, text: '[eye] 当前模式下无可用的路径' }
        const text = await describeImage(imgPath, mediaTypeForPath(filePath), { ...cfg, ocr: doOcr, vlm: doVlm ? cfg.vlm : undefined }, cfgPath)
        return { ok: true, text: '[eye] 图片: ' + filePath + '\n\n' + text }
      } catch (err) { return { ok: false, text: 'eye 失败: ' + String(err && err.message || err) } }
    }

    const tool = {
      name: 'eye_see',
      description: '读取图片并把内容转成纯文本(OCR + VLM 双路径)供纯文本模型理解:配置 .eye/eye.config.json',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '图片路径(png/jpg/jpeg/webp/gif)' },
          mode: { type: 'string', enum: ['auto', 'ocr', 'vlm'] },
        },
        required: ['file_path'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            text: { type: 'string' },
          },
          required: ['ok', 'text'],
        },
        render(args, value) {
          return [{ type: 'text', text: value && value.text ? value.text : String(value) }]
        },
      },
      execute: async (args) => see(args.file_path, args.mode || 'auto'),
    }
    const tools = ctx.tools
    if (tools) disposers.push(tools.register(tool))

    return () => {
      for (const d of disposers) {
        if (typeof d === 'function') d()
        else if (d && typeof d === 'object' && typeof d.dispose === 'function') d.dispose()
      }
    }
  },
}
