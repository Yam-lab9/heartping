/**
 * HeartPing - Main Application Logic
 */

import { backendService } from './firebase-service.js';

// Application State Keys
const STORAGE_KEYS = {
  MY_NAME: 'heartping_my_name',
  MY_CODE: 'heartping_my_code',
  PARTNER_NAME: 'heartping_partner_name',
  PARTNER_CODE: 'heartping_partner_code',
  IS_PAIRED: 'heartping_is_paired',
  HISTORY: 'heartping_history'
};

class HeartPingApp {
  constructor() {
    this.state = {
      myName: localStorage.getItem(STORAGE_KEYS.MY_NAME) || '',
      myCode: localStorage.getItem(STORAGE_KEYS.MY_CODE) || '',
      partnerName: localStorage.getItem(STORAGE_KEYS.PARTNER_NAME) || '',
      partnerCode: localStorage.getItem(STORAGE_KEYS.PARTNER_CODE) || '',
      isPaired: localStorage.getItem(STORAGE_KEYS.IS_PAIRED) === 'true',
      history: this.loadHistory()
    };

    this.initElements();
    this.initPWA();
    this.bindEvents();
    this.updateUI();
    this.setupBackendListener();
  }

  loadHistory() {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.HISTORY);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.warn('Failed to parse history from localStorage', e);
      return [];
    }
  }

  saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(this.state.history.slice(0, 30)));
    } catch (e) {
      console.warn('Failed to save history', e);
    }
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
    this.inputPartnerName = document.getElementById('input-partner-name');
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
    // 1. Welcome input
    this.inputMyName.addEventListener('input', () => {
      const val = this.inputMyName.value.trim();
      this.btnStartPairing.disabled = val.length === 0;
    });

    this.btnStartPairing.addEventListener('click', () => {
      const name = this.inputMyName.value.trim();
      if (!name) return;
      this.state.myName = name;
      localStorage.setItem(STORAGE_KEYS.MY_NAME, name);

      // Ensure user has a 6-digit code
      if (!this.state.myCode || this.state.myCode.length !== 6) {
        this.state.myCode = backendService.generatePairingCode();
        localStorage.setItem(STORAGE_KEYS.MY_CODE, this.state.myCode);
      }

      this.showScreen('pairing');
    });

    // 2. Back button from pairing to name
    this.btnBackToName.addEventListener('click', () => {
      this.showScreen('welcome');
    });

    // Copy Code button
    this.btnCopyCode.addEventListener('click', () => {
      if (!this.state.myCode) return;
      navigator.clipboard.writeText(this.state.myCode).then(() => {
        this.copyStatus.textContent = 'Copied!';
        setTimeout(() => {
          this.copyStatus.textContent = 'Copy';
        }, 2000);
      }).catch(() => {
        this.copyStatus.textContent = 'Copied!';
        setTimeout(() => {
          this.copyStatus.textContent = 'Copy';
        }, 2000);
      });
    });

    // Partner Code Input Validation
    this.inputPartnerCode.addEventListener('input', () => {
      // Allow only numbers
      this.inputPartnerCode.value = this.inputPartnerCode.value.replace(/[^0-9]/g, '');
      this.validateConnectButton();
    });

    this.inputPartnerName.addEventListener('input', () => {
      this.validateConnectButton();
    });

    // Connect to Partner
    this.btnConnectPartner.addEventListener('click', async () => {
      const code = this.inputPartnerCode.value.trim();
      const customName = this.inputPartnerName.value.trim() || 'My Love';

      if (code.length !== 6) {
        alert('Please enter a 6-digit code from your partner.');
        return;
      }

      if (code === this.state.myCode) {
        alert('You cannot pair with your own code! Send your code to your partner instead.');
        return;
      }

      this.pairPartner(customName, code);
    });

    // Quick Demo Pair Button
    this.btnQuickDemo.addEventListener('click', () => {
      const demoPartnerName = 'Maya';
      const demoPartnerCode = '729104';
      this.pairPartner(demoPartnerName, demoPartnerCode);
    });

    // 3. Heart Ping Button Tap
    this.btnHeartPing.addEventListener('click', () => {
      this.handleSendPing();
    });

    // 4. Notifications Permission
    this.btnEnableNotif.addEventListener('click', () => {
      this.requestNotificationPermission();
    });

    // 5. Test Incoming Ping (Partner Simulation)
    this.btnSimulatePartnerPing.addEventListener('click', () => {
      this.handleReceivePing({
        sender: this.state.partnerName || 'Partner',
        receiver: this.state.myName || 'You',
        timestamp: Date.now(),
        message: 'Heartbeat received ❤️'
      });
    });

    // 6. Settings Modal
    this.btnSettings.addEventListener('click', () => {
      this.openModal(this.modalSettings);
    });
    this.btnCloseSettings.addEventListener('click', () => {
      this.closeModal(this.modalSettings);
    });
    this.modalSettings.addEventListener('click', (e) => {
      if (e.target === this.modalSettings) this.closeModal(this.modalSettings);
    });

    // Unpair Action
    this.btnUnpair.addEventListener('click', () => {
      if (confirm(`Are you sure you want to unpair from ${this.state.partnerName}?`)) {
        this.unpair();
      }
    });

    // 7. Info Modal
    this.btnInfoModal.addEventListener('click', () => {
      this.openModal(this.modalInfo);
    });
    this.btnCloseInfo.addEventListener('click', () => {
      this.closeModal(this.modalInfo);
    });
    this.modalInfo.addEventListener('click', (e) => {
      if (e.target === this.modalInfo) this.closeModal(this.modalInfo);
    });

    this.btnClearHistory.addEventListener('click', () => {
      this.state.history = [];
      this.saveHistory();
      this.renderHistory();
      this.showToast('History Cleared', 'All ping logs have been reset.');
      this.closeModal(this.modalInfo);
    });
  }

  validateConnectButton() {
    const code = this.inputPartnerCode.value.trim();
    this.btnConnectPartner.disabled = (code.length !== 6);
  }

  pairPartner(name, code) {
    this.state.partnerName = name;
    this.state.partnerCode = code;
    this.state.isPaired = true;

    localStorage.setItem(STORAGE_KEYS.PARTNER_NAME, name);
    localStorage.setItem(STORAGE_KEYS.PARTNER_CODE, code);
    localStorage.setItem(STORAGE_KEYS.IS_PAIRED, 'true');

    this.closeModal(this.modalSettings);
    this.showScreen('main');
    this.showToast('Pairing Successful! ❤️', `Connected with ${name}. You can now send pings!`);
    this.triggerHaptic();
  }

  unpair() {
    this.state.isPaired = false;
    this.state.partnerName = '';
    this.state.partnerCode = '';
    localStorage.setItem(STORAGE_KEYS.IS_PAIRED, 'false');
    localStorage.removeItem(STORAGE_KEYS.PARTNER_NAME);
    localStorage.removeItem(STORAGE_KEYS.PARTNER_CODE);

    this.closeModal(this.modalSettings);
    this.showScreen('pairing');
    this.showToast('Unpaired', 'You have disconnected from your partner.');
  }

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
    // Decide starting screen
    if (this.state.isPaired && this.state.partnerName) {
      this.showScreen('main');
    } else if (this.state.myName) {
      if (!this.state.myCode) {
        this.state.myCode = backendService.generatePairingCode();
        localStorage.setItem(STORAGE_KEYS.MY_CODE, this.state.myCode);
      }
      this.showScreen('pairing');
    } else {
      this.showScreen('welcome');
    }

    // Populate Settings modal fields
    this.settingsMyName.textContent = this.state.myName || '-';
    this.settingsMyCode.textContent = this.state.myCode || '-';
    this.settingsPartnerName.textContent = this.state.partnerName || '-';
    this.settingsPartnerCode.textContent = this.state.partnerCode || '-';

    this.updateNotificationUI();
    this.renderHistory();
  }

  /**
   * One-tap heart ping sent
   */
  async handleSendPing() {
    // 1. Play active burst animation
    this.btnHeartPing.classList.remove('pulsing');
    void this.btnHeartPing.offsetWidth; // trigger reflow
    this.btnHeartPing.classList.add('pulsing');

    // 2. Spawn floating hearts particle explosion
    this.spawnFloatingHearts(10);

    // 3. Tactile haptic feedback
    this.triggerHaptic([40, 60, 40, 80, 100]);

    // 4. Update status text
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.pingStatusText.textContent = `Ping sent to ${this.state.partnerName} at ${timeStr} ❤️`;
    this.pingStatusText.classList.add('active');

    // 5. Toast Confirmation: "Ping sent ❤️"
    this.showToast('Ping sent ❤️', `${this.state.partnerName} will feel your love.`);

    // 6. Save in history
    const pingRecord = {
      id: 'ping_' + Date.now(),
      type: 'sent',
      sender: this.state.myName || 'You',
      receiver: this.state.partnerName || 'Partner',
      timestamp: Date.now()
    };

    this.state.history.unshift(pingRecord);
    this.saveHistory();
    this.renderHistory();

    // 7. Dispatch to Backend service
    try {
      await backendService.sendPing(pingRecord);
    } catch (e) {
      console.warn('Backend send ping warning:', e);
    }
  }

  /**
   * Handle receiving an incoming ping from partner
   */
  handleReceivePing(pingData) {
    // Animate heart
    this.btnHeartPing.classList.remove('pulsing');
    void this.btnHeartPing.offsetWidth;
    this.btnHeartPing.classList.add('pulsing');

    // Spawn hearts
    this.spawnFloatingHearts(12);

    // Strong double haptic heartbeat
    this.triggerHaptic([60, 80, 60, 120, 100]);

    // Toast
    this.showToast(`${this.state.partnerName} pinged you! ❤️`, 'A warm heartbeat just arrived from afar.');

    // Status text
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.pingStatusText.textContent = `Received ping from ${this.state.partnerName} at ${timeStr} 💖`;
    this.pingStatusText.classList.add('active');

    // Add to history
    const record = {
      id: 'ping_' + Date.now(),
      type: 'received',
      sender: this.state.partnerName || 'Partner',
      receiver: this.state.myName || 'You',
      timestamp: pingData.timestamp || Date.now()
    };

    this.state.history.unshift(record);
    this.saveHistory();
    this.renderHistory();

    // Trigger local device push notification if permitted
    this.triggerLocalNotification(`${this.state.partnerName} sent you a HeartPing! ❤️`, 'Your partner is thinking of you right now.');
  }

  setupBackendListener() {
    backendService.onPingReceived((pingData) => {
      this.handleReceivePing(pingData);
    });
  }

  /**
   * Render History list
   */
  renderHistory() {
    if (!this.historyList) return;

    if (!this.state.history || this.state.history.length === 0) {
      this.historyList.innerHTML = '<div class="history-empty">No pings yet. Tap the heart to send your first ping!</div>';
      this.historyCount.textContent = '0 pings';
      return;
    }

    this.historyCount.textContent = `${this.state.history.length} ping${this.state.history.length > 1 ? 's' : ''}`;
    this.historyList.innerHTML = '';

    this.state.history.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'history-item';

      const isSent = item.type === 'sent';
      const icon = isSent ? '❤️' : '💖';
      const text = isSent
        ? `You &rarr; ${item.receiver}`
        : `${item.sender} &rarr; You`;

      const timeAgo = this.formatRelativeTime(item.timestamp);

      el.innerHTML = `
        <div class="history-left">
          <span class="history-badge">${icon}</span>
          <span class="history-desc">${text}</span>
        </div>
        <span class="history-time">${timeAgo}</span>
      `;

      this.historyList.appendChild(el);
    });
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
      this.notifStatusLabel.textContent = 'Status: Enabled (Ready for pings)';
      this.btnEnableNotif.textContent = 'Active';
      this.btnEnableNotif.disabled = true;
      this.btnEnableNotif.style.background = '#34C759';
    } else if (permission === 'denied') {
      this.notifStatusLabel.textContent = 'Status: Blocked in browser settings';
      this.btnEnableNotif.textContent = 'Blocked';
      this.btnEnableNotif.disabled = true;
    } else {
      this.notifStatusLabel.textContent = 'Status: Tap to enable push alerts';
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
        this.showToast('Notifications Active! 🔔', 'You will receive alerts when your partner pings.');
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
          registration.showNotification(title, {
            body: body,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            vibrate: [200, 100, 200]
          });
        });
      } else {
        new Notification(title, {
          body: body,
          icon: '/icons/icon-192.png'
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
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then((reg) => {
            console.log('HeartPing ServiceWorker registered with scope:', reg.scope);
            if (this.infoSwStatus) this.infoSwStatus.textContent = 'Active (Cached)';
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
