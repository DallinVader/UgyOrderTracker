/**
 * Cloudflare Worker — Square Orders proxy for Ugy Order Tracker.
 * GET  — list today's active orders
 * POST — mark order complete in Square (metadata + state/fulfillment)
 *
 * Secrets: SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID
 * Var: SQUARE_SANDBOX = "true" for sandbox
 */

const SANDBOX_BASE = 'https://connect.squareupsandbox.com';
const PRODUCTION_BASE = 'https://connect.squareup.com';
const SQUARE_VERSION = '2024-10-17';
const COMPLETE_FLAG = 'ugy_complete';

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return cors(new Response(null, { status: 204 }));
        }

        const credentials = getCredentials(env);
        if (credentials.error) {
            return cors(json({ error: credentials.error }, 500));
        }

        const { token, locationId, base } = credentials;

        if (request.method === 'GET') {
            return handleListOrders(base, token, locationId);
        }

        if (request.method === 'POST') {
            return handleCompleteOrder(request, base, token, locationId);
        }

        return cors(json({ error: 'Method not allowed' }, 405));
    }
};

function getCredentials(env) {
    const token = env.SQUARE_ACCESS_TOKEN?.trim();
    const locationId = env.SQUARE_LOCATION_ID?.trim();

    if (!token || !locationId) {
        const missing = [];
        if (!token) {
            missing.push('SQUARE_ACCESS_TOKEN');
        }
        if (!locationId) {
            missing.push('SQUARE_LOCATION_ID');
        }
        return {
            error: `Missing worker secrets: ${missing.join(', ')}. Run: npx wrangler secret put ${missing[0]}`
        };
    }

    const sandbox = String(env.SQUARE_SANDBOX || '').trim().toLowerCase() === 'true';
    return { token, locationId, base: sandbox ? SANDBOX_BASE : PRODUCTION_BASE };
}

async function handleListOrders(base, token, locationId) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    try {
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
                        sort_field: 'CREATED_AT',
                        sort_order: 'ASC'
                    }
                },
                limit: 100
            })
        });

        const data = await squareResponse.json();

        if (!squareResponse.ok) {
            return cors(json({ error: formatSquareError(squareResponse.status, data) }, squareResponse.status));
        }

        const orders = (data.orders || [])
            .filter((order) => order.state !== 'CANCELED')
            .filter((order) => order.metadata?.[COMPLETE_FLAG] !== 'true')
            .map(normalizeOrder);

        return cors(json({ orders }));
    } catch (err) {
        return cors(json({ error: err.message || 'Proxy error' }, 500));
    }
}

async function handleCompleteOrder(request, base, token, locationId) {
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

    try {
        const retrieveResponse = await squareFetch(base, token, `/v2/orders/${orderId}`);
        const retrieveData = await retrieveResponse.json();

        if (!retrieveResponse.ok) {
            return cors(json({ error: formatSquareError(retrieveResponse.status, retrieveData) }, retrieveResponse.status));
        }

        const order = retrieveData.order;
        if (!order) {
            return cors(json({ error: 'Order not found' }, 404));
        }

        const updatePayload = buildCompletePayload(order, locationId);
        const updateResponse = await squareFetch(base, token, `/v2/orders/${orderId}`, {
            method: 'PUT',
            body: JSON.stringify({
                idempotency_key: crypto.randomUUID(),
                order: updatePayload
            })
        });

        const updateData = await updateResponse.json();

        if (!updateResponse.ok) {
            return cors(json({ error: formatSquareError(updateResponse.status, updateData) }, updateResponse.status));
        }

        return cors(json({ success: true, orderId }));
    } catch (err) {
        return cors(json({ error: err.message || 'Proxy error' }, 500));
    }
}

function buildCompletePayload(order, locationId) {
    const payload = {
        location_id: locationId,
        version: order.version,
        metadata: {
            ...(order.metadata || {}),
            [COMPLETE_FLAG]: 'true'
        }
    };

    if (order.state === 'OPEN') {
        payload.state = 'COMPLETED';
    }

    if (order.fulfillments?.length) {
        payload.fulfillments = order.fulfillments.map((f) => ({
            uid: f.uid,
            state: 'COMPLETED'
        }));
    }

    return payload;
}

function normalizeOrder(order) {
    const lineItems = (order.line_items || []).map((item) => ({
        name: item.name || 'Unknown item',
        quantity: parseInt(item.quantity, 10) || 1,
        note: item.note || '',
        modifiers: (item.modifiers || []).map((m) => m.name).filter(Boolean)
    }));

    return {
        id: order.id,
        version: order.version,
        locationId: order.location_id,
        ticketName: order.ticket_name || order.reference_id || formatOrderNumber(order),
        createdAt: order.created_at,
        lineItems,
        notes: collectNotes(order, lineItems),
        state: order.state
    };
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
    const detail = data.errors?.[0]?.detail || 'Square API error';
    const code = data.errors?.[0]?.code || '';

    if (status === 403 || code === 'INSUFFICIENT_SCOPES') {
        return 'Square token needs ORDERS_READ and ORDERS_WRITE. Re-authorize your test account with both permissions.';
    }
    if (status === 401 || code === 'UNAUTHORIZED') {
        return 'Invalid or wrong-environment token.';
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
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    return new Response(response.body, { status: response.status, headers });
}
