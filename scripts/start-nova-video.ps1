[CmdletBinding()]
param(
  [string]$ProjectRoot = ''
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = Split-Path $PSScriptRoot -Parent
}
$configPath = Join-Path $PSScriptRoot 'nova-video-config.ps1'

if (Test-Path -LiteralPath $configPath) {
  . $configPath
}

$videoPort = if ($NOVA_VIDEO_PORT) { [int]$NOVA_VIDEO_PORT } else { 8189 }
$comfyPort = if ($NOVA_COMFYUI_PORT) { [int]$NOVA_COMFYUI_PORT } else { 8188 }
$comfyRoot = $NOVA_COMFYUI_ROOT
$skipComfy = [bool]$NOVA_SKIP_COMFYUI
if ($NOVA_COMFY_WORKFLOW) {
  $workflow = if ([System.IO.Path]::IsPathRooted($NOVA_COMFY_WORKFLOW)) { [System.IO.Path]::GetFullPath($NOVA_COMFY_WORKFLOW) } else { [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot $NOVA_COMFY_WORKFLOW)) }
} else {
  $workflow = Join-Path $ProjectRoot 'comfyui\wan2.1-t2v-api.json'
}
$logRoot = Join-Path $env:LOCALAPPDATA 'NOVA-AI\logs'

function Test-NovaPort([int]$Port) {
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $client.Connect('127.0.0.1', $Port)
    $client.Dispose()
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'local-video-server.mjs'))) {
  throw "NOVA project not found: $ProjectRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules\ffmpeg-static'))) {
  throw 'NOVA dependencies are missing. Run npm ci once in the project folder before enabling autostart.'
}

New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

if (-not $skipComfy -and -not (Test-NovaPort $comfyPort)) {
  $comfyMain = if ($comfyRoot) { Join-Path $comfyRoot 'main.py' } else { $null }
  if (-not $comfyMain -or -not (Test-Path -LiteralPath $comfyMain)) {
    Write-Warning 'ComfyUI was not started: configure NOVA_COMFYUI_ROOT in scripts\nova-video-config.ps1. Motion Forge remains available.'
  } elseif (-not (Test-Path -LiteralPath $workflow)) {
    Write-Warning "ComfyUI was not started: workflow not found at $workflow. Motion Forge remains available."
  } else {
    $python = (Get-Command python -ErrorAction Stop).Source
    Start-Process -FilePath $python -ArgumentList @($comfyMain, '--listen', '127.0.0.1', '--port', $comfyPort) -WorkingDirectory $comfyRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'comfyui.out.log') -RedirectStandardError (Join-Path $logRoot 'comfyui.err.log')
    Write-Output "Started ComfyUI on port $comfyPort."
  }
}

if (Test-NovaPort $videoPort) {
  Write-Output "NOVA Video Server is already listening on port $videoPort."
  exit 0
}

$node = (Get-Command node -ErrorAction Stop).Source
$env:NOVA_VIDEO_PORT = "$videoPort"
$env:NOVA_COMFYUI_URL = "http://127.0.0.1:$comfyPort"
$env:NOVA_COMFY_WORKFLOW = if ($skipComfy) { '' } else { $workflow }
Start-Process -FilePath $node -ArgumentList 'local-video-server.mjs' -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'video-server.out.log') -RedirectStandardError (Join-Path $logRoot 'video-server.err.log')
Write-Output "Started NOVA Video Server on http://127.0.0.1:$videoPort."
