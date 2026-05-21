param(
  [Parameter(Mandatory = $true)]
  [string]$SshTarget,

  [string]$RemoteRoot = "/opt/deploy-management",
  [int]$SshPort = 22,
  [string]$IdentityFile = "",
  [string]$EnvFile = ".env.production",
  [string]$ReleaseName = "",

  [ValidateSet("linux", "darwin", "windows")]
  [string]$BridgeTargetOs = "linux",

  [ValidateSet("amd64", "arm64")]
  [string]$BridgeTargetArch = "amd64",

  [switch]$SkipInstall,
  [switch]$SkipChecks,
  [switch]$SkipRemoteInstall,
  [switch]$UploadOnly,
  [switch]$RestartPm2
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Resolve-RepoRoot {
  $scriptDir = Split-Path -Parent $PSCommandPath
  return (Resolve-Path (Join-Path $scriptDir "..")).Path
}

function Require-Command {
  param([string]$Name)
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Required command '$Name' was not found in PATH."
  }
  return $command.Source
}

function Import-DotEnv {
  param([string]$Path)

  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) {
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

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory = (Get-Location).Path,
    [hashtable]$Environment = @{}
  )

  $oldEnv = @{}
  foreach ($key in $Environment.Keys) {
    $oldEnv[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
    [Environment]::SetEnvironmentVariable($key, [string]$Environment[$key], "Process")
  }

  Push-Location $WorkingDirectory
  try {
    Write-Host ">> $FilePath $($Arguments -join ' ')"
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
  } finally {
    Pop-Location
    foreach ($key in $Environment.Keys) {
      [Environment]::SetEnvironmentVariable($key, $oldEnv[$key], "Process")
    }
  }
}

