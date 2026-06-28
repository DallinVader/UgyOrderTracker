/**
 * Square connection for Ugy Order Tracker.
 *
 * 1. Deploy the Cloudflare Worker in /worker with OAuth secrets (see README)
 * 2. Copy this file to config.js
 * 3. Paste your worker URL below
 */
window.SQUARE_CONFIG = {
    /** Your deployed Cloudflare Worker URL (handles Square OAuth login) */
    ordersEndpoint: '',

    /** How often to pull new orders from Square (milliseconds) */
    pollIntervalMs: 15000,

    /** Show sandbox login hint (set true only for sandbox testing) */
    sandboxMode: false
};
