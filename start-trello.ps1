# Set working directory to the directory of this script
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "==================================================" -ForegroundColor Magenta
Write-Host "  Starting Trello Inbox Processor Daemon" -ForegroundColor Magenta
Write-Host "==================================================" -ForegroundColor Magenta
Write-Host ""

# Check if Trello runner is already running
$trelloRunner = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*global_runner.js*" }
if ($trelloRunner) {
    Write-Host "[-] Trello Inbox Processor is already running (PID: $($trelloRunner.ProcessId)). Skipping start." -ForegroundColor Yellow
} else {
    Write-Host "[*] Enabling TrelloInboxProcessor task..." -ForegroundColor Cyan
    $taskCheck = Get-ScheduledTask -TaskName "TrelloInboxProcessor" -ErrorAction SilentlyContinue
    if (-not $taskCheck) {
        Write-Host "[!] Task 'TrelloInboxProcessor' not found. Installing task..." -ForegroundColor Yellow
        powershell -ExecutionPolicy Bypass -File install_daemon.ps1
    } else {
        schtasks /change /tn "TrelloInboxProcessor" /enable >$null 2>&1
        Write-Host "[*] Running TrelloInboxProcessor task immediately..." -ForegroundColor Cyan
        schtasks /run /tn "TrelloInboxProcessor" >$null 2>&1
    }
    Write-Host ""
    Write-Host "[OK] Trello daemon scheduled task has been started!" -ForegroundColor Green
    Write-Host "     (It runs silently in the background every minute)" -ForegroundColor Green
}

Write-Host ""
Start-Sleep -Seconds 2
