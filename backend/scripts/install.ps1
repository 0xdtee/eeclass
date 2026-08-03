# 课堂实时字幕 —— 一次性安装
# 用法：在 PowerShell 里运行  .\install.ps1
# 中途会弹一次 Windows 证书信任对话框（安装本机 HTTPS 开发证书），点「是」。

$ErrorActionPreference = 'Stop'
$root   = Split-Path -Parent $PSScriptRoot
$py     = 'C:\workspace\.venv-asr\Scripts\python.exe'
$addin  = Join-Path $root 'addin'
$manifest = Join-Path $addin 'manifest.xml'

function Step($n, $t) { Write-Host "`n[$n] $t" -ForegroundColor Cyan }

Write-Host "课堂实时字幕 · 安装" -ForegroundColor White

# ---------------------------------------------------------------- 1
Step 1 '检查 Python 环境'
if (-not (Test-Path $py)) { throw "找不到 Python: $py" }
& $py -c "import faster_whisper, onnxruntime, soundfile, scipy, numpy; print('  核心依赖 OK')"

Step 2 '安装采集与服务依赖'
& $py -m pip install --quiet --disable-pip-version-check sounddevice soundcard aiohttp pillow comtypes sherpa-onnx
if ($LASTEXITCODE -ne 0) { throw 'pip 安装失败' }
Write-Host '  sounddevice / soundcard / aiohttp / pillow / comtypes / sherpa-onnx OK'
Write-Host '  (FunASR 后端可选，需要时另跑: pip install funasr)' -ForegroundColor DarkGray

# ---------------------------------------------------------------- 3
Step 3 '检查声纹模型'
# 用 eres2netv2 而不是 campplus：实测三人对话里 campplus 只在阈值 0.30 这一个点上
# 准确，eres2netv2 在 0.20~0.40 一整片都准（见 service\speaker.py 顶部说明）。
$spk = Join-Path $root 'service\models\3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx'
if (Test-Path $spk) {
  Write-Host ("  已存在 eres2netv2 声纹模型 ({0:N0} MB)" -f ((Get-Item $spk).Length/1MB))
} else {
  Write-Host '  下载 ERes2NetV2 中文声纹模型 (68MB)…'
  $u = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx'
  New-Item -ItemType Directory -Force -Path (Split-Path $spk) | Out-Null
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -Uri $u -OutFile $spk -UseBasicParsing
  Write-Host '  下载完成'
}

# ---------------------------------------------------------------- 3b
Step 4 '检查识别模型'
$models = @(
  @{ dir = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17'; mb = 1123
     url = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2'
     why = 'SenseVoice —— 默认后端' },
  @{ dir = 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20'; mb = 531
     url = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2'
     why = '流式 zipformer —— 边说边出字时用' },
  @{ dir = 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12'; mb = 285
     url = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12.tar.bz2'
     why = '标点模型 —— 给流式结果补标点' }
)
$mdir = Join-Path $root 'service\models'
New-Item -ItemType Directory -Force -Path $mdir | Out-Null
foreach ($m in $models) {
  $target = Join-Path $mdir $m.dir
  if (Test-Path $target) { Write-Host "  已有 $($m.why)"; continue }
  Write-Host "  下载 $($m.why)（约 $($m.mb) MB）…"
  $tmp = Join-Path $mdir 'dl.tar.bz2'
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -Uri $m.url -OutFile $tmp -UseBasicParsing
  Push-Location $mdir; tar -xjf 'dl.tar.bz2'; Pop-Location
  Remove-Item $tmp -Force
  if (-not (Test-Path $target)) { throw "解压后找不到 $target" }
  Write-Host '    OK'
}

# ---------------------------------------------------------------- 4
Step 5 '生成图标'
& $py (Join-Path $root 'service\gen_icons.py') | Out-Null
Write-Host '  图标 OK'

# ---------------------------------------------------------------- 5
Step 6 '安装本机 HTTPS 开发证书'
$certDir = Join-Path $env:USERPROFILE '.office-addin-dev-certs'
$crt = Join-Path $certDir 'localhost.crt'
if (Test-Path $crt) {
  Write-Host '  证书已存在，跳过'
} else {
  Write-Host '  接下来会弹出证书信任对话框，请点「是」——' -ForegroundColor Yellow
  Write-Host '  这是让 Word 能加载 https://localhost 上的插件页面，只影响本机。' -ForegroundColor Yellow
  npx --yes office-addin-dev-certs install
  if (-not (Test-Path $crt)) { throw '证书生成失败。确认已安装 Node.js，然后重试。' }
  Write-Host '  证书 OK'
}

# ---------------------------------------------------------------- 6
# Word 对 manifest 的校验是静默的：不合规就直接不显示按钮，不报任何错。
# 所以这里先用官方校验器过一遍，不合规就停下来，别让人对着空功能区瞎找。
Step 7 '校验 manifest'
$v = npx --yes office-addin-manifest validate $manifest 2>&1 | Out-String
if ($v -notmatch 'The manifest is valid') {
  Write-Host $v
  throw 'manifest 校验不通过（上面有具体错误）。修好再重跑本脚本。'
}
Write-Host '  manifest 合规'

# ---------------------------------------------------------------- 7
Step 8 '把插件注册到 Word'
$key = 'HKCU:\Software\Microsoft\Office\16.0\WEF\Developer'
if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
New-ItemProperty -Path $key -Name $manifest -Value $manifest -PropertyType String -Force | Out-Null
Write-Host "  已注册: $manifest"

# ---------------------------------------------------------------- 8
Step 9 '检查可用音源'
& $py -c @"
import sys; sys.path.insert(0, r'$root\service')
import audio
for d in audio.list_devices():
    tag = '麦克风  ' if d['kind']=='mic' else '系统声音'
    star = ' <- 默认' if d['default'] else ''
    print(f\"  [{d['id']:>5}] {tag}  {d['name'][:42]}{star}\")
"@

# ---------------------------------------------------------------- 10
Step 10 '桌面快捷方式'
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) '课堂字幕.lnk'
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath = 'powershell.exe'
$sc.Arguments = "-ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'start.ps1')`""
$sc.WorkingDirectory = $root
$sc.IconLocation = 'shell32.dll,138'
$sc.Description = '启动课堂实时字幕服务，并打开控制台'
$sc.Save()
Write-Host "  已放到桌面: 课堂字幕"

Write-Host "`n安装完成。" -ForegroundColor Green
Write-Host @"

接下来：
  1. 双击桌面上的「课堂字幕」   （别关那个黑窗口，关了就停了）
     控制台会自动在浏览器打开
  2. 打开要记笔记的那篇 Word 文档
  3. 在控制台填课程名、选麦克风、选识别引擎，点「开始听课」

字幕会直接写进 Word。控制台页面关掉也不影响录音转写。

注：浏览器控制台就是**正式的操作界面**，不是临时替代品。
功能区上的「课堂字幕」按钮（Office 加载项）在这台机器上不可用——
Word 的 Web 加载项子系统不工作，与本项目代码无关。第 7、8 步的校验和注册
照常做着；就算哪天 Word 恢复了，两个界面也能共存（侧边栏会自动让出写入权）。
"@
