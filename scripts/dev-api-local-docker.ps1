$ErrorActionPreference = "Stop"

$env:EXECUTOR = "local-docker"

function Import-DotEnv {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  foreach ($rawLine in Get-Content -LiteralPath $Path) {
    $line = $rawLine.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      continue
    }
    $separator = $line.IndexOf("=")
    if ($separator -le 0) {
      continue
    }
    $key = $line.Substring(0, $separator).Trim()
    if (-not $key -or [Environment]::GetEnvironmentVariable($key, "Process")) {
      continue
    }
    $value = $line.Substring($separator + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($key, $value, "Process")
  }
}

function Import-PersistedEnv {
  param([string[]]$Keys)

  foreach ($key in $Keys) {
    if ([Environment]::GetEnvironmentVariable($key, "Process")) {
      continue
    }
    $userValue = [Environment]::GetEnvironmentVariable($key, "User")
    if ($userValue) {
      [Environment]::SetEnvironmentVariable($key, $userValue, "Process")
      continue
    }
    $machineValue = [Environment]::GetEnvironmentVariable($key, "Machine")
    if ($machineValue) {
      [Environment]::SetEnvironmentVariable($key, $machineValue, "Process")
    }
  }
}

function Stop-PortListener {
  param([int]$Port)

  $pids = @()
  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($connections) {
    $pids += @($connections | ForEach-Object { $_.OwningProcess })
  }

  if ($pids.Count -eq 0) {
    $lines = netstat -ano | Select-String -Pattern ":$Port\s+.*LISTENING"
    foreach ($line in $lines) {
      $parts = @($line.ToString() -split "\s+" | Where-Object { $_ })
      if ($parts.Count -gt 0) {
        $pids += $parts[$parts.Count - 1]
      }
    }
  }

  $pids = @($pids | Where-Object { $_ -and [int]$_ -ne $PID } | Select-Object -Unique)
  foreach ($processId in $pids) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
      Write-Host "Stopping stale listener on port ${Port}: PID=$processId Process=$($process.ProcessName)"
      Stop-Process -Id $processId -Force
    }
  }
}

function Add-PathEntry {
  param([string]$PathEntry)
  if (-not $PathEntry -or -not (Test-Path -LiteralPath $PathEntry)) {
    return
  }
  $parts = @($env:Path -split ";" | Where-Object { $_ })
  if ($parts -notcontains $PathEntry) {
    $env:Path = (@($PathEntry) + $parts) -join ";"
    $env:PATH = $env:Path
  }
}

Import-DotEnv -Path (Join-Path (Get-Location) ".env")

Stop-PortListener -Port 4000

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
  $nodeDir = Split-Path -Parent $nodeCommand.Source
  Add-PathEntry $nodeDir
  $npmCli = Join-Path $nodeDir "node_modules\npm\bin\npm-cli.js"
  if (-not $env:NPM_CLI_JS -and (Test-Path -LiteralPath $npmCli)) {
    $env:NPM_CLI_JS = $npmCli
  }
}

$npmCommand = Get-Command npm -ErrorAction SilentlyContinue
if ($npmCommand) {
  Add-PathEntry (Split-Path -Parent $npmCommand.Source)
}

$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
if ($pnpmCommand) {
  Add-PathEntry (Split-Path -Parent $pnpmCommand.Source)
}

if (-not $env:ACR_USERNAME -and -not $env:ALIYUN_ACR_USERNAME -and -not $env:REGISTRY_USERNAME) {
  $env:ACR_USERNAME = "songyu19960525"
}

Import-PersistedEnv -Keys @(
  "ACR_USERNAME",
  "ALIYUN_ACR_USERNAME",
  "REGISTRY_USERNAME",
  "ACR_PASSWORD",
  "ALIYUN_ACR_PASSWORD",
  "REGISTRY_PASSWORD",
  "DOCKER_PASSWORD",
  "GITCODE_TOKEN",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY"
)

if (-not $env:ACR_PASSWORD -and -not $env:ALIYUN_ACR_PASSWORD -and -not $env:REGISTRY_PASSWORD -and -not $env:DOCKER_PASSWORD) {
  throw "ACR/registry password is not set. Set ACR_PASSWORD, ALIYUN_ACR_PASSWORD, REGISTRY_PASSWORD, or DOCKER_PASSWORD in the shell, .env, or Windows user environment."
}

if (-not $env:LOCAL_DOCKER_WORKDIR) {
  $env:LOCAL_DOCKER_WORKDIR = "C:\tmp\deploy-management-local-docker"
}

if (-not $env:GITCODE_TOKEN) {
  Write-Warning "GITCODE_TOKEN is not set. GitCode branch/tag API calls will fail until you set it in this shell or system environment."
}

Write-Host "Starting API with EXECUTOR=local-docker"
Write-Host "DEPLOYMENT_STORAGE=$env:DEPLOYMENT_STORAGE"
Write-Host "LOCAL_DOCKER_WORKDIR=$env:LOCAL_DOCKER_WORKDIR"
Write-Host "NPM_CLI_JS=$env:NPM_CLI_JS"
pnpm dev:api
