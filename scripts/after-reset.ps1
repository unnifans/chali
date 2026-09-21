# Runs right after Cloudflare D1's free-tier daily rows-read quota resets
# (midnight UTC = 05:30 local time). Applies any pending D1 migrations,
# imports any pending meme rows, then deploys the Worker. Safe to run any
# time: migrations and inserts are idempotent, and the Worker deploys only
# after the DB steps succeed (the Worker code references the new `seq`
# column, so deploying before the migration would break the API).
#
# Scheduled daily via Windows Task Scheduler task "chali-after-reset".

param(
    [string]$Repo = "C:\Users\abhiu\OneDrive\Desktop\chal\chali",
    [int]$MaxAttempts = 4,
    [int]$RetrySleepSeconds = 60
)

$ErrorActionPreference = "Stop"
$log = Join-Path $Repo "scripts\_after_reset.log"

function Log([string]$msg) {
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $msg
    Write-Host $line
    Add-Content -LiteralPath $log -Value $line
}

if (-not (Test-Path -LiteralPath $Repo)) { Log "Repo not found: $Repo"; exit 1 }
Set-Location -LiteralPath $Repo
Log "start (attempts=$MaxAttempts, sleep=$RetrySleepSeconds s)"

for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    Log "attempt $attempt of $MaxAttempts"
    try {
        Log "> npm run migrate:d1"
        & npm run migrate:d1
        if ($LASTEXITCODE -ne 0) { throw "migrate:d1 exited $LASTEXITCODE" }

        $memesSql = Join-Path $Repo "scripts\_d1_export\insert_memes.sql"
        if (Test-Path -LiteralPath $memesSql) {
            Log "> importing memes (insert_memes.sql)"
            & npx.cmd wrangler d1 execute chali-d1 --remote --file $memesSql --config (Join-Path $Repo "worker\wrangler.jsonc")
            if ($LASTEXITCODE -ne 0) { throw "memes import exited $LASTEXITCODE" }
        }

        Log "> npm run deploy:worker"
        & npm run deploy:worker
        if ($LASTEXITCODE -ne 0) { throw "deploy:worker exited $LASTEXITCODE" }

        try {
            Log "> smoke: GET /api/jokes/next"
            $code = (curl.exe -sS -o NUL -w "%{http_code}" --max-time 20 "https://chali-api.wastedev2005.workers.dev/api/jokes/next").Trim()
            Log "smoke status: $code"
        } catch {
            Log "smoke failed: $($_.Exception.Message)"
        }

        Log "done"
        exit 0
    } catch {
        Log "ERROR: $($_.Exception.Message)"
        if ($attempt -lt $MaxAttempts) {
            Log "retrying in $RetrySleepSeconds s..."
            Start-Sleep -Seconds $RetrySleepSeconds
        }
    }
}

Log "all attempts failed"
exit 1