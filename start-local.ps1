param([string]$PythonExe = "", [int]$Port = 4826)
$ErrorActionPreference = 'Stop'
if (-not $PythonExe) {
    $bundledPython = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
    if (Test-Path -LiteralPath $bundledPython) { $PythonExe = $bundledPython }
    else { $PythonExe = (Get-Command python -ErrorAction Stop).Source }
}
$env:HANNSCOPE_DATA = Join-Path $PSScriptRoot 'app/data'
Push-Location (Join-Path $PSScriptRoot 'app')
try {
    Write-Host "本机模式：http://127.0.0.1:$Port/measure（测试请在网页勾选仿真）"
    & $PythonExe -m redscope.server --host 127.0.0.1 --port $Port
} finally { Pop-Location }
