'use strict';

const SquareApi = (() => {
    function getConfig() {
        return window.SQUARE_CONFIG || {};
    }

    function isConfigured() {
        return Boolean(getConfig().ordersEndpoint);
    }

    /**
     * Fetches today's orders from Square via the proxy.
     * Completion is tracked locally only — nothing is written back to Square.
     * @returns {Promise<object[]>}
     */
    async function fetchOrders() {
        const endpoint = getConfig().ordersEndpoint;

        if (!endpoint) {
            throw new Error('Set ordersEndpoint in js/config.js to your Square proxy URL');
        }

        const response = await fetch(endpoint);

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || response.statusText);
        }

        const data = await response.json();
        return (data.orders || []).filter((order) => order.state !== 'CANCELED');
    }

    return {
        fetchOrders,
        isConfigured
    };
})();
