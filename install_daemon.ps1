# Trello Controller Daemon - Windows Installation & Configuration Script
# Registers a task to run silently every 1 minute, which executes a 10-second polling loop inside.

$vbsPath = Resolve-Path (Join-Path $PSScriptRoot "run_silent.vbs") | Select-Object -ExpandProperty Path
$taskName = "TrelloInboxProcessor"

Write-Host "Setting up Trello Daemon scheduled task..."

# Check if task already exists
$taskExists = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if ($taskExists) {
    Write-Host "Task already exists. Recreating it to update the interval..."
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

# Create action: Run wscript.exe with the VBS file path
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbsPath`""

# Create trigger: Daily starting now
$trigger = New-ScheduledTaskTrigger -Daily -At (Get-Date).ToString("HH:mm")

# Configure settings (allow running on battery, start when available)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# Register the task under the current user context
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings

# Adjust the trigger repetition to 1 minute
$task = Get-ScheduledTask -TaskName $taskName
$task.Triggers[0].Repetition.Interval = "PT1M"
$task.Triggers[0].Repetition.Duration = "P365D"
$task | Set-ScheduledTask

Write-Host "Success! Trello Daemon task is configured to run silently (polling every 10 seconds)." -ForegroundColor Green
