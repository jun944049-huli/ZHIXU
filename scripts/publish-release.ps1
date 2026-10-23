param(
  [ValidateSet('create','upload','publish','verify')][string]$Action = 'verify',
  [ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version = '0.2.0'
)
$ErrorActionPreference = 'Stop'
$env:GCM_INTERACTIVE = 'never'
$env:GIT_TERMINAL_PROMPT = '0'
$credentialLines = "protocol=https`nhost=github.com`nusername=jun944049-huli`n`n" | git -c credential.interactive=never credential fill
$credentials = @{}
foreach ($entry in $credentialLines) {
  if ($entry -match '^([^=]+)=(.*)$') { $credentials[$matches[1]] = $matches[2] }
}
if (!$credentials['password']) { throw 'GitHub credential unavailable' }
# Pass authentication through stdin, never process arguments or disk.
$curlConfiguration = 'header = "Authorization: Bearer ' + $credentials['password'] + '"'
$apiRoot = 'https://api.github.com/repos/jun944049-huli/HULIKU/releases'
$statePath = Join-Path 'release' "release-state-$Version.json"
$assetNames = @("Zhixu-$Version-Windows-Setup.exe", "Zhixu-$Version-source.zip", "SHA256SUMS-$Version.txt")
function Invoke-ReleaseAPI([string]$Method, [string]$Url, [string]$Body = '') {
  $arguments = @('--config','-','--http1.1','--noproxy','*','--connect-timeout','15','--max-time','60',
    '--silent','--show-error','--fail-with-body','-X',$Method,'-H','Accept: application/vnd.github+json','-o',$statePath)
  if ($Body) { $arguments += @('-H','Content-Type: application/json','--data-binary',('@'+$Body)) }
  $curlConfiguration | curl.exe @arguments $Url
  if ($LASTEXITCODE -ne 0) { throw "GitHub $Method failed" }
  $value = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  if (!$value.id -or $value.tag_name -ne "v$Version") { throw 'Unexpected release identity' }
  return $value
}
if ($Action -eq 'create') {
  $headCommit = (git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Missing Git commit' }
  $request = @{
    tag_name = "v$Version"; target_commitish = $headCommit; name = "知序 $Version"
    body = [IO.File]::ReadAllText((Join-Path (Get-Location) 'docs/18-0.2.0发布说明.md'))
    draft = $true; prerelease = $false
  }
  $requestPath = Join-Path 'release' "release-request-$Version.json"
  [IO.File]::WriteAllText((Join-Path (Get-Location) $requestPath), ($request | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
  $state = Invoke-ReleaseAPI 'POST' $apiRoot $requestPath
  if (!$state.draft) { throw 'Expected draft release' }
} else {
  $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  if (!$state.id -or $state.tag_name -ne "v$Version") { throw 'Missing release state' }
  $state = Invoke-ReleaseAPI 'GET' "$apiRoot/$($state.id)"
}
if ($Action -eq 'upload') {
  if (!$state.draft) { throw 'Uploads require a draft release' }
  $uploadBase = $state.upload_url -replace '\{.*$',''
  foreach ($name in $assetNames) {
    $assetPath = (Resolve-Path (Join-Path 'release' $name)).Path
    $existing = @($state.assets | Where-Object name -eq $name)
    if (!$existing.Count) {
      $curlConfiguration | curl.exe --config - --http1.1 --noproxy '*' --connect-timeout 15 --max-time 300 --silent --show-error --fail-with-body -X POST -H 'Content-Type: application/octet-stream' -H 'Expect:' --data-binary "@$assetPath" --output (Join-Path 'release' "upload-$name.json") ($uploadBase+'?name='+[Uri]::EscapeDataString($name))
      if ($LASTEXITCODE -ne 0) { throw "Upload failed: $name" }
      $state = Invoke-ReleaseAPI 'GET' "$apiRoot/$($state.id)"
    }
    $asset = @($state.assets | Where-Object name -eq $name)
    $hash = (Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash.ToLower()
    if ($asset.Count -ne 1 -or $asset[0].state -ne 'uploaded' -or $asset[0].size -ne (Get-Item $assetPath).Length -or $asset[0].digest -ne "sha256:$hash") { throw "Asset verification failed: $name" }
    Write-Output "$name verified"
  }
}
if ($Action -in @('publish','verify')) {
  foreach ($name in $assetNames) {
    $hash = (Get-FileHash -LiteralPath (Join-Path 'release' $name) -Algorithm SHA256).Hash.ToLower()
    $asset = @($state.assets | Where-Object name -eq $name)
    if ($asset.Count -ne 1 -or $asset[0].state -ne 'uploaded' -or $asset[0].digest -ne "sha256:$hash") { throw "Asset verification failed: $name" }
  }
  if ($Action -eq 'publish') {
    $publishPath = Join-Path 'release' "publish-$Version.json"
    [IO.File]::WriteAllText((Join-Path (Get-Location) $publishPath), '{"draft":false,"prerelease":false,"make_latest":"true"}')
    $state = Invoke-ReleaseAPI 'PATCH' "$apiRoot/$($state.id)" $publishPath
  }
  if ($state.draft -or !$state.published_at -or $state.prerelease) { throw 'Release is not published' }
}
[PSCustomObject]@{ Tag=$state.tag_name; Draft=$state.draft; Url=$state.html_url; Assets=$state.assets.Count }
