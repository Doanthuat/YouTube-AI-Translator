// =============================================
// Cloud TTS language code mapping
// Maps our short lang codes to BCP-47 codes used by Cloud TTS
// =============================================
const LANG_TO_BCP47 = {
  ar: 'ar-XA', zh: 'cmn-CN', en: 'en-US', fr: 'fr-FR',
  de: 'de-DE', hi: 'hi-IN', it: 'it-IT', ja: 'ja-JP',
  ko: 'ko-KR', pt: 'pt-BR', ru: 'ru-RU', es: 'es-ES',
  tr: 'tr-TR', vi: 'vi-VN', th: 'th-TH'
};

// Voice type labels for display
function getVoiceTypeLabel(name) {
  if (!name) return '';
  if (name.includes('Studio')) return '⭐ Studio';
  if (name.includes('Neural2')) return '🧠 Neural2';
  if (name.includes('Wavenet') || name.includes('WaveNet')) return '🌊 WaveNet';
  if (name.includes('Polyglot')) return '🌐 Polyglot';
  if (name.includes('News')) return '📰 News';
  if (name.includes('Chirp')) return '🐦 Chirp';
  if (name.includes('Journey')) return '🚀 Journey';
  return '📢 Standard';
}

function getGenderIcon(gender) {
  if (gender === 'MALE') return '♂️';
  if (gender === 'FEMALE') return '♀️';
  return '⚪';
}

// =============================================
// Load saved settings
// =============================================
chrome.storage.sync.get([
  'targetLang',
  'ttsSource', 'cloudTtsApiKey', 'cloudTtsVoiceName'
], (data) => {
  if (data.targetLang) {
    document.getElementById('targetLang').value = data.targetLang;
  }

  // TTS settings
  if (data.ttsSource) {
    document.getElementById('ttsSource').value = data.ttsSource;
    toggleCloudTtsSettings(data.ttsSource === 'cloud');
  }
  if (data.cloudTtsApiKey) {
    document.getElementById('cloudTtsApiKey').value = data.cloudTtsApiKey;
    // Auto-load voices if we have key + cloud mode
    if (data.ttsSource === 'cloud') {
      const lang = data.targetLang || 'vi';
      fetchAndPopulateVoices(data.cloudTtsApiKey, lang, data.cloudTtsVoiceName);
    }
  }
});

// =============================================
// TTS Source toggle
// =============================================
function toggleCloudTtsSettings(show) {
  const cloudSettings = document.getElementById('cloudTtsSettings');
  cloudSettings.style.display = show ? 'block' : 'none';
}

document.getElementById('ttsSource').addEventListener('change', (e) => {
  const isCloud = e.target.value === 'cloud';
  toggleCloudTtsSettings(isCloud);
  chrome.storage.sync.set({ ttsSource: e.target.value });

  if (isCloud) {
    const apiKey = document.getElementById('cloudTtsApiKey').value.trim();
    const lang = document.getElementById('targetLang').value;
    if (apiKey) {
      fetchAndPopulateVoices(apiKey, lang);
    }
  }
});

// =============================================
// Save/Remove Cloud TTS API key
// =============================================
document.getElementById('saveCloudTtsKey').addEventListener('click', () => {
  const apiKey = document.getElementById('cloudTtsApiKey').value.trim();

  if (!apiKey) {
    chrome.storage.sync.remove(['cloudTtsApiKey', 'cloudTtsVoiceName'], () => {
      showStatus('Đã xoá Cloud TTS API key.', 'success');
      // Hide voice controls
      document.getElementById('cloudTtsVoice').style.display = 'none';
      document.getElementById('cloudTtsVoiceInfo').style.display = 'none';
      document.getElementById('previewVoice').style.display = 'none';
    });
    return;
  }

  chrome.storage.sync.set({ cloudTtsApiKey: apiKey }, () => {
    showStatus('Đã lưu Cloud TTS API key!', 'success');
    const lang = document.getElementById('targetLang').value;
    fetchAndPopulateVoices(apiKey, lang);
  });
});

