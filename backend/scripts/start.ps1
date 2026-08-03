# 启动课堂字幕服务。上课前跑一次，别关窗口。
$root = Split-Path -Parent $PSScriptRoot
$py = 'C:\workspace\.venv-asr\Scripts\python.exe'

$crt = Join-Path $env:USERPROFILE '.office-addin-dev-certs\localhost.crt'
if (-not (Test-Path $crt)) {
  Write-Host '还没装 HTTPS 证书，请先运行 install.ps1' -ForegroundColor Red
  Read-Host '按回车退出'
  exit 1
}

$host.UI.RawUI.WindowTitle = '课堂实时字幕服务'

# 端口从 config.json 读（注意：PS 5.1 默认按 ANSI 读文件，中文配置必须指定 UTF8）
$port = 5901
try {
  $cfg = Get-Content (Join-Path $root 'service\config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($cfg.server.port) { $port = $cfg.server.port }
} catch { }

# 端口已经被占着的话，先弄清楚是谁占的，别直接冲过去撞一屏 traceback。
# 最常见的情况：服务其实已经在跑了（上个窗口没关 / 在后台）——那就直接开控制台。
$busy = $null
try {
  $c = New-Object Net.Sockets.TcpClient
  $c.Connect('127.0.0.1', $port)
  $c.Close()
  $busy = $true
} catch { $busy = $false }

if ($busy) {
  $owner = $null
  $line = netstat -ano | Select-String ":$port\s.*LISTENING" | Select-Object -First 1
  if ($line) {
    $ownerPid = ($line -split '\s+')[-1]
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerPid" -ErrorAction SilentlyContinue
  }
  if ($owner -and $owner.CommandLine -match 'server\.py') {
    Write-Host "服务已经在运行了（进程 $($owner.ProcessId)），不用重复启动。" -ForegroundColor Yellow
    Write-Host "直接打开控制台…" -ForegroundColor Yellow
    Start-Process "https://localhost:$port/panel.html"
    Write-Host "`n（想彻底重启：先关掉那个进程，或运行 Get-Process python ^| Stop-Process -Force）"
    Read-Host '按回车关闭'
    exit 0
  }
  Write-Host "端口 $port 被别的程序占着：$(if ($owner) { "$($owner.Name) (PID $($owner.ProcessId))" } else { '未知进程' })" -ForegroundColor Red
  Write-Host "请关掉它，或改 service\config.json 里的 server.port 换个端口。" -ForegroundColor Red
  Read-Host '按回车退出'
  exit 1
}

# 服务起来之后自动打开控制台页面（服务本身是阻塞的，所以用后台作业等）。
# 就绪判断用**裸 TCP 探测**，不要用 Invoke-WebRequest：后者要过 TLS 握手、
# 证书校验和系统代理，任何一环不顺就一直失败，那样这个循环会空转到超时才开浏览器
# ——服务两三秒就好了，人却要干等二十秒。端口能连上就等于服务已经在监听了。
$null = Start-Job -ScriptBlock {
  param($p, $u)
  for ($i = 0; $i -lt 120; $i++) {
    try {
      $c = New-Object Net.Sockets.TcpClient
      $c.Connect('127.0.0.1', $p)
      $c.Close()
      break
    } catch { Start-Sleep -Milliseconds 250 }
  }
  Start-Process "$u/panel.html"
} -ArgumentList $port, "https://localhost:$port"

Write-Host '正在启动…（第一次开课会加载识别模型，约 10-40 秒）' -ForegroundColor Cyan
Write-Host "控制台稍后会自动在浏览器打开：https://localhost:$port/panel.html" -ForegroundColor Cyan
& $py (Join-Path $root 'service\server.py')

Write-Host "`n服务已停止。" -ForegroundColor Yellow
Read-Host '按回车关闭'
