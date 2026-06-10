'use strict';

const Auth = (() => {
    const SESSION_KEY = 'ugy_session';
    const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
    const POPUP_FEATURES = 'width=520,height=720,left=100,top=100';

    function getConfig() {
        return window.SQUARE_CONFIG || {};
    }

    function getEndpoint() {
        return getConfig().ordersEndpoint || '';
    }

    function getWorkerOrigin() {
        try {
            return new URL(getEndpoint()).origin;
        } catch {
            return '';
        }
    }

    function init() {
        localStorage.removeItem(SESSION_KEY);
        captureSessionFromUrl();
    }

    function captureSessionFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const session = params.get('session');
        if (!session) {
            return;
        }

        setSessionId(session);
        params.delete('session');
        const query = params.toString();
        const cleanUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
        window.history.replaceState({}, '', cleanUrl);
    }

    function setSessionId(sessionId) {
        sessionStorage.setItem(SESSION_KEY, sessionId);
    }

    function getSessionId() {
        return sessionStorage.getItem(SESSION_KEY);
    }

    function isLoggedIn() {
        return Boolean(getSessionId());
    }

    function buildLoginUrl() {
        const endpoint = getEndpoint();
        const returnUrl = `${window.location.origin}${window.location.pathname}`;
        const openerOrigin = window.location.origin;
        const params = new URLSearchParams({
            return_url: returnUrl,
            popup: '1',
            opener_origin: openerOrigin
        });
        return `${endpoint}/auth/login?${params}`;
    }

    /**
     * Opens Square OAuth in a popup (or new tab fallback). Resolves when login completes.
     * @returns {Promise<void>}
     */
    function login() {
        const endpoint = getEndpoint();
        if (!endpoint) {
            return Promise.reject(new Error('Worker not configured'));
        }

        const loginUrl = buildLoginUrl();
        const workerOrigin = getWorkerOrigin();

        return new Promise((resolve, reject) => {
            let settled = false;
            let popup = null;
            let pollTimer = null;
            let timeoutTimer = null;

            function finish(err) {
                if (settled) {
                    return;
                }
                settled = true;
                window.removeEventListener('message', onMessage);
                window.removeEventListener('storage', onStorage);
                if (pollTimer) {
                    clearInterval(pollTimer);
                }
                if (timeoutTimer) {
                    clearTimeout(timeoutTimer);
                }
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            }

            function onMessage(event) {
                if (event.origin !== workerOrigin) {
                    return;
                }
                if (!event.data || event.data.type !== 'ugy-auth') {
                    return;
                }

                if (event.data.error) {
                    finish(new Error(event.data.error));
                    return;
                }

                if (event.data.session) {
                    setSessionId(event.data.session);
                    if (popup && !popup.closed) {
                        popup.close();
                    }
                    finish(null);
                }
            }

            function onStorage(event) {
                if (event.key !== SESSION_KEY || !event.newValue) {
                    return;
                }
                finish(null);
            }

            window.addEventListener('message', onMessage);
            window.addEventListener('storage', onStorage);

            popup = window.open(loginUrl, 'ugy_square_login', POPUP_FEATURES);

            if (!popup) {
                window.open(loginUrl, '_blank');
                timeoutTimer = setTimeout(() => {
                    if (isLoggedIn()) {
                        finish(null);
                    } else {
                        finish(new Error('Finish login in the new tab, then return here.'));
                    }
                }, LOGIN_TIMEOUT_MS);
                return;
            }

            pollTimer = setInterval(() => {
                if (popup.closed) {
                    if (isLoggedIn()) {
                        finish(null);
                    } else {
                        finish(new Error('Login cancelled'));
                    }
                }
            }, 400);

            timeoutTimer = setTimeout(() => {
                finish(new Error('Login timed out. Try again.'));
            }, LOGIN_TIMEOUT_MS);
        });
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
        localStorage.removeItem(SESSION_KEY);
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