// =============================================
// Fetch and populate Cloud TTS voices
// =============================================
async function fetchAndPopulateVoices(apiKey, lang, selectedVoiceName) {
  const voiceSelect = document.getElementById('cloudTtsVoice');
  const voiceInfo = document.getElementById('cloudTtsVoiceInfo');
  const previewBtn = document.getElementById('previewVoice');

  voiceSelect.innerHTML = '<option value="">⏳ Đang tải giọng...</option>';
  voiceSelect.style.display = 'block';
  voiceInfo.style.display = 'none';
  previewBtn.style.display = 'none';

  const bcp47 = LANG_TO_BCP47[lang] || lang;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'fetchCloudTtsVoices',
      apiKey,
      languageCode: bcp47
    });

    if (!response || !response.success) {
      throw new Error(response?.error || 'Không thể tải danh sách giọng');
    }

    const voices = response.voices || [];

    if (voices.length === 0) {
      voiceSelect.innerHTML = '<option value="">Không tìm thấy giọng cho ngôn ngữ này</option>';
      return;
    }

    // Sort voices: Studio > Neural2 > WaveNet > Standard, then by name
    const typeOrder = { Studio: 0, Journey: 1, Neural2: 2, Chirp: 3, Wavenet: 4, WaveNet: 4, News: 5, Polyglot: 6, Standard: 7 };
    const getTypeOrder = (name) => {
      for (const [key, order] of Object.entries(typeOrder)) {
        if ((name || '').includes(key)) return order;
      }
      return 99;
    };

    voices.sort((a, b) => {
      const orderA = getTypeOrder(a.name);
      const orderB = getTypeOrder(b.name);
      if (orderA !== orderB) return orderA - orderB;
      return (a.name || '').localeCompare(b.name || '');
    });

    voiceSelect.innerHTML = '<option value="">-- Chọn giọng đọc --</option>';
    for (const voice of voices) {
      const opt = document.createElement('option');
      opt.value = voice.name;
      const typeLabel = getVoiceTypeLabel(voice.name);
      const genderIcon = getGenderIcon(voice.ssmlGender);
      const langCodes = (voice.languageCodes || []).join(', ');
      opt.textContent = `${typeLabel} ${genderIcon} ${voice.name}`;
      opt.title = `Languages: ${langCodes} | Gender: ${voice.ssmlGender || 'N/A'}`;
      voiceSelect.appendChild(opt);
    }

    // Restore previously selected voice
    if (selectedVoiceName) {
      const exists = Array.from(voiceSelect.options).some(o => o.value === selectedVoiceName);
      if (exists) {
        voiceSelect.value = selectedVoiceName;
        updateVoiceInfo(voices.find(v => v.name === selectedVoiceName));
        previewBtn.style.display = 'block';
      }
    }

  } catch (error) {
    voiceSelect.innerHTML = `<option value="">❌ Lỗi: ${error.message}</option>`;
    console.error('Failed to fetch Cloud TTS voices:', error);
  }
}

function updateVoiceInfo(voice) {
  const voiceInfo = document.getElementById('cloudTtsVoiceInfo');
  if (!voice) {
    voiceInfo.style.display = 'none';
    return;
  }
  const langCodes = (voice.languageCodes || []).join(', ');
  const gender = voice.ssmlGender || 'N/A';
  const rate = voice.naturalSampleRateHertz || 'N/A';
  voiceInfo.textContent = `${getVoiceTypeLabel(voice.name)} | ${gender} | ${langCodes} | ${rate}Hz`;
  voiceInfo.style.display = 'block';
}

// =============================================
// Voice selection change
// =============================================
document.getElementById('cloudTtsVoice').addEventListener('change', (e) => {
  const voiceName = e.target.value;
  chrome.storage.sync.set({ cloudTtsVoiceName: voiceName });

  const previewBtn = document.getElementById('previewVoice');
  previewBtn.style.display = voiceName ? 'block' : 'none';

  // Update voice info
  const voiceInfo = document.getElementById('cloudTtsVoiceInfo');
  if (voiceName) {
    const typeLabel = getVoiceTypeLabel(voiceName);
    voiceInfo.textContent = `${typeLabel} | ${voiceName}`;
    voiceInfo.style.display = 'block';
  } else {
    voiceInfo.style.display = 'none';
  }
});

