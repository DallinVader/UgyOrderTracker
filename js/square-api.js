'use strict';

const SquareApi = (() => {
    function getConfig() {
        return window.SQUARE_CONFIG || {};
    }

    function isConfigured() {
        return Boolean(getConfig().ordersEndpoint);
    }

    function getEndpoint() {
        return getConfig().ordersEndpoint;
    }

    /**
     * @returns {Promise<object[]>}
     */
    async function fetchOrders() {
        const response = await fetch(getEndpoint());

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || response.statusText);
        }

        const data = await response.json();
        return data.orders || [];
    }

    /**
     * Marks an order complete in Square.
     * @param {string} orderId
     * @returns {Promise<void>}
     */
    async function completeOrder(orderId) {
        const response = await fetch(getEndpoint(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId })
        });

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || response.statusText);
        }
    }

    return {
        fetchOrders,
        completeOrder,
        isConfigured
    };
})();
