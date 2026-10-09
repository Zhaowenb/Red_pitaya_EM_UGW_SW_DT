[CmdletBinding()]
param([string]$Device='192.168.10.68',[string]$User='root',[string]$IdentityFile='',[string]$AppId='hann_scope',[switch]$Rollback)
if ($AppId -ne 'hann_scope') {throw 'This upgrade replaces hann_scope only'}
& "$PSScriptRoot/deploy-v2.ps1" -Device $Device -User $User -IdentityFile $IdentityFile -Rollback:$Rollback
