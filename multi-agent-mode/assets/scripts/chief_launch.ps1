$ErrorActionPreference = "Stop"
$compactPercent = "50"
$configPath = Join-Path $HOME ".config\herdr\multi-agent.config.json"
if (Test-Path $configPath) {
    $config = Get-Content -Raw $configPath | ConvertFrom-Json
    if ($config.compact_percent -ge 1 -and $config.compact_percent -le 100) { $compactPercent = [string]$config.compact_percent }
}
$env:CLAUDE_CODE_AUTO_COMPACT_WINDOW = "360000"
$env:CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = $compactPercent
$env:CODEGRAPH_HOOK_OFF = "1"
& claude --agent chief --dangerously-skip-permissions --remote-control @args
exit $LASTEXITCODE