// =============================================
// Preview voice
// =============================================
document.getElementById('previewVoice').addEventListener('click', async () => {
  const apiKey = document.getElementById('cloudTtsApiKey').value.trim();
  const voiceName = document.getElementById('cloudTtsVoice').value;
  const lang = document.getElementById('targetLang').value;

  if (!apiKey || !voiceName) {
    showStatus('Hãy nhập API key và chọn giọng trước', 'error');
    return;
  }

  const previewBtn = document.getElementById('previewVoice');
  previewBtn.textContent = '⏳ Đang tạo...';
  previewBtn.disabled = true;

  const bcp47 = LANG_TO_BCP47[lang] || lang;

  // Sample text per language
  const sampleTexts = {
    vi: 'Xin chào, đây là giọng đọc thử nghiệm.',
    en: 'Hello, this is a voice preview test.',
    zh: '你好，这是语音预览测试。',
    ja: 'こんにちは、これは音声プレビューテストです。',
    ko: '안녕하세요, 음성 미리보기 테스트입니다.',
    fr: 'Bonjour, ceci est un test de prévisualisation vocale.',
    de: 'Hallo, dies ist ein Sprachvorschau-Test.',
    es: 'Hola, esta es una prueba de vista previa de voz.',
    it: 'Ciao, questo è un test di anteprima vocale.',
    pt: 'Olá, este é um teste de pré-visualização de voz.',
    ru: 'Привет, это тест предварительного прослушивания голоса.',
    ar: 'مرحبا، هذا اختبار معاينة صوتية.',
    hi: 'नमस्ते, यह एक वॉइस प्रीव्यू टेस्ट है।',
    tr: 'Merhaba, bu bir ses önizleme testidir.',
    th: 'สวัสดี นี่คือการทดสอบเสียงตัวอย่าง'
  };

  const text = sampleTexts[lang] || sampleTexts['en'];

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'cloudTtsSynthesize',
      apiKey,
      text,
      voiceName,
      languageCode: bcp47
    });

    if (!response || !response.success) {
      throw new Error(response?.error || 'Synthesize failed');
    }

    // Play audio from base64
    const audioData = response.audioContent;
    const audioBlob = base64ToBlob(audioData, 'audio/mp3');
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    audio.onended = () => URL.revokeObjectURL(audioUrl);
    audio.play();

    showStatus('🔊 Đang phát thử giọng...', 'info');
  } catch (error) {
    showStatus(`Lỗi thử giọng: ${error.message}`, 'error');
  } finally {
    previewBtn.textContent = '🔊 Thử giọng';
    previewBtn.disabled = false;
  }
});

function base64ToBlob(base64, mimeType) {
  const byteChars = atob(base64);
  const byteArrays = [];
  for (let offset = 0; offset < byteChars.length; offset += 512) {
    const slice = byteChars.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    byteArrays.push(new Uint8Array(byteNumbers));
  }
  return new Blob(byteArrays, { type: mimeType });
}

// =============================================
// Start translation
// =============================================
document.getElementById('startTranslation').addEventListener('click', async () => {
  const targetLang = document.getElementById('targetLang').value;

  // Save target language
  chrome.storage.sync.set({ targetLang });

  // Get TTS settings
  const ttsSource = document.getElementById('ttsSource').value;
  const cloudTtsApiKey = document.getElementById('cloudTtsApiKey').value.trim();
  const cloudTtsVoiceName = document.getElementById('cloudTtsVoice').value;
  const bcp47 = LANG_TO_BCP47[targetLang] || targetLang;

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url.includes('youtube.com/watch')) {
    showStatus('Hãy mở một video YouTube trước', 'error');
    return;
  }

  // Send message to content script
  showStatus('Đang bắt đầu dịch...', 'info');

  chrome.tabs.sendMessage(tab.id, {
    action: 'startTranslation',
    targetLang,
    ttsSource,
    cloudTtsApiKey: ttsSource === 'cloud' ? cloudTtsApiKey : '',
    cloudTtsVoiceName: ttsSource === 'cloud' ? cloudTtsVoiceName : '',
    cloudTtsLangCode: ttsSource === 'cloud' ? bcp47 : ''
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

// =============================================
// Save target language on change + refresh voices
// =============================================
document.getElementById('targetLang').addEventListener('change', (e) => {
  chrome.storage.sync.set({ targetLang: e.target.value });

  // Refresh cloud TTS voices for new language
  const ttsSource = document.getElementById('ttsSource').value;
  const apiKey = document.getElementById('cloudTtsApiKey').value.trim();
  if (ttsSource === 'cloud' && apiKey) {
    fetchAndPopulateVoices(apiKey, e.target.value);
  }
});

// =============================================
// Status display
// =============================================
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
