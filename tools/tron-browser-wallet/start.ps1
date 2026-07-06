$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8787

Start-Process -FilePath "python" `
  -ArgumentList "-m", "http.server", "$port", "--bind", "127.0.0.1" `
  -WorkingDirectory $root `
  -WindowStyle Hidden

Start-Sleep -Milliseconds 700
Start-Process "http://127.0.0.1:$port/"
