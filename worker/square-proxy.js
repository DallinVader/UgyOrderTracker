/**
 * Cloudflare Worker — Ugy Order Tracker API + Square OAuth
 *
 * Auth:  GET /auth/login, /auth/callback, /auth/me, /auth/locations
 *        POST /auth/logout, /auth/location
 * Orders: GET /, POST /  (Authorization: Bearer <sessionId>)
 *
 * Secrets: SQUARE_APPLICATION_ID, SQUARE_APPLICATION_SECRET
 * Optional legacy: SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID
 */

const SANDBOX_BASE = 'https://connect.squareupsandbox.com';
const PRODUCTION_BASE = 'https://connect.squareup.com';
const SQUARE_VERSION = '2024-10-17';
const COMPLETE_FLAG = 'ugy_complete';
const OAUTH_SCOPES = 'ORDERS_READ ORDERS_WRITE MERCHANT_PROFILE_READ';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return cors(new Response(null, { status: 204 }));
        }

        const url = new URL(request.url);
        const path = url.pathname.replace(/\/$/, '') || '/';

        try {
            if (path.startsWith('/auth/')) {
                return handleAuthRoute(request, env, url, path);
            }

            return handleOrdersRoute(request, env, url);
        } catch (err) {
            return cors(json({ error: err.message || 'Server error' }, 500));
        }
    }
};

/* ── Auth routes ───────────────────────────────────────────── */

async function handleAuthRoute(request, env, url, path) {
    if (path === '/auth/login' && request.method === 'GET') {
        return authLogin(request, env, url);
    }
    if (path === '/auth/callback' && request.method === 'GET') {
        return authCallback(request, env, url);
    }
    if (path === '/auth/me' && request.method === 'GET') {
        return authMe(request, env);
    }
    if (path === '/auth/locations' && request.method === 'GET') {
        return authLocations(request, env);
    }
    if (path === '/auth/location' && request.method === 'POST') {
        return authSetLocation(request, env);
    }
    if (path === '/auth/logout' && request.method === 'POST') {
        return authLogout(request, env);
    }
    return cors(json({ error: 'Not found' }, 404));
}

function isSandbox(env) {
    return String(env.SQUARE_SANDBOX || '').trim().toLowerCase() === 'true';
}

function squareBase(env) {
    return isSandbox(env) ? SANDBOX_BASE : PRODUCTION_BASE;
}

function callbackUrl(request) {
    const url = new URL(request.url);
    return `${url.origin}/auth/callback`;
}

function isAllowedReturnUrl(returnUrl) {
    try {
        const { origin } = new URL(returnUrl);
        if (origin.includes('github.io')) {
            return true;
        }
        if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
            return true;
        }
        return false;
    } catch {
        return false;
    }
}

async function authLogin(request, env, url) {
    const appId = env.SQUARE_APPLICATION_ID?.trim();
    if (!appId) {
        return cors(json({ error: 'SQUARE_APPLICATION_ID not configured on worker' }, 500));
    }

    const returnUrl = url.searchParams.get('return_url') || '';
    if (!isAllowedReturnUrl(returnUrl)) {
        return cors(json({ error: 'Invalid return_url' }, 400));
    }

    const state = crypto.randomUUID();
    await env.UGY_KV.put(`oauth_state:${state}`, returnUrl, { expirationTtl: 600 });

    const base = squareBase(env);
    const params = new URLSearchParams({
        client_id: appId,
        scope: OAUTH_SCOPES,
        session: 'false',
        state
    });

    return Response.redirect(`${base}/oauth2/authorize?${params}`, 302);
}