function Assert-WorkspaceChildPath {
  param(
    [string]$WorkspaceRoot,
    [string]$Path
  )

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $rootWithSeparator = $WorkspaceRoot.TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar
  if (-not $fullPath.StartsWith($rootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refuse to operate outside workspace: $fullPath"
  }
  return $fullPath
}

function Reset-Directory {
  param(
    [string]$WorkspaceRoot,
    [string]$Path
  )

  $fullPath = Assert-WorkspaceChildPath -WorkspaceRoot $WorkspaceRoot -Path $Path
  if (Test-Path -LiteralPath $fullPath) {
    Remove-Item -LiteralPath $fullPath -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $fullPath | Out-Null
  return $fullPath
}

function Copy-RequiredPath {
  param(
    [string]$Source,
    [string]$Destination
  )

  if (-not (Test-Path -LiteralPath $Source)) {
    throw "Required path does not exist: $Source"
  }
  $parent = Split-Path -Parent $Destination
  if ($parent) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

function Copy-OptionalPath {
  param(
    [string]$Source,
    [string]$Destination
  )

  if (Test-Path -LiteralPath $Source) {
    Copy-RequiredPath -Source $Source -Destination $Destination
  }
}

function Quote-Sh {
  param([string]$Value)
  if ($Value -eq "") {
    return "''"
  }
  $singleQuote = "'"
  $escapedSingleQuote = "'" + "\" + "'" + "'"
  return $singleQuote + $Value.Replace($singleQuote, $escapedSingleQuote) + $singleQuote
}

function Ssh-Args {
  $args = @()
  if ($IdentityFile) {
    $args += @("-i", $IdentityFile)
  }
  if ($SshPort -ne 22) {
    $args += @("-p", [string]$SshPort)
  }
  $args += $SshTarget
  return $args
}

function Scp-Args {
  $args = @()
  if ($IdentityFile) {
    $args += @("-i", $IdentityFile)
  }
  if ($SshPort -ne 22) {
    $args += @("-P", [string]$SshPort)
  }
  return $args
}

function Invoke-SshCommand {
  param([string]$Command)
  $ssh = Require-Command "ssh"
  $args = Ssh-Args
  $args += $Command
  Invoke-Checked -FilePath $ssh -Arguments $args
}

function Invoke-ScpUpload {
  param(
    [string]$LocalPath,
    [string]$RemotePath
  )
  $scp = Require-Command "scp"
  $args = Scp-Args
  $args += @($LocalPath, "${SshTarget}:$RemotePath")
  Invoke-Checked -FilePath $scp -Arguments $args
}

function New-RuntimeScript {
  param(
    [string]$Path,
    [string]$Body
  )
  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  Set-Content -LiteralPath $Path -Value $Body -Encoding utf8NoBOM
}

$repoRoot = Resolve-RepoRoot
$pnpm = Require-Command "pnpm"
$go = Require-Command "go"
$tar = Require-Command "tar"

if (-not $ReleaseName) {
  $timestamp = Get-Date -Format "yyyyMMddHHmmss"
  $shortSha = ""
  try {
    $shortSha = (& git -C $repoRoot rev-parse --short HEAD 2>$null).Trim()
  } catch {
    $shortSha = ""
  }
  $ReleaseName = if ($shortSha) { "release-$timestamp-$shortSha" } else { "release-$timestamp" }
}

$envPath = if ([System.IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $repoRoot $EnvFile }
if (Test-Path -LiteralPath $envPath) {
  Write-Step "Loading build environment from $envPath"
  Import-DotEnv -Path $envPath
} else {
  Write-Warning "Env file not found: $envPath. The release will use the server-side shared .env if it exists."
}

$stagingRoot = Join-Path $repoRoot ".codex-tmp\release-bundles"
$releaseWorkDir = Join-Path $stagingRoot $ReleaseName
$bundleDir = Join-Path $releaseWorkDir "bundle"
$bridgeBuildDir = Join-Path $releaseWorkDir "bridge"
$archivePath = Join-Path $releaseWorkDir "$ReleaseName.tar.gz"

Write-Step "Preparing staging directory"
Reset-Directory -WorkspaceRoot $repoRoot -Path $releaseWorkDir | Out-Null
New-Item -ItemType Directory -Force -Path $bundleDir, $bridgeBuildDir | Out-Null

if (-not $SkipInstall) {
  Write-Step "Installing dependencies"
  Invoke-Checked -FilePath $pnpm -Arguments @("install", "--frozen-lockfile") -WorkingDirectory $repoRoot
}

if (-not $SkipChecks) {
  Write-Step "Running type checks"
  Invoke-Checked -FilePath $pnpm -Arguments @("--filter", "@deploy-management/shared", "check") -WorkingDirectory $repoRoot
  Invoke-Checked -FilePath $pnpm -Arguments @("--filter", "@deploy-management/api", "check") -WorkingDirectory $repoRoot
  Invoke-Checked -FilePath $pnpm -Arguments @("--filter", "@deploy-management/web", "check") -WorkingDirectory $repoRoot
}

Write-Step "Building shared package"
Invoke-Checked -FilePath $pnpm -Arguments @("--filter", "@deploy-management/shared", "build") -WorkingDirectory $repoRoot

Write-Step "Building Nest API"
Invoke-Checked -FilePath $pnpm -Arguments @("--filter", "@deploy-management/api", "build") -WorkingDirectory $repoRoot

Write-Step "Building Next web console"
Invoke-Checked -FilePath $pnpm -Arguments @("--filter", "@deploy-management/web", "build") -WorkingDirectory $repoRoot

Write-Step "Building Tekton bridge for $BridgeTargetOs/$BridgeTargetArch"
$bridgeFileName = if ($BridgeTargetOs -eq "windows") { "tekton-bridge.exe" } else { "tekton-bridge" }
$bridgeBinary = Join-Path $bridgeBuildDir $bridgeFileName
Invoke-Checked `
  -FilePath $go `
  -Arguments @("build", "-tags", "tekton", "-o", $bridgeBinary, "./cmd/server") `
  -WorkingDirectory (Join-Path $repoRoot "services\tekton-bridge") `
  -Environment @{
    GOOS = $BridgeTargetOs
    GOARCH = $BridgeTargetArch
    CGO_ENABLED = "0"
  }

Write-Step "Composing release bundle"
Copy-RequiredPath -Source (Join-Path $repoRoot "package.json") -Destination (Join-Path $bundleDir "package.json")
Copy-RequiredPath -Source (Join-Path $repoRoot "pnpm-lock.yaml") -Destination (Join-Path $bundleDir "pnpm-lock.yaml")
Copy-RequiredPath -Source (Join-Path $repoRoot "pnpm-workspace.yaml") -Destination (Join-Path $bundleDir "pnpm-workspace.yaml")
Copy-OptionalPath -Source (Join-Path $repoRoot "README.md") -Destination (Join-Path $bundleDir "README.md")

if (Test-Path -LiteralPath $envPath) {
  Copy-RequiredPath -Source $envPath -Destination (Join-Path $bundleDir ".env")
}

Copy-RequiredPath -Source (Join-Path $repoRoot "apps\api\package.json") -Destination (Join-Path $bundleDir "apps\api\package.json")
Copy-RequiredPath -Source (Join-Path $repoRoot "apps\api\dist") -Destination (Join-Path $bundleDir "apps\api\dist")

Copy-RequiredPath -Source (Join-Path $repoRoot "apps\web\package.json") -Destination (Join-Path $bundleDir "apps\web\package.json")
Copy-RequiredPath -Source (Join-Path $repoRoot "apps\web\.next") -Destination (Join-Path $bundleDir "apps\web\.next")
Copy-OptionalPath -Source (Join-Path $repoRoot "apps\web\public") -Destination (Join-Path $bundleDir "apps\web\public")
foreach ($configFile in Get-ChildItem -LiteralPath (Join-Path $repoRoot "apps\web") -Filter "next.config.*" -File) {
  Copy-RequiredPath -Source $configFile.FullName -Destination (Join-Path $bundleDir "apps\web\$($configFile.Name)")
}

Copy-RequiredPath -Source (Join-Path $repoRoot "packages\shared\package.json") -Destination (Join-Path $bundleDir "packages\shared\package.json")
Copy-RequiredPath -Source (Join-Path $repoRoot "packages\shared\dist") -Destination (Join-Path $bundleDir "packages\shared\dist")

Copy-RequiredPath -Source $bridgeBinary -Destination (Join-Path $bundleDir "services\tekton-bridge\tekton-bridge")

New-RuntimeScript -Path (Join-Path $bundleDir "scripts\runtime\run-api.sh") -Body @'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
exec pnpm --filter @deploy-management/api start
'@

New-RuntimeScript -Path (Join-Path $bundleDir "scripts\runtime\run-web.sh") -Body @'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
exec pnpm --filter @deploy-management/web exec next start --hostname "${WEB_HOST:-127.0.0.1}" --port "${WEB_PORT:-3000}"
'@

New-RuntimeScript -Path (Join-Path $bundleDir "scripts\runtime\run-tekton-bridge.sh") -Body @'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
exec ./services/tekton-bridge/tekton-bridge
'@

New-RuntimeScript -Path (Join-Path $bundleDir "ecosystem.config.cjs") -Body @'
module.exports = {
  apps: [
    {
      name: "dm-api",
      cwd: __dirname,
      script: "./scripts/runtime/run-api.sh",
      env: { NODE_ENV: "production" },
    },
    {
      name: "dm-web",
      cwd: __dirname,
      script: "./scripts/runtime/run-web.sh",
      env: { NODE_ENV: "production" },
    },
    {
      name: "dm-tekton-bridge",
      cwd: __dirname,
      script: "./scripts/runtime/run-tekton-bridge.sh",
      env: { NODE_ENV: "production" },
    },
  ],
};
'@

Write-Step "Creating release archive"
Invoke-Checked -FilePath $tar -Arguments @("-czf", $archivePath, "-C", $bundleDir, ".") -WorkingDirectory $repoRoot

$remoteIncomingDir = "$RemoteRoot/incoming"
$remoteArchive = "$remoteIncomingDir/$ReleaseName.tar.gz"

Write-Step "Preparing remote directory"
Invoke-SshCommand -Command "mkdir -p $(Quote-Sh $remoteIncomingDir) $(Quote-Sh "$RemoteRoot/releases") $(Quote-Sh "$RemoteRoot/shared")"

Write-Step "Uploading release archive"
Invoke-ScpUpload -LocalPath $archivePath -RemotePath $remoteArchive

if (-not $UploadOnly) {
  Write-Step "Uploading remote activation script"
  $remoteScriptLocalPath = Join-Path $releaseWorkDir "activate-$ReleaseName.sh"
  $remoteScriptPath = "$remoteIncomingDir/activate-$ReleaseName.sh"
  $restartPm2Value = if ($RestartPm2) { "true" } else { "false" }
  $skipRemoteInstallValue = if ($SkipRemoteInstall) { "true" } else { "false" }
  $quotedRemoteRoot = Quote-Sh $RemoteRoot
  $quotedReleaseName = Quote-Sh $ReleaseName
  $quotedRestartPm2 = Quote-Sh $restartPm2Value
  $quotedSkipRemoteInstall = Quote-Sh $skipRemoteInstallValue

  Set-Content -LiteralPath $remoteScriptLocalPath -Encoding utf8NoBOM -Value @"
#!/usr/bin/env bash
set -euo pipefail

remote_root=$quotedRemoteRoot
release_name=$quotedReleaseName
restart_pm2=$quotedRestartPm2
skip_remote_install=$quotedSkipRemoteInstall

incoming_dir="`$remote_root/incoming"
release_dir="`$remote_root/releases/`$release_name"
shared_dir="`$remote_root/shared"
current_link="`$remote_root/current"
archive_path="`$incoming_dir/`$release_name.tar.gz"

mkdir -p "`$release_dir" "`$shared_dir"
tar -xzf "`$archive_path" -C "`$release_dir"

if [ -f "`$release_dir/.env" ]; then
  cp "`$release_dir/.env" "`$shared_dir/.env"
  chmod 600 "`$shared_dir/.env" || true
fi

if [ -f "`$shared_dir/.env" ]; then
  ln -sfn "`$shared_dir/.env" "`$release_dir/.env"
else
  echo "WARN: `$shared_dir/.env does not exist. Runtime services may miss required secrets."
fi

cd "`$release_dir"
if command -v corepack >/dev/null 2>&1; then
  corepack enable
fi

if [ "`$skip_remote_install" != "true" ]; then
  pnpm install --prod --frozen-lockfile
fi

chmod +x "`$release_dir/scripts/runtime/"*.sh || true
chmod +x "`$release_dir/services/tekton-bridge/tekton-bridge" || true
ln -sfn "`$release_dir" "`$current_link"

if [ "`$restart_pm2" = "true" ]; then
  if ! command -v pm2 >/dev/null 2>&1; then
    echo "ERROR: pm2 is not installed on remote server."
    exit 1
  fi
  pm2 startOrReload "`$current_link/ecosystem.config.cjs" --update-env
  pm2 save
else
  cat <<INFO
Release activated at: `$release_dir
Current symlink: `$current_link

Start or reload services manually:
  cd `$current_link
  pm2 startOrReload ecosystem.config.cjs --update-env
  pm2 save
INFO
fi
"@

  Invoke-ScpUpload -LocalPath $remoteScriptLocalPath -RemotePath $remoteScriptPath

  Write-Step "Activating remote release"
  Invoke-SshCommand -Command "bash $(Quote-Sh $remoteScriptPath)"
}

Write-Step "Done"
Write-Host "Release: $ReleaseName"
Write-Host "Archive: $archivePath"
Write-Host "Remote:  ${SshTarget}:$remoteArchive"
