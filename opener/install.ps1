# Bridge opener - installer (fix-654). Per user, no admin.
#
# 1. Writes the handler to %LOCALAPPDATA%\BridgeOpener\bridge-open.ps1
# 2. Registers the bridge-open: link type under HKCU\Software\Classes
#    (this Windows user only) so the Bridge can open \\bpc-file folders.
# Remove it any time with Uninstall-BridgeOpener.cmd.

$ErrorActionPreference = 'Stop'
$HandlerText = @'
__HANDLER__
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
