/**
 * HeartPing - Main Application Logic
 */

import { backendService } from './firebase-service.js';

const SESSION_KEY = 'heartping_session_v2';
const emptyState = () => ({ myName: '', myCode: '', partnerName: '', partnerCode: '', isPaired: false, history: [] });
class HeartPingApp {
  constructor() {
    this.state = emptyState();
    this.demo = false;
    this.busy = false;
    this.storageAvailable = true;
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (saved && typeof saved.token === 'string') {
        backendService.token = saved.token;
        this.lastReceived = saved.lastReceived || '';
        this.pendingPing = saved.pendingPing || '';
      }
    } catch { this.storageAvailable = false; }
    this.initElements();
    this.initPWA();
    this.bindEvents();
    this.updateUI();
    if (backendService.token) this.refresh();
    this.pollTimer = setInterval(() => this.refresh(), 2000);
    window.addEventListener('online', () => this.refresh());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.refresh(); });
    if (!this.storageAvailable) this.showToast('Storage unavailable', 'Enable browser storage to keep your pairing after reload.');
  }

  persist() {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ token: backendService.token,
        lastReceived: this.lastReceived || '', pendingPing: this.pendingPing || '' }));
    } catch { this.showToast('Could not save session', 'Keep this page open. Browser storage is unavailable.'); }
  }

  applyState(data) {
    const wasPaired = this.state.isPaired;
    this.state = { ...emptyState(), ...data };
    const received = data.history.find(p => p.type === 'received');
    this.updateUI();
    if (!wasPaired && data.isPaired) this.showToast('Connected ❤️', 'Paired with ' + data.partnerName + '.');
    if (wasPaired && !data.isPaired) {
      this.pendingPing = '';
      this.showToast('Unpaired', 'You are no longer connected. Share your new code to pair again.');
    }
    if (received && received.id !== this.lastReceived) {
      this.lastReceived = received.id;
      this.handleReceivePing(received);
    }
    this.persist();
  }

  async refresh() {
    if (!backendService.token || this.demo || this.busy || this.refreshing || document.hidden) return;
    this.refreshing = true;
    const epoch = this.epoch;
    try {
      const data = await backendService.request('state');
      if (!this.demo && !this.busy && epoch === this.epoch) {
        this.lastError = "";
        this.applyState(data);
        this.setConnection('Connected · checks every 2 seconds');
      }
    } catch (error) { if (epoch === this.epoch && !this.demo) this.handleError(error); }
    finally { this.refreshing = false; }
  }

  setConnection(message) { document.getElementById('connection-status').textContent = message; }

  handleError(error) {
    if (error.status === 401) {
      backendService.token = '';
      this.pendingPing = '';
      this.lastReceived = '';
      this.state = emptyState();
      this.persist();
      this.updateUI();
    }
    this.setConnection(error.message);
    if (this.lastError !== error.message) this.showToast('Could not connect', error.message);
    this.lastError = error.message;
  }

  async action(work) {
    if (this.busy) return;
    this.busy = true;
    this.epoch = (this.epoch || 0) + 1;
    this.btnStartPairing.disabled = this.btnConnectPartner.disabled = this.btnHeartPing.disabled = true;
    try { await work(); this.lastError = ''; }
    catch (error) { this.handleError(error); }
    finally { this.busy = false; this.updateUI(); }
  }

  initElements() {
    // Screens
    this.screenWelcome = document.getElementById('screen-welcome');
    this.screenPairing = document.getElementById('screen-pairing');
    this.screenMain = document.getElementById('screen-main');

    // Welcome Screen Elements
    this.inputMyName = document.getElementById('input-my-name');
    this.btnStartPairing = document.getElementById('btn-start-pairing');

    // Pairing Screen Elements
    this.btnBackToName = document.getElementById('btn-back-to-name');
    this.navUserGreeting = document.getElementById('nav-user-greeting');
    this.myPairingCode = document.getElementById('my-pairing-code');
    this.btnCopyCode = document.getElementById('btn-copy-code');
    this.copyStatus = document.getElementById('copy-status');
    this.inputPartnerCode = document.getElementById('input-partner-code');
    this.btnConnectPartner = document.getElementById('btn-connect-partner');
    this.btnQuickDemo = document.getElementById('btn-quick-demo');

    // Main Paired Screen Elements
    this.partnerNameDisplay = document.getElementById('partner-name-display');
    this.btnHeartPing = document.getElementById('btn-heart-ping');
    this.pingStatusText = document.getElementById('ping-status-text');
    this.heartsContainer = document.getElementById('hearts-container');
    this.toastBanner = document.getElementById('toast-banner');
    this.toastTitle = document.getElementById('toast-title');
    this.toastDesc = document.getElementById('toast-desc');

    // Notifications & Controls
    this.btnEnableNotif = document.getElementById('btn-enable-notif');
    this.notifStatusLabel = document.getElementById('notif-status-label');
    this.btnSimulatePartnerPing = document.getElementById('btn-simulate-partner-ping');

    // History Elements
    this.historyList = document.getElementById('history-list');
    this.historyEmpty = document.getElementById('history-empty');
    this.historyCount = document.getElementById('history-count');

    // Modals
    this.modalSettings = document.getElementById('modal-settings');
    this.btnSettings = document.getElementById('btn-settings');
    this.btnCloseSettings = document.getElementById('btn-close-settings');
    this.btnUnpair = document.getElementById('btn-unpair');
    this.settingsMyName = document.getElementById('settings-my-name');
    this.settingsMyCode = document.getElementById('settings-my-code');
    this.settingsPartnerName = document.getElementById('settings-partner-name');
    this.settingsPartnerCode = document.getElementById('settings-partner-code');

    this.modalInfo = document.getElementById('modal-info');
    this.btnInfoModal = document.getElementById('btn-info-modal');
    this.btnCloseInfo = document.getElementById('btn-close-info');
    this.btnClearHistory = document.getElementById('btn-clear-history');
    this.infoDisplayMode = document.getElementById('info-display-mode');
    this.infoSwStatus = document.getElementById('info-sw-status');
    this.infoNotifStatus = document.getElementById('info-notif-status');
  }

  bindEvents() {
    this.inputMyName.addEventListener('input', () => { this.btnStartPairing.disabled = this.busy || !this.inputMyName.value.trim(); });
    this.btnStartPairing.addEventListener('click', () => this.action(async () => {
      const name = this.inputMyName.value.trim();
      if (!name) throw new Error('Please enter your first name.');
      const data = await backendService.request('session', { name });
      this.editingName = false;
      backendService.token = data.token;
      this.demo = false;
      this.applyState(data);
    }));
    this.btnBackToName.addEventListener('click', () => { if (!this.busy) { this.editingName = true; this.showScreen('welcome'); } });
    this.btnCopyCode.addEventListener('click', async () => {
      try {
        if (!navigator.clipboard) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(this.state.myCode);
        this.copyStatus.textContent = 'Copied!';
      } catch { this.showToast('Copy manually', 'Your pairing code is ' + this.state.myCode); }
      setTimeout(() => { this.copyStatus.textContent = 'Copy'; }, 2000);
    });
    this.inputPartnerCode.addEventListener('input', () => {
      this.inputPartnerCode.value = this.inputPartnerCode.value.replace(/[^0-9]/g, '').slice(0, 6);
      this.validateConnectButton();
    });
    this.btnConnectPartner.addEventListener('click', () => this.action(async () => {
      this.applyState(await backendService.request('join', { code: this.inputPartnerCode.value.trim() }));
      this.inputPartnerCode.value = '';
    }));
    document.querySelectorAll('[data-demo]').forEach(button => button.addEventListener('click', () => {
      if (this.busy) return;
      this.demo = true;
      this.lastError = "";
      this.epoch = (this.epoch || 0) + 1;
      this.editingName = false;
      this.state = { ...emptyState(), myName: this.inputMyName.value.trim() || 'You', myCode: 'DEMO', partnerName: 'Maya', partnerCode: 'DEMO', isPaired: true };
      this.updateUI();
      this.showToast('Local demo', 'These pings stay on this screen. No partner is connected.');
    }));
    this.btnHeartPing.addEventListener('click', () => this.handleSendPing());
    this.btnEnableNotif.addEventListener('click', () => this.requestNotificationPermission());
    this.btnSimulatePartnerPing.addEventListener('click', () => {
      if (!this.demo) return;
      const ping = { id: 'demo-' + Date.now(), type: 'received', sender: 'Maya', receiver: this.state.myName, timestamp: Date.now() };
      this.state.history.unshift(ping);
      this.state.history = this.state.history.slice(0, 30);
      this.handleReceivePing(ping);
      this.renderHistory();
    });
    this.btnSettings.addEventListener('click', () => this.openModal(this.modalSettings));
    this.btnInfoModal.addEventListener('click', () => this.openModal(this.modalInfo));
    for (const [modal, button] of [[this.modalSettings, this.btnCloseSettings], [this.modalInfo, this.btnCloseInfo]]) {
      button.addEventListener('click', () => this.closeModal(modal));
      modal.addEventListener('click', event => { if (event.target === modal) this.closeModal(modal); });
    }
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { this.closeModal(this.modalSettings); this.closeModal(this.modalInfo); }
    });
    this.btnUnpair.addEventListener('click', () => this.action(async () => {
      if (this.demo) { this.demo = false; this.state = emptyState(); }
      else {
        if (!confirm('Disconnect from ' + this.state.partnerName + '?')) return;
        this.applyState(await backendService.request('unpair', {}));
      }
      this.closeModal(this.modalSettings);
    }));
    this.btnClearHistory.addEventListener('click', () => this.action(async () => {
      if (this.demo) this.state.history = [];
      else this.applyState(await backendService.request('history/clear', {}));
      this.closeModal(this.modalInfo);
    }));
  }

  validateConnectButton() { this.btnConnectPartner.disabled = this.busy || !/^\d{6}$/.test(this.inputPartnerCode.value); }

  showScreen(name) {
    this.screenWelcome.classList.remove('active');
    this.screenPairing.classList.remove('active');
    this.screenMain.classList.remove('active');

    if (name === 'welcome') {
      this.screenWelcome.classList.add('active');
      this.inputMyName.value = this.state.myName;
      this.btnStartPairing.disabled = !this.state.myName;
    } else if (name === 'pairing') {
      this.screenPairing.classList.add('active');
      this.navUserGreeting.textContent = `Hi ${this.state.myName}`;
      this.myPairingCode.textContent = this.state.myCode || '------';
    } else if (name === 'main') {
      this.screenMain.classList.add('active');
      this.partnerNameDisplay.textContent = `Paired with ${this.state.partnerName}`;
      this.renderHistory();
    }
  }

  updateUI() {
    if (this.state.isPaired) this.showScreen('main');
    else if (this.state.myName && !this.editingName) this.showScreen('pairing');
    else if (!this.screenWelcome.classList.contains('active')) this.showScreen('welcome');
    this.settingsMyName.textContent = this.state.myName || '-';
    this.settingsMyCode.textContent = this.state.myCode || '-';
    this.settingsPartnerName.textContent = this.state.partnerName || '-';
    this.settingsPartnerCode.textContent = this.state.partnerCode || '-';
    this.partnerNameDisplay.textContent = (this.demo ? 'Demo with ' : 'Paired with ') + this.state.partnerName;
    this.btnSimulatePartnerPing.parentElement.hidden = !this.demo;
    this.btnUnpair.textContent = this.demo ? 'Exit Demo' : 'Unpair & Change Partner';
    this.btnHeartPing.disabled = this.busy || !this.state.isPaired;
    this.btnStartPairing.disabled = this.busy || !this.inputMyName.value.trim();
    this.validateConnectButton();
    this.setConnection(this.lastError || (this.demo ? 'Local demo · no messages leave this screen' : 'Keep HeartPing open to receive pings.'));
    this.updateNotificationUI();
    this.renderHistory();
  }

  async handleSendPing() {
    if (!this.state.isPaired) return;
    await this.action(async () => {
      if (this.demo) {
        this.state.history.unshift({ id: 'demo-' + Date.now(), type: 'sent', sender: this.state.myName, receiver: 'Maya', timestamp: Date.now() });
        this.state.history = this.state.history.slice(0, 30);
      } else {
        this.pendingPing ||= Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
        this.persist();
        this.applyState(await backendService.request('ping', { id: this.pendingPing }));
        this.pendingPing = '';
        this.persist();
      }
      this.spawnFloatingHearts(10);
      this.triggerHaptic([40, 60, 40]);
      this.pingStatusText.textContent = this.demo ? 'Demo ping played ❤️' : 'Ping saved for ' + this.state.partnerName + ' ❤️';
      this.showToast(this.demo ? 'Demo ping ❤️' : 'Ping sent ❤️', this.demo ? 'No real partner received this.' : 'Your partner can see it when HeartPing connects.');
    });
  }

  handleReceivePing(ping) {
    this.spawnFloatingHearts(12);
    this.triggerHaptic([60, 80, 60]);
    this.showToast((this.demo ? 'Demo: ' : '') + ping.sender + ' pinged you! ❤️', 'A warm heartbeat has arrived.');
    this.pingStatusText.textContent = 'Received from ' + ping.sender + ' at ' + new Date(ping.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.triggerLocalNotification('HeartPing ❤️', ping.sender + ' is thinking of you.');
  }

  renderHistory() {
    this.historyList.replaceChildren();
    this.historyCount.textContent = this.state.history.length + ' pings';
    if (!this.state.history.length) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = 'No pings yet. Tap the heart to send your first ping!';
      this.historyList.append(empty);
    }
    for (const item of this.state.history) {
      const row = document.createElement('div'); row.className = 'history-item';
      const desc = document.createElement('span'); desc.className = 'history-desc';
      desc.textContent = item.type === 'sent' ? '❤️ You → ' + item.receiver : '💖 ' + item.sender + ' → You';
      const time = document.createElement('span'); time.className = 'history-time';
      time.textContent = this.formatRelativeTime(item.timestamp);
      row.append(desc, time); this.historyList.append(row);
    }
  }

  formatRelativeTime(timestamp) {
    if (!timestamp) return 'Just now';
    const diff = Math.floor((Date.now() - timestamp) / 1000);

    if (diff < 15) return 'Just now';
    if (diff < 60) return `${diff}s ago`;
    const minutes = Math.floor(diff / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  /**
   * Floating Hearts Particle Animation
   */
  spawnFloatingHearts(count = 8) {
    if (!this.heartsContainer) return;
    const symbols = ['❤️', '💖', '💕', '💓', '💗', '✨'];

    for (let i = 0; i < count; i++) {
      const heart = document.createElement('div');
      heart.className = 'floating-heart';
      heart.textContent = symbols[Math.floor(Math.random() * symbols.length)];

      const left = 35 + Math.random() * 30; // 35% - 65% around heart button
      const rot = (Math.random() - 0.5) * 60;
      const delay = Math.random() * 0.3;

      heart.style.left = `${left}%`;
      heart.style.setProperty('--rot', `${rot}deg`);
      heart.style.animationDelay = `${delay}s`;

      this.heartsContainer.appendChild(heart);

      setTimeout(() => {
        heart.remove();
      }, 2000);
    }
  }

  /**
   * Tactile Haptic Vibration (Standard Web Vibration API)
   */
  triggerHaptic(pattern = [30, 40, 30]) {
    if (window.AndroidBridge?.vibrate) { window.AndroidBridge.vibrate(80); return; }
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {
        // Silently catch if unsupported or user has disabled vibrations
      }
    }
  }

  /**
   * Top Toast / Dynamic Island Banner
   */
  showToast(title, desc) {
    if (!this.toastBanner) return;
    this.toastTitle.textContent = title;
    this.toastDesc.textContent = desc;

    this.toastBanner.classList.add('show');

    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastBanner.classList.remove('show');
    }, 3200);
  }

  /**
   * Real Web Notification Management
   */
  updateNotificationUI() {
    if (!('Notification' in window)) {
      this.notifStatusLabel.textContent = 'Not supported in this browser';
      this.btnEnableNotif.disabled = true;
      this.btnEnableNotif.textContent = 'N/A';
      return;
    }

    const permission = Notification.permission;
    if (permission === 'granted') {
      this.notifStatusLabel.textContent = 'Enabled while the app is open';
      this.btnEnableNotif.textContent = 'Active';
      this.btnEnableNotif.disabled = true;
      this.btnEnableNotif.style.background = '#34C759';
    } else if (permission === 'denied') {
      this.notifStatusLabel.textContent = 'Status: Blocked in browser settings';
      this.btnEnableNotif.textContent = 'Blocked';
      this.btnEnableNotif.disabled = true;
    } else {
      this.notifStatusLabel.textContent = 'Alerts while the app is open';
      this.btnEnableNotif.textContent = 'Enable';
      this.btnEnableNotif.disabled = false;
    }

    if (this.infoNotifStatus) {
      this.infoNotifStatus.textContent = permission.toUpperCase();
    }
  }

  async requestNotificationPermission() {
    if (!('Notification' in window)) {
      alert('This device or browser does not support the Web Notification API.');
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      this.updateNotificationUI();

      if (permission === 'granted') {
        this.showToast('Notifications Active! 🔔', 'Alerts work while HeartPing is open and connected.');
        this.triggerLocalNotification('HeartPing Notifications Enabled ❤️', 'You are all set to receive your partner’s heartbeat.');
      } else {
        this.showToast('Notifications Disabled', 'You can enable alerts anytime in your browser permissions.');
      }
    } catch (err) {
      console.warn('Error requesting notifications', err);
    }
  }

  triggerLocalNotification(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then((registration) => {
          return registration.showNotification(title, {
            body: body,
            icon: './icons/icon-192.png',
            badge: './icons/icon-192.png',
            vibrate: [200, 100, 200]
          });
        }).catch(error => console.warn('Notification unavailable:', error.message));
      } else {
        new Notification(title, {
          body: body,
          icon: './icons/icon-192.png'
        });
      }
    } catch (e) {
      console.warn('Notification trigger error:', e);
    }
  }

  /**
   * PWA Initialization & Service Worker
   */
  initPWA() {
    // Check standalone mode (PWA installed)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (this.infoDisplayMode) {
      this.infoDisplayMode.textContent = isStandalone ? 'Standalone (Home Screen)' : 'Browser / Web View';
    }

    // Register Service Worker
    if ('serviceWorker' in navigator && location.hostname !== 'appassets.androidplatform.net') {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then((reg) => {
            console.log('HeartPing ServiceWorker registered with scope:', reg.scope);
            if (this.infoSwStatus) this.infoSwStatus.textContent = 'Registered';
          })
          .catch((err) => {
            console.warn('HeartPing ServiceWorker registration failed:', err);
            if (this.infoSwStatus) this.infoSwStatus.textContent = 'Local Mode';
          });
      });
    } else {
      if (this.infoSwStatus) this.infoSwStatus.textContent = 'Not Supported';
    }
  }

  // Modal helpers
  openModal(modalEl) {
    modalEl.style.display = 'flex';
    modalEl.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      modalEl.classList.add('open');
    }, 10);
  }

  closeModal(modalEl) {
    modalEl.classList.remove('open');
    modalEl.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      modalEl.style.display = 'none';
    }, 300);
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.heartPingApp = new HeartPingApp();
});
