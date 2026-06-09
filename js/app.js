'use strict';

const SWIPE_THRESHOLD = 80;

const App = (() => {
    /** @type {Map<string, object>} */
    let orders = new Map();

    let pollTimer = null;
    let waitTimer = null;

    const els = {
        orderList: null,
        queueCount: null,
        statusText: null,
        emptyState: null,
        setupBanner: null,
        errorBanner: null
    };

    function init() {
        els.orderList = document.getElementById('order-list');
        els.queueCount = document.getElementById('queue-count');
        els.statusText = document.getElementById('status-text');
        els.emptyState = document.getElementById('empty-state');
        els.setupBanner = document.getElementById('setup-banner');
        els.errorBanner = document.getElementById('error-banner');

        showSetupBannerIfNeeded();

        if (SquareApi.isConfigured()) {
            refresh();
            startPolling();
        } else {
            setStatus('error', 'Not configured');
        }

        startWaitTimer();
    }

    function showSetupBannerIfNeeded() {
        els.setupBanner.classList.toggle('hidden', SquareApi.isConfigured());
    }

    function startPolling() {
        const interval = window.SQUARE_CONFIG?.pollIntervalMs || 10000;
        pollTimer = setInterval(refresh, interval);
    }

    function startWaitTimer() {
        waitTimer = setInterval(updateWaitTimes, 1000);
    }

    async function refresh() {
        if (!SquareApi.isConfigured()) {
            return;
        }

        try {
            const fetched = await SquareApi.fetchOrders();
            hideError();

            orders = new Map(fetched.map((o) => [o.id, o]));

            render();
            setStatus('live', 'Live · updated just now');
        } catch (err) {
            setStatus('error', err.message || 'Failed to load orders');
            showError(err.message || 'Failed to load orders');
        }
    }

    function setStatus(type, text) {
        els.statusText.textContent = text;
        els.statusText.classList.toggle('header__subtitle--live', type === 'live');
        els.statusText.classList.toggle('header__subtitle--error', type === 'error');
    }

    function showError(message) {
        els.errorBanner.textContent = message;
        els.errorBanner.classList.remove('hidden');
    }

    function hideError() {
        els.errorBanner.classList.add('hidden');
    }

    function render() {
        const list = [...orders.values()].sort(
            (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
        );

        els.queueCount.textContent = String(list.length);
        els.emptyState.classList.toggle('hidden', list.length > 0);
        els.orderList.innerHTML = '';

        list.forEach((order) => {
            els.orderList.appendChild(createOrderCard(order));
        });
    }

    function createOrderCard(order) {
        const li = document.createElement('li');
        li.className = 'order-card';
        li.dataset.orderId = order.id;

        const wait = formatWaitTime(order.createdAt);
        const waitClass = getWaitClass(wait.minutes);

        const ticketClass = order.ticketName.startsWith('#')
            ? 'order-card__ticket order-card__ticket--default'
            : 'order-card__ticket';

        li.innerHTML = `
            <div class="order-card__header">
                <span class="${ticketClass}">${escapeHtml(order.ticketName)}</span>
                <div class="order-card__wait">
                    <span class="order-card__wait-time order-card__wait-time--${waitClass}" data-wait-for="${order.id}">${wait.display}</span>
                    <span class="order-card__wait-label">waiting</span>
                </div>
            </div>
            <ul class="order-card__items">
                ${order.lineItems.map(renderLineItem).join('')}
            </ul>
            ${order.notes ? `
                <div class="order-card__note">
                    <span class="order-card__note-icon">📝</span>
                    <span class="order-card__note-text">${escapeHtml(order.notes)}</span>
                </div>
            ` : ''}
        `;

        attachSwipeHandlers(li, order.id);
        return li;
    }

    function renderLineItem(item) {
        const modText = item.modifiers.length
            ? `<div class="order-card__modifiers">${item.modifiers.map(escapeHtml).join(' · ')}</div>`
            : '';

        return `
            <li class="order-card__item">
                <span class="order-card__qty">${item.quantity}</span>
                <span class="order-card__item-name">${escapeHtml(item.name)}</span>
            </li>
            ${modText}
        `;
    }

    function attachSwipeHandlers(card, orderId) {
        let startY = 0;
        let currentY = 0;
        let dragging = false;

        card.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) {
                return;
            }
            startY = e.touches[0].clientY;
            currentY = 0;
            dragging = true;
            card.classList.add('order-card--dragging');
        }, { passive: true });

        card.addEventListener('touchmove', (e) => {
            if (!dragging) {
                return;
            }

            const deltaY = e.touches[0].clientY - startY;

            if (deltaY < 0) {
                return;
            }

            currentY = deltaY;
            card.style.transform = `translateY(${deltaY}px)`;
            card.style.opacity = String(Math.max(0.3, 1 - deltaY / 200));
        }, { passive: true });

        card.addEventListener('touchend', () => {
            if (!dragging) {
                return;
            }

            dragging = false;
            card.classList.remove('order-card--dragging');

            if (currentY >= SWIPE_THRESHOLD) {
                completeOrder(orderId, card);
            } else {
                card.style.transform = '';
                card.style.opacity = '';
            }
        }, { passive: true });

        card.addEventListener('mousedown', (e) => {
            startY = e.clientY;
            currentY = 0;
            dragging = true;
            card.classList.add('order-card--dragging');

            const onMove = (moveEvent) => {
                if (!dragging) {
                    return;
                }
                const deltaY = moveEvent.clientY - startY;
                if (deltaY < 0) {
                    return;
                }
                currentY = deltaY;
                card.style.transform = `translateY(${deltaY}px)`;
                card.style.opacity = String(Math.max(0.3, 1 - deltaY / 200));
            };

            const onUp = () => {
                dragging = false;
                card.classList.remove('order-card--dragging');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);

                if (currentY >= SWIPE_THRESHOLD) {
                    completeOrder(orderId, card);
                } else {
                    card.style.transform = '';
                    card.style.opacity = '';
                }
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    async function completeOrder(orderId, card) {
        card.classList.add('order-card--dismissing');
        card.style.pointerEvents = 'none';

        try {
            await SquareApi.completeOrder(orderId);
            hideError();
            orders.delete(orderId);
            render();
        } catch (err) {
            card.classList.remove('order-card--dismissing');
            card.style.transform = '';
            card.style.opacity = '';
            card.style.pointerEvents = '';
            showError(err.message || 'Failed to complete order in Square');
        }
    }

    function updateWaitTimes() {
        document.querySelectorAll('[data-wait-for]').forEach((el) => {
            const orderId = el.dataset.waitFor;
            const order = orders.get(orderId);
            if (!order) {
                return;
            }

            const wait = formatWaitTime(order.createdAt);
            el.textContent = wait.display;
            el.className = `order-card__wait-time order-card__wait-time--${getWaitClass(wait.minutes)}`;
        });
    }

    function formatWaitTime(createdAt) {
        const ms = Date.now() - new Date(createdAt).getTime();
        const totalSeconds = Math.max(0, Math.floor(ms / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        let display;
        if (minutes >= 60) {
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;
            display = `${hours}h ${mins}m`;
        } else if (minutes > 0) {
            display = `${minutes}m ${seconds}s`;
        } else {
            display = `${seconds}s`;
        }

        return { minutes, display };
    }

    function getWaitClass(minutes) {
        if (minutes < 5) {
            return 'fresh';
        }
        if (minutes < 10) {
            return 'warm';
        }
        return 'hot';
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
