Get-Process -Id (Get-NetTCPConnection -LocalPort 2000).OwningProcess | Stop-Process -Force
