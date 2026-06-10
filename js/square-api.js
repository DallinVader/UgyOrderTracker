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

    function parseErrorResponse(response, body) {
        const err = new Error(body.error || response.statusText);
        if (response.status === 401) {
            err.needsAuth = true;
        }
        if (body.needsLocation) {
            err.needsLocation = true;
        }
        return err;
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
        const response = await fetch(`${getEndpoint()}${query}`, {
            headers: Auth.authHeaders()
        });

        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw parseErrorResponse(response, body);
        }

        return body.orders || [];
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
            headers: Auth.authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ orderId, action })
        });

        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw parseErrorResponse(response, body);
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
