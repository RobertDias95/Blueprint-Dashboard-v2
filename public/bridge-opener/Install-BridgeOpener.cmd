@echo off
title Install Bridge opener
setlocal
set "BO_SELF=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:BO_SELF); $i=$s.IndexOf('#'+'== POWERSHELL BELOW =='); if ($i -lt 0) { exit 9 }; Invoke-Expression $s.Substring($i)"
echo.
pause
exit /b
#== POWERSHELL BELOW ==
# Bridge opener - installer (fix-654). Per user, no admin.
#
# 1. Writes the handler to %LOCALAPPDATA%\BridgeOpener\bridge-open.ps1
# 2. Registers the bridge-open: link type under HKCU\Software\Classes
#    (this Windows user only) so the Bridge can open \\bpc-file folders.
# Remove it any time with Uninstall-BridgeOpener.cmd.

$ErrorActionPreference = 'Stop'
$HandlerText = @'
# Bridge opener - fix-654 (P-149)
#
# Opens a folder or a document on \\bpc-file\SoleilData\ from a bridge-open:
# link in the Bridge. Installed per user (no admin) by Install-BridgeOpener.cmd,
# which registers the bridge-open: protocol under HKCU\Software\Classes.
#
# What it does, and all it does:
#   * a FOLDER under \\bpc-file\SoleilData\  -> opens it in File Explorer
#   * a DOCUMENT under \\bpc-file\SoleilData\ (PDF, image, drawing, Office)
#                                            -> opens it with its normal app
#   * anything else                          -> does nothing
# It never runs a program, never opens a path outside \\bpc-file\SoleilData\,
# and never downloads anything.
#
# This file is plain ASCII on purpose: Windows PowerShell 5.1 misreads UTF-8
# without a BOM (fix-647).

param(
  [Parameter(Position = 0)][string]$Link = '',
  # Prints ALLOW <path> or REFUSE and exits without opening anything (tests).
  [switch]$DryRun
)

$AllowedRoot = '\\bpc-file\SoleilData\'
$Scheme = 'bridge-open:'
$DocumentTypes = @(
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff', '.heic',
  '.dwg', '.dxf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt',
  '.mp4', '.mov'
)

# The path a link stands for, or $null when it must be refused.
function Get-BridgePath([string]$link) {
  if ([string]::IsNullOrWhiteSpace($link)) { return $null }
  if (-not $link.StartsWith($Scheme, [StringComparison]::OrdinalIgnoreCase)) { return $null }
  # A browser may add a trailing slash to a custom-scheme link.
  $raw = $link.Substring($Scheme.Length).TrimEnd('/')
  try { $path = [Uri]::UnescapeDataString($raw) } catch { return $null }
  # No control characters, no quotes or wildcards, no forward slashes,
  # no drive letters or stream names (a colon).
  if ($path -match '[\x00-\x1f"*?<>|/:]') { return $null }
  if (-not $path.StartsWith($AllowedRoot, [StringComparison]::OrdinalIgnoreCase)) { return $null }
  $rest = $path.Substring($AllowedRoot.Length).TrimEnd('\')
  if ($rest.Length -eq 0) { return $null }
  foreach ($seg in $rest.Split('\')) {
    # No empty segment (\\ inside the path) and no . or .. (or ... ) segment.
    if ($seg.Length -eq 0 -or $seg -match '^\.+$') { return $null }
  }
  # Belt and braces: what Windows would resolve it to must still be inside.
  try { $full = [IO.Path]::GetFullPath($path) } catch { return $null }
  if (-not $full.StartsWith($AllowedRoot, [StringComparison]::OrdinalIgnoreCase)) { return $null }
  return $path.TrimEnd('\')
}

$path = Get-BridgePath $Link
if ($DryRun) {
  if ($path) { Write-Output ('ALLOW ' + $path) } else { Write-Output 'REFUSE' }
  exit 0
}
if (-not $path) { exit 1 }

try {
  if (Test-Path -LiteralPath $path -PathType Container) {
    $explorer = Join-Path $env:WINDIR 'explorer.exe'
    [void][Diagnostics.Process]::Start($explorer, ('"' + $path + '"'))
    exit 0
  }
  if (Test-Path -LiteralPath $path -PathType Leaf) {
    $ext = [IO.Path]::GetExtension($path).ToLowerInvariant()
    if ($DocumentTypes -notcontains $ext) { exit 3 }
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $path
    $info.UseShellExecute = $true
    [void][Diagnostics.Process]::Start($info)
    exit 0
  }
} catch {
  exit 5
}
exit 4
'@

try {
  $dir = Join-Path $env:LOCALAPPDATA 'BridgeOpener'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $handler = Join-Path $dir 'bridge-open.ps1'
  [IO.File]::WriteAllText($handler, $HandlerText, [Text.Encoding]::ASCII)

  $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $command = '"' + $ps + '" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $handler + '" "%1"'

  $key = 'HKCU:\Software\Classes\bridge-open'
  if (Test-Path $key) { Remove-Item -Path $key -Recurse -Force }
  New-Item -Path "$key\shell\open\command" -Force | Out-Null
  Set-ItemProperty -Path $key -Name '(default)' -Value 'URL:Bridge opener'
  New-ItemProperty -Path $key -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
  New-ItemProperty -Path "$key\shell\open" -Name 'FriendlyAppName' -Value 'Bridge opener' -PropertyType String -Force | Out-Null
  Set-ItemProperty -Path "$key\shell\open\command" -Name '(default)' -Value $command

  Write-Host ''
  Write-Host '  Bridge opener is installed.' -ForegroundColor Green
  Write-Host '  Go back to the Bridge and click "Project folder" on any project.'
  Write-Host ''
} catch {
  Write-Host ''
  Write-Host '  Bridge opener could not be installed:' -ForegroundColor Red
  Write-Host ('  ' + $_.Exception.Message)
  Write-Host '  Nothing else was changed. Send a screenshot of this window to Bobby.'
  Write-Host ''
}
