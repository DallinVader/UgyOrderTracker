/**
 * Cloudflare Worker — reads today's orders from Square.
 * Deploy secrets: SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID
 * Optional secret SQUARE_SANDBOX = "true" for sandbox API
 */

const SANDBOX_BASE = 'https://connect.squareupsandbox.com';
const PRODUCTION_BASE = 'https://connect.squareup.com';

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return cors(new Response(null, { status: 204 }));
        }

        if (request.method !== 'GET') {
            return cors(json({ error: 'Method not allowed' }, 405));
        }

        const token = env.SQUARE_ACCESS_TOKEN;
        const locationId = env.SQUARE_LOCATION_ID;

        if (!token || !locationId) {
            return cors(json({ error: 'Worker secrets not configured' }, 500));
        }

        const base = env.SQUARE_SANDBOX === 'true' ? SANDBOX_BASE : PRODUCTION_BASE;
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        try {
            const squareResponse = await fetch(`${base}/v2/orders/search`, {
                method: 'POST',
                headers: {
                    'Square-Version': '2024-10-17',
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
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
                const detail = data.errors?.[0]?.detail || squareResponse.statusText;
                return cors(json({ error: detail }, squareResponse.status));
            }

            const orders = (data.orders || []).map(normalizeOrder);
            return cors(json({ orders }));
        } catch (err) {
            return cors(json({ error: err.message || 'Proxy error' }, 500));
        }
    }
};

function normalizeOrder(order) {
    const lineItems = (order.line_items || []).map((item) => ({
        name: item.name || 'Unknown item',
        quantity: parseInt(item.quantity, 10) || 1,
        note: item.note || '',
        modifiers: (item.modifiers || []).map((m) => m.name).filter(Boolean)
    }));

    const notes = collectNotes(order, lineItems);

    return {
        id: order.id,
        ticketName: order.ticket_name || order.reference_id || formatOrderNumber(order),
        createdAt: order.created_at,
        lineItems,
        notes,
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

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

function cors(response) {
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    return new Response(response.body, { status: response.status, headers });
}
