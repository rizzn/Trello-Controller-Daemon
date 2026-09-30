# Set working directory to the directory of this script
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "==================================================" -ForegroundColor Magenta
Write-Host "  Stopping Trello Inbox Processor Daemon" -ForegroundColor Magenta
Write-Host "==================================================" -ForegroundColor Magenta
Write-Host ""

Write-Host "[*] Disabling TrelloInboxProcessor task..." -ForegroundColor Cyan
schtasks /change /tn "TrelloInboxProcessor" /disable >$null 2>&1

Write-Host "[*] Terminating active Trello Node.js runners..." -ForegroundColor Cyan
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match '[\\/]trello[\\/](global_runner|controller)\.js' } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "[OK] Trello background polling stopped!" -ForegroundColor Green
Write-Host ""
Start-Sleep -Seconds 2
