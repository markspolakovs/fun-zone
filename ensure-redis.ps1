$redis = Get-Process -Name redis-server -ErrorAction SilentlyContinue
if ($redis) {
    Write-Host "Redis is running."
} else {
    Write-Host "Starting Redis..."
    Start-Process powershell -Argument redis-server.ps1
}