async function authCallback(request, env, url) {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
        return htmlErrorPage(`Square authorization failed: ${error}`);
    }

    if (!code || !state) {
        return htmlErrorPage('Missing authorization code.');
    }

    const returnUrl = await env.UGY_KV.get(`oauth_state:${state}`);
    await env.UGY_KV.delete(`oauth_state:${state}`);

    if (!returnUrl || !isAllowedReturnUrl(returnUrl)) {
        return htmlErrorPage('Invalid or expired login session.');
    }

    const appId = env.SQUARE_APPLICATION_ID?.trim();
    const appSecret = env.SQUARE_APPLICATION_SECRET?.trim();
    if (!appId || !appSecret) {
        return htmlErrorPage('OAuth not configured on server.');
    }

    const base = squareBase(env);
    const tokenResponse = await fetch(`${base}/oauth2/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Square-Version': SQUARE_VERSION
        },
        body: JSON.stringify({
            client_id: appId,
            client_secret: appSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: callbackUrl(request)
        })
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) {
        const detail = tokenData.message || tokenData.errors?.[0]?.detail || 'Token exchange failed';
        return htmlErrorPage(detail);
    }

    const locations = await fetchLocations(base, tokenData.access_token);
    const activeLocations = locations.filter((loc) => loc.status === 'ACTIVE');

    const sessionId = crypto.randomUUID();
    const session = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: tokenData.expires_at
            ? new Date(tokenData.expires_at).getTime()
            : Date.now() + 30 * 24 * 60 * 60 * 1000,
        merchantId: tokenData.merchant_id,
        sandbox: isSandbox(env),
        locationId: activeLocations.length === 1 ? activeLocations[0].id : null,
        locationName: activeLocations.length === 1 ? activeLocations[0].name : null
    };

    await env.UGY_KV.put(`session:${sessionId}`, JSON.stringify(session), {
        expirationTtl: SESSION_TTL_SECONDS
    });

    const redirect = new URL(returnUrl);
    redirect.searchParams.set('session', sessionId);
    return Response.redirect(redirect.toString(), 302);
}

async function authMe(request, env) {
    const ctx = await resolveSession(request, env);
    if (ctx.error) {
        return cors(json({ error: ctx.error }, ctx.status || 401));
    }

    const { session } = ctx;
    return cors(json({
        merchantId: session.merchantId,
        locationId: session.locationId,
        locationName: session.locationName,
        sandbox: session.sandbox,
        needsLocation: !session.locationId
    }));
}

async function authLocations(request, env) {
    const ctx = await resolveSession(request, env);
    if (ctx.error) {
        return cors(json({ error: ctx.error }, ctx.status || 401));
    }

    const { session, base } = ctx;
    const locations = await fetchLocations(base, session.accessToken);
    return cors(json({
        locations: locations
            .filter((loc) => loc.status === 'ACTIVE')
            .map((loc) => ({ id: loc.id, name: loc.name, address: loc.address?.address_line_1 || '' }))
    }));
}

async function authSetLocation(request, env) {
    const ctx = await resolveSession(request, env);
    if (ctx.error) {
        return cors(json({ error: ctx.error }, ctx.status || 401));
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return cors(json({ error: 'Invalid JSON' }, 400));
    }

    const locationId = body.locationId?.trim();
    if (!locationId) {
        return cors(json({ error: 'locationId required' }, 400));
    }

    const { session, sessionId } = ctx;
    const locations = await fetchLocations(ctx.base, session.accessToken);
    const match = locations.find((loc) => loc.id === locationId);

    if (!match) {
        return cors(json({ error: 'Location not found for this account' }, 404));
    }

    session.locationId = match.id;
    session.locationName = match.name;
    await saveSession(env, sessionId, session);

    return cors(json({ locationId: match.id, locationName: match.name }));
}

async function authLogout(request, env) {
    const sessionId = getBearerToken(request);
    if (sessionId) {
        await env.UGY_KV.delete(`session:${sessionId}`);
    }
    return cors(json({ success: true }));
}

async function fetchLocations(base, accessToken) {
    const response = await squareFetch(base, accessToken, '/v2/locations');
    const data = await response.json();
    if (!response.ok) {
        return [];
    }
    return data.locations || [];
}

/* ── Orders routes ─────────────────────────────────────────── */

async function handleOrdersRoute(request, env, url) {
    const ctx = await resolveRequestContext(request, env);
    if (ctx.error) {
        return cors(json({ error: ctx.error }, ctx.status || 401));
    }

    const { session, base, token, locationId, merchantId } = ctx;

    if (!locationId) {
        return cors(json({ error: 'Select a location first', needsLocation: true }, 400));
    }

    if (request.method === 'GET') {
        const showCompleted = url.searchParams.get('status') === 'completed';
        return handleListOrders(env, base, token, locationId, merchantId, showCompleted);
    }

    if (request.method === 'POST') {
        return handleOrderAction(request, env, base, token, locationId, merchantId);
    }

    return cors(json({ error: 'Method not allowed' }, 405));
}

async function resolveRequestContext(request, env) {
    const sessionCtx = await resolveSession(request, env);
    if (sessionCtx.session) {
        if (!sessionCtx.session.locationId) {
            return { error: 'Select a location first', needsLocation: true, status: 400 };
        }
        return {
            session: sessionCtx.session,
            base: sessionCtx.base,
            token: sessionCtx.session.accessToken,
            locationId: sessionCtx.session.locationId,
            merchantId: sessionCtx.session.merchantId
        };
    }

    const legacyToken = env.SQUARE_ACCESS_TOKEN?.trim();
    const legacyLocation = env.SQUARE_LOCATION_ID?.trim();
    if (legacyToken && legacyLocation) {
        return {
            base: squareBase(env),
            token: legacyToken,
            locationId: legacyLocation,
            merchantId: 'legacy'
        };
    }

    return { error: sessionCtx.error || 'Log in with Square', status: 401 };
}

async function resolveSession(request, env) {
    const sessionId = getBearerToken(request);
    if (!sessionId) {
        return { error: 'Missing session. Log in with Square.' };
    }

    const raw = await env.UGY_KV.get(`session:${sessionId}`);
    if (!raw) {
        return { error: 'Session expired. Log in again.' };
    }

    let session = JSON.parse(raw);
    const base = session.sandbox ? SANDBOX_BASE : PRODUCTION_BASE;

    if (Date.now() >= session.expiresAt - 60000) {
        const refreshed = await refreshSession(env, sessionId, session);
        if (refreshed.error) {
            return refreshed;
        }
        session = refreshed.session;
    }

    return { session, sessionId, base };
}

async function refreshSession(env, sessionId, session) {
    const appId = env.SQUARE_APPLICATION_ID?.trim();
    const appSecret = env.SQUARE_APPLICATION_SECRET?.trim();
    if (!appSecret || !session.refreshToken) {
        await env.UGY_KV.delete(`session:${sessionId}`);
        return { error: 'Session expired. Log in again.' };
    }

    const base = session.sandbox ? SANDBOX_BASE : PRODUCTION_BASE;
    const response = await fetch(`${base}/oauth2/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Square-Version': SQUARE_VERSION
        },
        body: JSON.stringify({
            client_id: appId,
            client_secret: appSecret,
            grant_type: 'refresh_token',
            refresh_token: session.refreshToken
        })
    });

    const data = await response.json();
    if (!response.ok) {
        await env.UGY_KV.delete(`session:${sessionId}`);
        return { error: 'Session expired. Log in again.' };
    }

    session.accessToken = data.access_token;
    session.refreshToken = data.refresh_token || session.refreshToken;
    session.expiresAt = data.expires_at
        ? new Date(data.expires_at).getTime()
        : Date.now() + 30 * 24 * 60 * 60 * 1000;

    await saveSession(env, sessionId, session);
    return { session };
}

