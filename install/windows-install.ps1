[CmdletBinding()]
param(
  [string]$Tarball,
  [string]$DesktopDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness'),
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$version = '0.1.0'
if (-not $Tarball) {
  $candidates = @((Join-Path $PSScriptRoot "dsh-chrome-$version.tgz"), (Join-Path (Split-Path -Parent $PSScriptRoot) "dist\dsh-chrome-$version.tgz"))
  $Tarball = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  if (-not $Tarball) { throw 'Companion package is missing. Place the release .tgz beside this installer.' }
}
$archive = (Resolve-Path -LiteralPath $Tarball).Path
if ([IO.Path]::GetExtension($archive) -ne '.tgz') { throw 'Choose the companion .tgz package.' }
$desktop = [IO.Path]::GetFullPath($DesktopDirectory)
$executable = Join-Path $desktop 'DeepSeek Harness.exe'
$cli = Join-Path $desktop 'resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$destination = Join-Path $dshHome ('chrome\companion\' + $version)
$setup = Join-Path $destination 'install\cli.js'
$plan = [ordered]@{ state='awaiting-user'; executable=$executable; cli=$cli; installArguments=@('plugin','--profile','desktop','add',$archive); destination=$destination; setup=$setup; instructions='After installation, restart DeepSeek Harness and load the Chrome extension. Readiness requires a real connection handshake.' }
if ($DryRun) { $plan | ConvertTo-Json -Depth 5; exit 0 }
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'Existing DeepSeek Harness desktop installation not found. Install and initialize it first; this installer does not install another dsh.' }
if (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue) { throw 'Fully quit DeepSeek Harness before running the companion installer, then launch it again afterward.' }
$previousNodeMode = $env:ELECTRON_RUN_AS_NODE
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('dsh-chrome-install-' + [guid]::NewGuid().ToString('N'))
try {
  $entries = @(& tar.exe -tzf $archive)
  if ($LASTEXITCODE -ne 0 -or -not $entries.Count) { throw 'Cannot inspect companion package.' }
  foreach ($entry in $entries) {
    if ($entry -notmatch '^package/' -or $entry -match '(^|[/\\])\.\.([/\\]|$)' -or $entry.Contains(':')) { throw 'Unsafe companion archive entry.' }
  }
  New-Item -ItemType Directory -Path $temporary | Out-Null
  & tar.exe -xzf $archive -C $temporary
  if ($LASTEXITCODE -ne 0) { throw 'Cannot extract companion package.' }
  $source = Join-Path $temporary 'package'
  $release = Get-Content -LiteralPath (Join-Path $source 'release.json') -Raw | ConvertFrom-Json
  if ($release.version -ne $version -or $release.extensionId -ne 'hnlecbcnoomfbcifohincedegbhmiked') { throw 'Companion package does not match this installer release.' }
  $env:ELECTRON_RUN_AS_NODE = '1'
  & $executable --expose-internals $cli plugin --profile desktop add $archive
  if ($LASTEXITCODE -ne 0) { throw 'Desktop plugin installation failed. Bridge registration was not changed.' }
  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  foreach ($entry in @('native','shared','install','extension','release.json','package.json')) {
    Copy-Item -LiteralPath (Join-Path $source $entry) -Destination $destination -Recurse -Force
  }
  & $executable $setup setup
  if ($LASTEXITCODE -ne 0) { throw 'Native host registration failed. Run the installer again to repair it.' }
} finally {
  $env:ELECTRON_RUN_AS_NODE = $previousNodeMode
  # The generated absolute directory is scoped to the Windows temporary directory.
  if ((Split-Path -Parent $temporary) -eq ([IO.Path]::GetTempPath()).TrimEnd('\') -and (Test-Path -LiteralPath $temporary)) { Remove-Item -LiteralPath $temporary -Recurse -Force }
}
$plan | ConvertTo-Json -Depth 5
