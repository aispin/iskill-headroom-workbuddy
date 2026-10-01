# iskill-headroom-workbuddy · Windows 入口（PowerShell）
#
# 用法（PowerShell 里）：
#   .\hwb.ps1              # 交互菜单
#   .\hwb.ps1 start        # 启动
#   .\hwb.ps1 status       # 查看状态
#
# ⚠️ Windows 上**双击 .ps1 默认是打开记事本**，不是执行。要「双击就跑」请用同目录的
#    hwb.cmd（它用 -ExecutionPolicy Bypass 调起本脚本）。
#
# 本文件刻意保持极薄：真逻辑在 scripts\hwb.py（跨平台一份代码）。

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"
$SkillDir = $PSScriptRoot

function Find-Python {
    # 1) 环境变量显式指定
    if ($env:ISKILL_PYTHON -and (Test-Path $env:ISKILL_PYTHON)) { return $env:ISKILL_PYTHON }
    # 2) py -3（Windows 官方启动器，最可靠）
    $pyLauncher = Get-Command "py" -ErrorAction SilentlyContinue
    if ($pyLauncher) {
        $exe = & $pyLauncher.Source -3 -c "import sys;print(sys.executable)" 2>$null
        if ($LASTEXITCODE -eq 0 -and $exe) { return $exe.Trim() }
    }
    # 3) PATH 里的 python / python3
    foreach ($name in @("python", "python3")) {
        $c = Get-Command $name -ErrorAction SilentlyContinue
        if ($c) { return $c.Source }
    }
    # 4) 常见安装位置兜底
    foreach ($guess in @(
        "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
        "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
        "C:\Python313\python.exe")) {
        if (Test-Path $guess) { return $guess }
    }
    return $null
}

$py = Find-Python
if (-not $py) {
    Write-Host ""
    Write-Host "找不到 Python 3。" -ForegroundColor Red
    Write-Host "  · 到 https://www.python.org/downloads/windows/ 装一个（安装时勾选 Add python.exe to PATH）"
    Write-Host "  · 或先跑：winget install -e --id Python.Python.3.13"
    Write-Host ""
    Read-Host "按回车键关闭窗口"
    exit 1
}

$script = Join-Path $SkillDir "scripts\hwb.py"
& $py $script @args
$rc = $LASTEXITCODE

if ($args.Count -eq 0) {
    Write-Host ""
    Read-Host "按回车键关闭窗口"
}
exit $rc