async function saveSession(env, sessionId, session) {
    await env.UGY_KV.put(`session:${sessionId}`, JSON.stringify(session), {
        expirationTtl: SESSION_TTL_SECONDS
    });
}

function getBearerToken(request) {
    const auth = request.headers.get('Authorization') || '';
    if (auth.startsWith('Bearer ')) {
        return auth.slice(7).trim();
    }
    return null;
}

/* ── Order logic (merchant-scoped KV) ────────────────────── */

function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

function kvCompletedKey(merchantId, orderId) {
    return `c:${merchantId}:${todayKey()}:${orderId}`;
}

function kvActiveKey(merchantId, orderId) {
    return `a:${merchantId}:${todayKey()}:${orderId}`;
}

async function isOrderCompleted(env, merchantId, order) {
    const forcedActive = await env.UGY_KV.get(kvActiveKey(merchantId, order.id));
    if (forcedActive) {
        return false;
    }

    const kvCompleted = await env.UGY_KV.get(kvCompletedKey(merchantId, order.id));
    if (kvCompleted) {
        return true;
    }

    return order.metadata?.[COMPLETE_FLAG] === 'true';
}

async function handleListOrders(env, base, token, locationId, merchantId, completedOnly = false) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const squareResponse = await squareFetch(base, token, '/v2/orders/search', {
        method: 'POST',
        body: JSON.stringify({
            location_ids: [locationId],
            query: {
                filter: {
                    state_filter: { states: ['OPEN', 'COMPLETED'] },
                    date_time_filter: {
                        created_at: { start_at: startOfDay.toISOString() }
                    }
                },
                sort: {
                    sort_field: completedOnly ? 'UPDATED_AT' : 'CREATED_AT',
                    sort_order: completedOnly ? 'DESC' : 'ASC'
                }
            },
            limit: 100
        })
    });

    const data = await squareResponse.json();

    if (!squareResponse.ok) {
        return cors(json({ error: formatSquareError(squareResponse.status, data) }, squareResponse.status));
    }

    const rawOrders = (data.orders || []).filter((order) => order.state !== 'CANCELED');
    const filtered = [];

    for (const order of rawOrders) {
        const completed = await isOrderCompleted(env, merchantId, order);
        if (completedOnly ? completed : !completed) {
            filtered.push(normalizeOrder(order, completedOnly));
        }
    }

    return cors(json({ orders: filtered }));
}

