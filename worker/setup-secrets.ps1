# Set Square OAuth secrets for production (real seller accounts).
# Run from the worker/ folder:  .\setup-secrets.ps1

Write-Host ""
Write-Host "Square Worker — PRODUCTION OAuth setup" -ForegroundColor Cyan
Write-Host "Get these from: https://developer.squareup.com/apps -> your app -> OAuth"
Write-Host "Use the PRODUCTION tab (not Sandbox)."
Write-Host ""
Write-Host "Add this Production Redirect URL in Square OAuth settings:"
Write-Host "  https://ugy-order-proxy.ugy.workers.dev/auth/callback"
Write-Host ""

$appId = Read-Host "Paste Production Application ID (starts with sq0idp-)"
$appSecret = Read-Host "Paste Production Application secret"

if ([string]::IsNullOrWhiteSpace($appId) -or [string]::IsNullOrWhiteSpace($appSecret)) {
    Write-Host "Error: Application ID and secret cannot be empty." -ForegroundColor Red
    exit 1
}

if ($appId -like "sandbox-*") {
    Write-Host "Warning: That looks like a Sandbox ID. Use Production Application ID (sq0idp-...)." -ForegroundColor Yellow
}

$appId.Trim() | npx wrangler secret put SQUARE_APPLICATION_ID
$appSecret.Trim() | npx wrangler secret put SQUARE_APPLICATION_SECRET

Write-Host ""
Write-Host "Secrets saved. Deploying worker..." -ForegroundColor Green
npm run deploy

Write-Host ""
Write-Host "Test login: https://dallinvader.github.io/UgyOrderTracker/" -ForegroundColor Cyan
