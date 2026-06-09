# Ugy Order Tracker

Pulls today's orders from Square and shows them in a kitchen queue. Swiping an order marks it **complete on this device only** — nothing is sent back to Square.

Built for GitHub Pages with a small Cloudflare Worker proxy (Square blocks direct browser API calls).

## How it works

```
Square POS  →  Cloudflare Worker (reads orders)  →  GitHub Pages (display)
                                                      ↓
                                              localStorage (completed)
```

1. Worker polls Square's Orders API for today's orders
2. Site refreshes every 10 seconds and shows orders not yet marked complete locally
3. Swipe down on a card to mark it complete — stored in the browser for today only

## Setup

### Step 1 — Square credentials

1. Go to [Square Developer Dashboard](https://developer.squareup.com/apps) and create an app
2. Under **Credentials**, copy a **Production Access Token** (or Sandbox for testing)
3. Under **Locations**, copy your food truck **Location ID**
4. Token needs **Orders Read** permission

### Step 2 — Deploy the proxy

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put SQUARE_ACCESS_TOKEN
npx wrangler secret put SQUARE_LOCATION_ID
```

For **sandbox** testing, also run:

```bash
npx wrangler secret put SQUARE_SANDBOX
# enter: true
```

Deploy:

```bash
npm run deploy
```

Copy the URL it prints (e.g. `https://ugy-order-proxy.your-name.workers.dev`).

**Local testing:** run `npm run dev` in `worker/` and use `http://localhost:8787` as your endpoint.

### Step 3 — Configure the site

```bash
cp js/config.example.js js/config.js
```

Edit `js/config.js`:

```javascript
window.SQUARE_CONFIG = {
    ordersEndpoint: 'https://ugy-order-proxy.your-name.workers.dev',
    pollIntervalMs: 10000
};
```

### Step 4 — Deploy GitHub Pages

Push to GitHub → **Settings → Pages → Deploy from `main` branch, `/ (root)`**.

Open your Pages URL on a tablet at the truck.

## Usage

| Action | How |
|--------|-----|
| New orders appear | Automatically every ~10 seconds |
| Mark complete | Swipe down on the order card |
| Reset completed list | Clear site data in browser, or wait until the next day |

Completed orders are keyed by date in `localStorage` under `ugy_completed_orders`. They reset automatically each day.

## File structure

```
├── index.html
├── css/styles.css
├── js/
│   ├── app.js           # Queue UI, swipe-to-complete, local storage
│   ├── square-api.js    # Fetches orders from proxy
│   ├── config.example.js
│   └── config.js        # Your worker URL (gitignored)
└── worker/
    ├── square-proxy.js  # Square Orders API proxy
    ├── wrangler.toml
    └── package.json
```

## License

MIT
