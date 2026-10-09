[CmdletBinding()]
param([string]$OutputPath='')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
if (-not $OutputPath) {$OutputPath=Join-Path $projectRoot 'dist/red-pitaya-source.zip'}
$OutputPath=[IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $OutputPath) {throw "Archive already exists: $OutputPath"}
New-Item -ItemType Directory -Path (Split-Path $OutputPath -Parent) -Force | Out-Null
& git -C $projectRoot archive --format=zip --output=$OutputPath HEAD
if ($LASTEXITCODE -ne 0) {throw 'Source archive failed; commit the source first'}
Write-Host "Source archive: $OutputPath"
