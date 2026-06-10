'use strict';

const SWIPE_THRESHOLD = 80;

const App = (() => {
    /** @type {Map<string, object>} */
    let orders = new Map();

    let pollTimer = null;
    let waitTimer = null;
    let appStarted = false;
    let currentLocationName = '';

    const els = {
        orderList: null,
        queueCount: null,
        completedCount: null,
        statusText: null,
        emptyState: null,
        setupBanner: null,
        errorBanner: null,
        loginScreen: null,
        loginBtn: null,
        logoutBtn: null,
        locationScreen: null,
        locationList: null,
        loginBackdrop: null,
        loginPending: null,
        headerStats: null,
        appFooter: null,
        completedBtn: null,
        completedPanel: null,
        completedBackdrop: null,
        completedClose: null,
        completedList: null,
        completedEmpty: null
    };

    function init() {
        Auth.init();

        els.orderList = document.getElementById('order-list');
        els.queueCount = document.getElementById('queue-count');
        els.completedCount = document.getElementById('completed-count');
        els.statusText = document.getElementById('status-text');
        els.emptyState = document.getElementById('empty-state');
        els.setupBanner = document.getElementById('setup-banner');
        els.errorBanner = document.getElementById('error-banner');
        els.loginScreen = document.getElementById('login-screen');
        els.loginBtn = document.getElementById('login-btn');
        els.logoutBtn = document.getElementById('logout-btn');
        els.locationScreen = document.getElementById('location-screen');
        els.locationList = document.getElementById('location-list');
        els.loginBackdrop = document.getElementById('login-backdrop');
        els.loginPending = document.getElementById('login-pending');
        els.headerStats = document.getElementById('header-stats');
        els.appFooter = document.getElementById('app-footer');
        els.completedBtn = document.getElementById('completed-btn');
        els.completedPanel = document.getElementById('completed-panel');
        els.completedBackdrop = document.getElementById('completed-backdrop');
        els.completedClose = document.getElementById('completed-close');
        els.completedList = document.getElementById('completed-list');
        els.completedEmpty = document.getElementById('completed-empty');

        els.completedBtn.addEventListener('click', openCompletedPanel);
        els.completedClose.addEventListener('click', closeCompletedPanel);
        els.completedBackdrop.addEventListener('click', closeCompletedPanel);
        els.loginBtn.addEventListener('click', handleLogin);
        els.logoutBtn.addEventListener('click', handleLogout);

        showSetupBannerIfNeeded();
        startWaitTimer();

        if (!SquareApi.isConfigured()) {
            setStatus('error', 'Not configured');
            return;
        }

        bootstrap();
    }

    function showSetupBannerIfNeeded() {
        els.setupBanner.classList.toggle('hidden', SquareApi.isConfigured());
        const sandboxHint = document.getElementById('sandbox-hint');
        if (sandboxHint) {
            sandboxHint.classList.toggle('hidden', !window.SQUARE_CONFIG?.sandboxMode);
        }
    }

    async function handleLogin() {
        els.loginBtn.disabled = true;
        setLoginPending(true);
        hideError();

        try {
            await Auth.login();
            await bootstrap();
        } catch (err) {
            if (err.message !== 'Login cancelled') {
                showError(err.message || 'Login failed');
            }
        } finally {
            setLoginPending(false);
            els.loginBtn.disabled = false;
        }
    }

    function setLoginPending(visible) {
        els.loginBackdrop?.classList.toggle('hidden', !visible);
        els.loginPending?.classList.toggle('hidden', !visible);
    }

    async function bootstrap() {
        if (!Auth.isLoggedIn()) {
            showLoginScreen();
            return;
        }

        try {
            const me = await Auth.fetchMe();
            if (me.needsLocation) {
                await showLocationPicker();
                return;
            }
            startApp(me.locationName);
        } catch (err) {
            if (err.needsAuth) {
                showLoginScreen();
                return;
            }
            setStatus('error', err.message || 'Failed to connect');
            showError(err.message || 'Failed to connect');
        }
    }

    function showLoginScreen() {
        stopApp();
        els.loginScreen.classList.remove('hidden');
        els.locationScreen.classList.add('hidden');
        els.logoutBtn.classList.add('hidden');
        els.completedBtn.classList.add('hidden');
        els.headerStats?.classList.add('hidden');
        els.appFooter?.classList.add('hidden');
        els.orderList.classList.add('hidden');
        els.emptyState.classList.add('hidden');
        setStatus('', 'Sign in to view orders');
    }

    async function showLocationPicker() {
        stopApp();
        els.loginScreen.classList.add('hidden');
        els.locationScreen.classList.remove('hidden');
        els.locationList.innerHTML = '<li class="location-loading">Loading locations…</li>';

        try {
            const locations = await Auth.fetchLocations();
            els.locationList.innerHTML = '';

            if (locations.length === 0) {
                els.locationList.innerHTML = '<li class="location-empty">No active Square locations found.</li>';
                return;
            }

            locations.forEach((loc) => {
                const li = document.createElement('li');
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'location-list__btn';
                btn.innerHTML = `
                    <span class="location-list__name">${escapeHtml(loc.name)}</span>
                    ${loc.address ? `<span class="location-list__address">${escapeHtml(loc.address)}</span>` : ''}
                `;
                btn.addEventListener('click', () => selectLocation(loc.id, loc.name));
                li.appendChild(btn);
                els.locationList.appendChild(li);
            });
        } catch (err) {
            if (err.needsAuth) {
                showLoginScreen();
                return;
            }
            els.locationList.innerHTML = `<li class="location-empty">${escapeHtml(err.message || 'Failed to load locations')}</li>`;
        }
    }

    async function selectLocation(locationId, locationName) {
        try {
            await Auth.setLocation(locationId);
            startApp(locationName);
        } catch (err) {
            showError(err.message || 'Failed to select location');
        }
    }

    function startApp(locationName) {
        appStarted = true;
        currentLocationName = locationName || '';
        els.loginScreen.classList.add('hidden');
        els.locationScreen.classList.add('hidden');
        els.logoutBtn.classList.remove('hidden');
        els.completedBtn.classList.remove('hidden');
        els.headerStats?.classList.remove('hidden');
        els.appFooter?.classList.remove('hidden');
        els.orderList.classList.remove('hidden');
        hideError();

        const label = locationName ? `Live · ${locationName}` : 'Live';
        setStatus('live', label);

        refresh();
        startPolling();
    }

    function stopApp() {
        appStarted = false;
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    async function handleLogout() {
        stopApp();
        await Auth.logout();
        showLoginScreen();
    }

    function handleApiError(err) {
        if (err.needsAuth) {
            showLoginScreen();
            return true;
        }
        if (err.needsLocation) {
            showLocationPicker();
            return true;
        }
        return false;
    }

    function startPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
        }
        const interval = window.SQUARE_CONFIG?.pollIntervalMs || 10000;
        pollTimer = setInterval(refresh, interval);
    }

    function startWaitTimer() {
        waitTimer = setInterval(updateWaitTimes, 1000);
    }

    async function refresh() {
        if (!SquareApi.isConfigured() || !appStarted) {
            return;
        }

        try {
            const [fetched, completed] = await Promise.all([
                SquareApi.fetchOrders(),
                SquareApi.fetchCompletedOrders()
            ]);
            hideError();

            orders = new Map(fetched.map((o) => [o.id, o]));
            els.completedCount.textContent = String(completed.length);

            render();
            const suffix = currentLocationName ? ` · ${currentLocationName}` : '';
            setStatus('live', `Live · updated just now${suffix}`);
        } catch (err) {
            if (handleApiError(err)) {
                return;
            }
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
            await updateCompletedCount();
        } catch (err) {
            card.classList.remove('order-card--dismissing');
            card.style.transform = '';
            card.style.opacity = '';
            card.style.pointerEvents = '';
            if (handleApiError(err)) {
                return;
            }
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

    async function updateCompletedCount() {
        try {
            const completed = await SquareApi.fetchCompletedOrders();
            els.completedCount.textContent = String(completed.length);
        } catch {
            // keep previous count on failure
        }
    }

    async function openCompletedPanel() {
        els.completedPanel.classList.remove('hidden');
        els.completedBackdrop.classList.remove('hidden');
        els.completedPanel.setAttribute('aria-hidden', 'false');
        els.completedBtn.setAttribute('aria-expanded', 'true');
        els.completedList.innerHTML = '<li class="completed-loading">Loading…</li>';
        els.completedEmpty.classList.add('hidden');

        try {
            const completed = await SquareApi.fetchCompletedOrders();
            els.completedCount.textContent = String(completed.length);
            renderCompletedList(completed);
        } catch (err) {
            els.completedList.innerHTML = '';
            if (handleApiError(err)) {
                closeCompletedPanel();
                return;
            }
            els.completedEmpty.textContent = err.message || 'Failed to load completed orders';
            els.completedEmpty.classList.remove('hidden');
        }
    }

    function closeCompletedPanel() {
        els.completedPanel.classList.add('hidden');
        els.completedBackdrop.classList.add('hidden');
        els.completedPanel.setAttribute('aria-hidden', 'true');
        els.completedBtn.setAttribute('aria-expanded', 'false');
    }

    function renderCompletedList(orders) {
        els.completedList.innerHTML = '';

        if (orders.length === 0) {
            els.completedEmpty.textContent = 'No completed orders yet today.';
            els.completedEmpty.classList.remove('hidden');
            return;
        }

        els.completedEmpty.classList.add('hidden');

        orders.forEach((order) => {
            els.completedList.appendChild(createCompletedCard(order));
        });
    }

    function createCompletedCard(order) {
        const li = document.createElement('li');
        li.className = 'completed-card';

        const itemSummary = order.lineItems
            .map((item) => `${item.quantity}× ${item.name}`)
            .join(', ');

        const completedLabel = formatCompletedTime(order.completedAt || order.createdAt);

        li.innerHTML = `
            <div class="completed-card__header">
                <span class="completed-card__ticket">${escapeHtml(order.ticketName)}</span>
                <span class="completed-card__time">${escapeHtml(completedLabel)}</span>
            </div>
            <p class="completed-card__items">${escapeHtml(itemSummary)}</p>
            ${order.notes ? `<p class="completed-card__note">${escapeHtml(order.notes)}</p>` : ''}
            <button type="button" class="completed-card__uncomplete">Uncomplete</button>
        `;

        li.querySelector('.completed-card__uncomplete').addEventListener('click', () => {
            uncompleteOrder(order.id, li);
        });

        return li;
    }

    async function uncompleteOrder(orderId, card) {
        const btn = card.querySelector('.completed-card__uncomplete');
        btn.disabled = true;
        btn.textContent = 'Restoring…';

        try {
            await SquareApi.uncompleteOrder(orderId);
            hideError();
            card.remove();

            if (els.completedList.children.length === 0) {
                els.completedEmpty.textContent = 'No completed orders yet today.';
                els.completedEmpty.classList.remove('hidden');
            }

            await refresh();
        } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Uncomplete';
            if (handleApiError(err)) {
                closeCompletedPanel();
                return;
            }
            showError(err.message || 'Failed to restore order');
        }
    }

    function formatCompletedTime(iso) {
        const date = new Date(iso);
        return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
