# Runs the backend (uvicorn --reload) and the frontend (Vite HMR) together.
# Invoked by `just run dev`. Ctrl+C in the Vite process stops both.
#
# Every target frees its port before binding it. Two reasons this is not
# optional: PowerShell often skips the `finally` below on Ctrl+C, leaving the
# detached backend alive; and a survivor makes the *next* start a silent no-op,
# because the new uvicorn fails to bind 8000, exits, and the old process keeps
# answering with the environment it read at its own start. Uvicorn reads
# --env-file once at startup, so that stale process serves stale .env values
# (password, ROADMAP_READONLY) however many times you restart around it.
param(
    [ValidateSet("dev", "backend", "frontend")]
    [string]$Target = "dev"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$uvicornArgs = @("run", "uvicorn", "app.main:app", "--env-file", "../.env", "--reload", "--port", "8000")

function Clear-Port {
    param([int]$Port)

    $owners = @(
        Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
    )
    foreach ($processId in $owners) {
        if ($processId -eq 0 -or $processId -eq $PID) { continue }
        $name = (Get-Process -Id $processId -ErrorAction SilentlyContinue).ProcessName
        Write-Host "Port $Port held by PID $processId ($name) -- stopping it." -ForegroundColor Yellow
        taskkill /PID $processId /T /F | Out-Null
    }

    # taskkill returns before the socket is released; wait for it rather than
    # racing the bind.
    for ($i = 0; $i -lt 40; $i++) {
        if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
            return
        }
        Start-Sleep -Milliseconds 100
    }
    throw "Port $Port is still in use after 4s. Find the owner with: Get-NetTCPConnection -LocalPort $Port -State Listen"
}

switch ($Target) {
    "backend" {
        Clear-Port 8000
        Set-Location $backend
        & uv @uvicornArgs
    }
    "frontend" {
        Clear-Port 5173
        Set-Location $frontend
        & npm run dev
    }
    "dev" {
        Clear-Port 8000
        Clear-Port 5173
        $proc = Start-Process -PassThru -WorkingDirectory $backend -FilePath "uv" -ArgumentList $uvicornArgs
        try {
            Set-Location $frontend
            & npm run dev
        } finally {
            if ($proc -and -not $proc.HasExited) {
                taskkill /PID $proc.Id /T /F | Out-Null
            }
        }
    }
}
