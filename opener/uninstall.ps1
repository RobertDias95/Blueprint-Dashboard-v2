# Bridge opener - uninstaller (fix-654). Per user, no admin.
# Removes the bridge-open: link type and the handler folder. Nothing else.

$ErrorActionPreference = 'Stop'
try {
  $key = 'HKCU:\Software\Classes\bridge-open'
  if (Test-Path $key) { Remove-Item -Path $key -Recurse -Force }
  $dir = Join-Path $env:LOCALAPPDATA 'BridgeOpener'
  if (Test-Path $dir) { Remove-Item -Path $dir -Recurse -Force }
  Write-Host ''
  Write-Host '  Bridge opener is removed.' -ForegroundColor Green
  Write-Host '  "Project folder" in the Bridge will now only copy the path.'
  Write-Host ''
} catch {
  Write-Host ''
  Write-Host '  Bridge opener could not be removed:' -ForegroundColor Red
  Write-Host ('  ' + $_.Exception.Message)
  Write-Host ''
}
