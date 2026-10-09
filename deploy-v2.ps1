[CmdletBinding()]
param([string]$Device='192.168.10.68',[string]$User='root',[string]$IdentityFile='',[string]$KnownHostsFile='',[switch]$Rollback)
$ErrorActionPreference='Stop'
$sshOptions=@('-o','StrictHostKeyChecking=ask')
if (-not $KnownHostsFile -and (Test-Path -LiteralPath "$PSScriptRoot/.redpitaya_known_hosts")) {
    $KnownHostsFile="$PSScriptRoot/.redpitaya_known_hosts"
}
if ($KnownHostsFile) {$sshOptions=@('-o',"UserKnownHostsFile=$KnownHostsFile",'-o','StrictHostKeyChecking=yes')}
if ($IdentityFile) {$sshOptions+=@('-i',$IdentityFile)}
if ($Rollback) {
    & ssh.exe @sshOptions "${User}@${Device}" 'bash /opt/redpitaya/www/apps/hann_scope/rollback-board.sh'
    if ($LASTEXITCODE -ne 0) {throw 'Rollback failed'}
    exit
}
$token=[Guid]::NewGuid().ToString('N')
$archive=Join-Path ([IO.Path]::GetTempPath()) "hann-scope-$token.tar.gz"
$remote="/tmp/hann_scope-stage-$token"
try {
    & tar.exe --exclude=__pycache__ --exclude=data --exclude=*.o --exclude=*.so --exclude=hann-hardware -czf $archive -C (Join-Path $PSScriptRoot 'app') .
    if ($LASTEXITCODE -ne 0) {throw 'Packaging failed'}
    & scp.exe @sshOptions $archive "${User}@${Device}:$remote.tar.gz"
    if ($LASTEXITCODE -ne 0) {throw 'Upload failed; existing application has not been changed'}
    & ssh.exe @sshOptions "${User}@${Device}" "set -e; mkdir '$remote'; tar -xzf '$remote.tar.gz' -C '$remote'; bash '$remote/install-board.sh'"
    if ($LASTEXITCODE -ne 0) {throw 'Board installation failed; inspect output before retrying'}
    Write-Host "Updated Hann Burst Scope: http://$Device/hann_scope/"
} finally {
    if (Test-Path -LiteralPath $archive) {Remove-Item -LiteralPath $archive}
}
