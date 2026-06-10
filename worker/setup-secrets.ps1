# Set Square OAuth secrets for the Cloudflare Worker.
# Run from the worker/ folder:  .\setup-secrets.ps1

Write-Host ""
Write-Host "Square Worker OAuth setup" -ForegroundColor Cyan
Write-Host "Get these from: https://developer.squareup.com/apps -> your app -> OAuth"
Write-Host ""
Write-Host "Also add this redirect URL in Square OAuth settings:"
Write-Host "  https://ugy-order-proxy.ugy.workers.dev/auth/callback"
Write-Host "  (replace with your worker URL after first deploy)"
Write-Host ""

$appId = Read-Host "Paste Square Application ID"
$appSecret = Read-Host "Paste Square Application secret"

if ([string]::IsNullOrWhiteSpace($appId) -or [string]::IsNullOrWhiteSpace($appSecret)) {
    Write-Host "Error: Application ID and secret cannot be empty." -ForegroundColor Red
    exit 1
}

$appId.Trim() | npx wrangler secret put SQUARE_APPLICATION_ID
$appSecret.Trim() | npx wrangler secret put SQUARE_APPLICATION_SECRET

Write-Host ""
Write-Host "Secrets saved. Deploying worker..." -ForegroundColor Green
npm run deploy

Write-Host ""
Write-Host "Test login: https://dallinvader.github.io/UgyOrderTracker/" -ForegroundColor Cyan
