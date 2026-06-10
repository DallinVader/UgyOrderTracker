'use strict';

const Auth = (() => {
    const SESSION_KEY = 'ugy_session';

    function getConfig() {
        return window.SQUARE_CONFIG || {};
    }

    function getEndpoint() {
        return getConfig().ordersEndpoint || '';
    }

    function init() {
        captureSessionFromUrl();
    }

    function captureSessionFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const session = params.get('session');
        if (!session) {
            return;
        }

        sessionStorage.setItem(SESSION_KEY, session);
        params.delete('session');
        const query = params.toString();
        const cleanUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
        window.history.replaceState({}, '', cleanUrl);
    }

    function getSessionId() {
        return sessionStorage.getItem(SESSION_KEY);
    }

    function isLoggedIn() {
        return Boolean(getSessionId());
    }

    function login() {
        const endpoint = getEndpoint();
        if (!endpoint) {
            return;
        }

        const returnUrl = `${window.location.origin}${window.location.pathname}`;
        window.location.href = `${endpoint}/auth/login?return_url=${encodeURIComponent(returnUrl)}`;
    }

    async function logout() {
        const sessionId = getSessionId();
        if (sessionId && getEndpoint()) {
            try {
                await fetch(`${getEndpoint()}/auth/logout`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${sessionId}` }
                });
            } catch {
                // clear local session even if network fails
            }
        }
        sessionStorage.removeItem(SESSION_KEY);
    }

    function authHeaders(extra = {}) {
        const headers = { ...extra };
        const sessionId = getSessionId();
        if (sessionId) {
            headers.Authorization = `Bearer ${sessionId}`;
        }
        return headers;
    }

    async function fetchMe() {
        const response = await fetch(`${getEndpoint()}/auth/me`, {
            headers: authHeaders()
        });

        if (response.status === 401) {
            await logout();
            throw Object.assign(new Error('Session expired. Log in again.'), { needsAuth: true });
        }

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || response.statusText);
        }

        return response.json();
    }

    async function fetchLocations() {
        const response = await fetch(`${getEndpoint()}/auth/locations`, {
            headers: authHeaders()
        });

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || response.statusText);
        }

        const data = await response.json();
        return data.locations || [];
    }

    async function setLocation(locationId) {
        const response = await fetch(`${getEndpoint()}/auth/location`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ locationId })
        });

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || response.statusText);
        }

        return response.json();
    }

    return {
        init,
        getSessionId,
        isLoggedIn,
        login,
        logout,
        authHeaders,
        fetchMe,
        fetchLocations,
        setLocation
    };
})();
