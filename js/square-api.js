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
     * Poll payload: active orders plus a completed count only (kept small so
     * the 10s poll doesn't re-send the whole day's completed list each time).
     * @returns {Promise<{active: object[], completedCount: number}>}
     */
    async function fetchActive() {
        const response = await fetch(getEndpoint(), {
            headers: Auth.authHeaders()
        });

        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw parseErrorResponse(response, body);
        }

        return {
            active: body.active || [],
            completedCount: body.completedCount || 0
        };
    }

    /**
     * Full completed list — fetched on demand (when the panel opens), not on
     * every poll.
     * @returns {Promise<object[]>}
     */
    async function fetchCompleted() {
        const response = await fetch(`${getEndpoint()}?view=completed`, {
            headers: Auth.authHeaders()
        });

        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw parseErrorResponse(response, body);
        }

        return body.completed || [];
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
        fetchActive,
        fetchCompleted,
        completeOrder,
        uncompleteOrder,
        isConfigured
    };
})();