async function handleOrderAction(request, env, base, token, locationId, merchantId) {
    let body;
    try {
        body = await request.json();
    } catch {
        return cors(json({ error: 'Invalid JSON body' }, 400));
    }

    const orderId = body.orderId?.trim();
    if (!orderId) {
        return cors(json({ error: 'orderId is required' }, 400));
    }

    const action = body.action === 'uncomplete' ? 'uncomplete' : 'complete';

    const retrieveResponse = await squareFetch(base, token, `/v2/orders/${orderId}`);
    const retrieveData = await retrieveResponse.json();

    if (!retrieveResponse.ok) {
        return cors(json({ error: formatSquareError(retrieveResponse.status, retrieveData) }, retrieveResponse.status));
    }

    const order = retrieveData.order;
    if (!order) {
        return cors(json({ error: 'Order not found' }, 404));
    }

    const updatePayload = action === 'uncomplete'
        ? buildUncompletePayload(order, locationId)
        : buildCompletePayload(order, locationId);

    const updateResponse = await squareFetch(base, token, `/v2/orders/${orderId}`, {
        method: 'PUT',
        body: JSON.stringify({
            idempotency_key: crypto.randomUUID(),
            order: updatePayload
        })
    });

    const updateData = await updateResponse.json();

    if (!updateResponse.ok) {
        if (isImmutableOrderError(updateData)) {
            await applyKvFallback(env, merchantId, orderId, action);
            return cors(json({ success: true, orderId, action, via: 'kv' }));
        }
        return cors(json({ error: formatSquareError(updateResponse.status, updateData) }, updateResponse.status));
    }

    await clearKvOverrides(env, merchantId, orderId);
    if (action === 'complete') {
        await env.UGY_KV.delete(kvActiveKey(merchantId, orderId));
    } else {
        await env.UGY_KV.delete(kvCompletedKey(merchantId, orderId));
    }

    return cors(json({ success: true, orderId, action }));
}

