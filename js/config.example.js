/**
 * Square connection for Ugy Order Tracker.
 *
 * 1. Deploy the Cloudflare Worker in /worker (see README)
 * 2. Copy this file to config.js
 * 3. Paste your worker URL below
 */
window.SQUARE_CONFIG = {
    /** Your deployed Cloudflare Worker URL */
    ordersEndpoint: '',

    /** How often to pull new orders from Square (milliseconds) */
    pollIntervalMs: 10000
};
