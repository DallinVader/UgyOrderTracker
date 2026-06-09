# Set Square secrets for the Cloudflare Worker.
# Run from the worker/ folder:  .\setup-secrets.ps1

Write-Host ""
Write-Host "Square Worker setup" -ForegroundColor Cyan
Write-Host "Get these from: https://developer.squareup.com/apps"
Write-Host "  - OAuth page -> Authorize test account -> Access token (with ORDERS_READ)"
Write-Host "  - Locations page -> Location ID"
Write-Host ""

$token = Read-Host "Paste Square OAuth access token"
$location = Read-Host "Paste Square Location ID"

if ([string]::IsNullOrWhiteSpace($token) -or [string]::IsNullOrWhiteSpace($location)) {
    Write-Host "Error: token and location ID cannot be empty." -ForegroundColor Red
    exit 1
}

$token.Trim() | npx wrangler secret put SQUARE_ACCESS_TOKEN
$location.Trim() | npx wrangler secret put SQUARE_LOCATION_ID
"true" | npx wrangler secret put SQUARE_SANDBOX

Write-Host ""
Write-Host "Secrets saved. Deploying worker..." -ForegroundColor Green
npm run deploy

Write-Host ""
Write-Host "Test: https://ugy-order-proxy.ugy.workers.dev" -ForegroundColor Cyan
