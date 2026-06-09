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
        return fetchOrderList('');
    }

    async function fetchCompletedOrders() {
        return fetchOrderList('?status=completed');
    }

    async function fetchOrderList(query) {
        const response = await fetch(`${getEndpoint()}${query}`);

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
        return postOrderAction(orderId, 'complete');
    }

    async function uncompleteOrder(orderId) {
        return postOrderAction(orderId, 'uncomplete');
    }

    async function postOrderAction(orderId, action) {
        const response = await fetch(getEndpoint(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId, action })
        });

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || response.statusText);
        }
    }

    return {
        fetchOrders,
        fetchCompletedOrders,
        completeOrder,
        uncompleteOrder,
        isConfigured
    };
})();
