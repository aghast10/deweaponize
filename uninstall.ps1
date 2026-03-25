# Uninstaller for De-Weaponize (Windows)
# Removes the scheduled task and optionally the cloned repo.

$ErrorActionPreference = 'Stop'

$InstallDir = if ($env:DWZ_DIR) { $env:DWZ_DIR } else { "$HOME\deweaponize" }
$TaskName = 'DwzProxy'

# Remove scheduled task
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'."
} else {
    Write-Host "Scheduled task '$TaskName' not found — nothing to remove."
}

# Optionally remove repo
if (Test-Path $InstallDir) {
    $answer = Read-Host "Delete $InstallDir? (y/N)"
    if ($answer -eq 'y') {
        Remove-Item -Recurse -Force $InstallDir
        Write-Host "Removed $InstallDir."
    } else {
        Write-Host "Kept $InstallDir."
    }
}

Write-Host 'Done.'
