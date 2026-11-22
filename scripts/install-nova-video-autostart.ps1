[CmdletBinding(SupportsShouldProcess)]
param(
  [switch]$Install,
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$taskName = 'NOVA AI Video Server'
$scriptPath = Join-Path $PSScriptRoot 'start-nova-video.ps1'

if ($Install -and $Remove) { throw 'Use either -Install or -Remove.' }
if (-not $Install -and -not $Remove) {
  Write-Output 'Dry run only. Use -Install to register the task or -Remove to unregister it.'
  exit 0
}

if ($Remove) {
  if ($PSCmdlet.ShouldProcess($taskName, 'Remove scheduled task')) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output 'NOVA Video Server autostart removed.'
  }
  exit 0
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
if ($PSCmdlet.ShouldProcess($taskName, 'Register at user logon')) {
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Starts the local NOVA AI video companion after this user signs in.' -Force | Out-Null
  Write-Output 'NOVA Video Server will start automatically after this user signs in.'
}
