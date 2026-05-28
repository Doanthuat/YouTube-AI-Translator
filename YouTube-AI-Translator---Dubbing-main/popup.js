// Load saved settings
chrome.storage.sync.get(['geminiApiKey', 'targetLang'], (data) => {
  if (data.geminiApiKey) {
    document.getElementById('apiKey').value = data.geminiApiKey;
  }
  if (data.targetLang) {
    document.getElementById('targetLang').value = data.targetLang;
  }
});

// Save API key
document.getElementById('saveKey').addEventListener('click', () => {
  const apiKey = document.getElementById('apiKey').value.trim();

  if (!apiKey) {
    chrome.storage.sync.remove(['geminiApiKey'], () => {
      showStatus('Đã xoá API key. Sẽ dùng dịch miễn phí.', 'success');
    });
    return;
  }

  chrome.storage.sync.set({ geminiApiKey: apiKey }, () => {
    showStatus('Đã lưu API key!', 'success');
  });
});

// Start translation
document.getElementById('startTranslation').addEventListener('click', async () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  const targetLang = document.getElementById('targetLang').value;

  // Save target language
  chrome.storage.sync.set({ targetLang });

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url.includes('youtube.com/watch')) {
    showStatus('Hãy mở một video YouTube trước', 'error');
    return;
  }

  // Send message to content script
  showStatus(apiKey ? 'Đang bắt đầu dịch...' : 'Đang bắt đầu dịch miễn phí...', 'info');

  chrome.tabs.sendMessage(tab.id, {
    action: 'startTranslation',
    apiKey,
    targetLang
  }, (response) => {
    if (chrome.runtime.lastError) {
      showStatus('Lỗi: Hãy refresh lại trang YouTube', 'error');
      return;
    }

    if (response && response.success) {
      showStatus('Đã bắt đầu dịch! Hãy xem trên trang video', 'success');
    } else {
      showStatus(response?.error || 'Không thể bắt đầu dịch', 'error');
    }
  });
});

// Save target language on change
document.getElementById('targetLang').addEventListener('change', (e) => {
  chrome.storage.sync.set({ targetLang: e.target.value });
});

function showStatus(message, type) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;

  if (type === 'success') {
    setTimeout(() => {
      statusEl.style.display = 'none';
    }, 3000);
  }
}