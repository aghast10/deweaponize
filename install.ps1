# One-line installer for De-Weaponize (Windows)
# Usage: irm https://raw.githubusercontent.com/nicopi/deweaponize/main/install.ps1 | iex

$ErrorActionPreference = 'Stop'

$InstallDir = if ($env:DWZ_DIR) { $env:DWZ_DIR } else { "$HOME\deweaponize" }
$TaskName = 'DwzProxy'

# Check dependencies
foreach ($cmd in @('node', 'git', 'claude')) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Error "$cmd is not installed."
        if ($cmd -eq 'node') { Write-Host '  Install from https://nodejs.org/' }
        if ($cmd -eq 'claude') { Write-Host '  Install from https://docs.anthropic.com/en/docs/claude-code' }
        exit 1
    }
}

# Clone or update
if (Test-Path "$InstallDir\.git") {
    Write-Host "Updating existing install at $InstallDir..."
    git -C $InstallDir pull --ff-only
} else {
    Write-Host "Cloning to $InstallDir..."
    git clone https://github.com/nicopi/deweaponize.git $InstallDir
}

# Install proxy as a scheduled task (runs at logon, restarts on failure)
$NodePath = (Get-Command node).Source
$ProxyScript = Join-Path $InstallDir 'proxy.js'

# Remove existing task if present
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "Removing existing $TaskName scheduled task..."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$Action = New-ScheduledTaskAction -Execute $NodePath -Argument "`"$ProxyScript`"" -WorkingDirectory $InstallDir
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Seconds 10) `
    -ExecutionTimeLimit (New-TimeSpan -Duration 0)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description 'De-Weaponize local proxy (bridges extension to claude CLI)' | Out-Null

# Start now
Start-ScheduledTask -TaskName $TaskName

Write-Host ''
Write-Host 'Done! Proxy is running.'
Write-Host "  status:    Get-ScheduledTask -TaskName $TaskName"
Write-Host "  stop:      Stop-ScheduledTask -TaskName $TaskName"
Write-Host "  uninstall: Unregister-ScheduledTask -TaskName $TaskName"
Write-Host ''
Write-Host 'Now load the extension in Firefox:'
Write-Host "  1. Open about:debugging#/runtime/this-firefox"
Write-Host "  2. Click 'Load Temporary Add-on'"
Write-Host "  3. Select $InstallDir\manifest.json"