function isImmutableOrderError(data) {
    const detail = (data.errors?.[0]?.detail || '').toLowerCase();
    return detail.includes('cannot be updated') || detail.includes('status `completed`');
}

async function applyKvFallback(env, merchantId, orderId, action) {
    if (action === 'complete') {
        await env.UGY_KV.put(kvCompletedKey(merchantId, orderId), '1');
        await env.UGY_KV.delete(kvActiveKey(merchantId, orderId));
    } else {
        await env.UGY_KV.put(kvActiveKey(merchantId, orderId), '1');
        await env.UGY_KV.delete(kvCompletedKey(merchantId, orderId));
    }
}

async function clearKvOverrides(env, merchantId, orderId) {
    await env.UGY_KV.delete(kvCompletedKey(merchantId, orderId));
    await env.UGY_KV.delete(kvActiveKey(merchantId, orderId));
}

function buildCompletePayload(order, locationId) {
    return {
        location_id: locationId,
        version: order.version,
        metadata: {
            ...(order.metadata || {}),
            [COMPLETE_FLAG]: 'true'
        }
    };
}

function buildUncompletePayload(order, locationId) {
    return {
        location_id: locationId,
        version: order.version,
        metadata: {
            ...(order.metadata || {}),
            [COMPLETE_FLAG]: 'false'
        }
    };
}

function normalizeOrder(order, includeCompletedAt = false) {
    const lineItems = (order.line_items || []).map((item) => ({
        name: item.name || 'Unknown item',
        quantity: parseInt(item.quantity, 10) || 1,
        note: item.note || '',
        modifiers: (item.modifiers || []).map((m) => m.name).filter(Boolean)
    }));

    const normalized = {
        id: order.id,
        version: order.version,
        locationId: order.location_id,
        ticketName: order.ticket_name || order.reference_id || formatOrderNumber(order),
        createdAt: order.created_at,
        lineItems,
        notes: collectNotes(order, lineItems),
        state: order.state
    };

    if (includeCompletedAt) {
        normalized.completedAt = order.updated_at || order.created_at;
    }

    return normalized;
}

function formatOrderNumber(order) {
    return order.id ? `#${order.id.slice(-4).toUpperCase()}` : 'Order';
}

function collectNotes(order, lineItems) {
    const parts = [];
    if (order.note) {
        parts.push(order.note);
    }
    lineItems.forEach((item) => {
        if (item.note) {
            parts.push(`${item.name}: ${item.note}`);
        }
    });
    return parts.join(' · ');
}

function formatSquareError(status, data) {
    const detail = data.errors?.[0]?.detail || data.message || 'Square API error';
    const code = data.errors?.[0]?.code || '';

    if (status === 403 || code === 'INSUFFICIENT_SCOPES') {
        return 'Square permissions missing. Log out and log in again to grant Orders access.';
    }
    if (status === 401 || code === 'UNAUTHORIZED') {
        return 'Session expired. Log in with Square again.';
    }

    return detail;
}

function squareFetch(base, token, path, options = {}) {
    return fetch(`${base}${path}`, {
        ...options,
        headers: {
            'Square-Version': SQUARE_VERSION,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
}

function htmlErrorPage(message) {
    return new Response(
        `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;background:#1a1a2e;color:#f0f0f5">
        <h1>Login failed</h1><p>${message}</p><p><a href="/" style="color:#ff6b35">Try again</a></p></body></html>`,
        { status: 400, headers: { 'Content-Type': 'text/html' } }
    );
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

function cors(response) {
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return new Response(response.body, { status: response.status, headers });
}
