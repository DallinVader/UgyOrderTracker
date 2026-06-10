# Ugy Order Tracker

Pulls today's orders from Square and shows them in a kitchen queue. Swiping an order marks it **complete in Square** — it won't come back on any device.

Built for GitHub Pages with a Cloudflare Worker proxy (Square blocks direct browser API calls). **Any Square seller** can sign in with their own account via OAuth.

## How it works

```
Square POS  →  Cloudflare Worker  →  GitHub Pages (display)
                      ↑
              OAuth login + session per merchant
              swipe complete (POST → Square UpdateOrder)
```

1. User clicks **Log in with Square** → OAuth → worker stores a session
2. Worker fetches today's orders for that merchant's location
3. Site refreshes every 10 seconds
4. Swipe down on a card → worker updates the order in Square (`ugy_complete` metadata)

## Setup

### Step 1 — Square OAuth app (Production)

1. Go to [Square Developer Dashboard](https://developer.squareup.com/apps) and open your app
2. Switch to **Production** (top of page, not Sandbox)
3. **OAuth** → add **Production** redirect URL:
   ```
   https://ugy-order-proxy.ugy.workers.dev/auth/callback
   ```
   (Use your worker URL — must match exactly, HTTPS required.)
4. Copy your **Production Application ID** (`sq0idp-...`) and **Application secret**

For sandbox testing only, set `SQUARE_SANDBOX = "true"` in `worker/wrangler.toml` and use Sandbox credentials instead.

### Step 2 — Deploy the proxy

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put SQUARE_APPLICATION_ID
npx wrangler secret put SQUARE_APPLICATION_SECRET
```

Use your **Production** Application ID and secret when prompted.

`wrangler.toml` sets `SQUARE_SANDBOX = "false"` for real Square seller accounts.

Deploy:

```bash
npm run deploy
```

Copy the worker URL (e.g. `https://ugy-order-proxy.your-name.workers.dev`).

**Optional legacy mode** (single fixed account, no login UI): also set `SQUARE_ACCESS_TOKEN` and `SQUARE_LOCATION_ID` secrets. OAuth login is preferred for multi-merchant use.

**Local testing:** run `npm run dev` in `worker/` and use `http://localhost:8787` as your endpoint. Add `http://localhost:8787/auth/callback` as an OAuth redirect URL in Square.

### Step 3 — Configure the site

```bash
cp js/config.example.js js/config.js
```

Edit `js/config.js`:

```javascript
window.SQUARE_CONFIG = {
    ordersEndpoint: 'https://ugy-order-proxy.your-name.workers.dev',
    pollIntervalMs: 10000,
    sandboxMode: false
};
```

### Step 4 — Deploy GitHub Pages

Push to GitHub → **Settings → Pages → Deploy from `main` branch, `/ (root)`**.

Open your Pages URL, click **Log in with Square**, and authorize with Orders permissions.

## Usage

| Action | How |
|--------|-----|
| Connect account | **Log in with Square** on first visit |
| Multiple locations | Pick a location after login |
| New orders appear | Automatically every ~10 seconds |
| Mark complete | Swipe down — updates Square, hidden on all devices |
| Log out | **Log out** in the header |

Completed orders are tagged in Square with `ugy_complete` metadata and won't reappear in the queue.

## File structure

```
├── index.html
├── css/styles.css
├── js/
│   ├── app.js           # Queue UI, swipe-to-complete, login flow
│   ├── auth.js          # Square OAuth session handling
│   ├── square-api.js    # Fetches orders, completes via proxy
│   ├── config.example.js
│   └── config.js        # Your worker URL (gitignored)
└── worker/
    ├── square-proxy.js  # OAuth + Square Orders API proxy
    ├── wrangler.toml
    └── package.json
```

## License

MIT
