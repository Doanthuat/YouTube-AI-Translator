// State management
const DEBUG = false;
function log(...args) { if (DEBUG) console.log('[YT-Trans]', ...args); }

// Console diagnostics for timedtext extraction (user-requested)
const TIMEDTEXT_DEBUG = true;
function timedtextLog(...args) { if (TIMEDTEXT_DEBUG) console.log('[YT-Trans][timedtext]', ...args); }

function isAutomatedQueriesBlockText(text) {
  const snippet = (text || '').slice(0, 1200);
  return /automated\s+queries/i.test(snippet)
    || /we\s*'?re\s*sorry/i.test(snippet)
    || /To protect our users/i.test(snippet)
    || /sorry\/index/i.test(snippet);
}

function getVideoIdFromTimedtextUrl(url) {
  try {
    const u = new URL(url, location.href);
    return u.searchParams.get('v');
  } catch {
    return null;
  }
}

let currentVideoId = null;
let translatedSegments = [];
let isTranslating = false;
let currentAbortController = null;
let currentTimeUpdateHandler = null;
let currentPlaybackHandlers = {
  play: null,
  pause: null,
  seeking: null,
  seeked: null,
  ratechange: null
};
let isDubbingEnabled = false;
let liveCaptionObserver = null;
let liveCaptionLastText = '';
let isLiveCaptionMode = false;
let currentTargetLang = 'vi';
let prefetchTargetLang = 'vi';

// Cloud TTS state
let ttsSource = 'system'; // 'system' | 'cloud'
let cloudTtsApiKey = '';
let cloudTtsVoiceName = '';
let cloudTtsLangCode = 'vi-VN';
let cloudTtsAudioContext = null;
let isCloudTtsSpeaking = false;
let prefetchedTranscription = {
  videoId: null,
  promise: null,
  segments: null,
  error: null,
  fetchedAt: 0
};

// Trancy-like: player-driven timedtext capture cache
let interceptedTranscription = {
  videoId: null,
  url: null,
  segments: null,
  capturedAt: 0
};

let interceptWaiter = {
  videoId: null,
  resolve: null,
  timer: null
};
let liveCaptionSpeakTimer = null;
let liveCaptionPendingText = '';
let isLiveCaptionSpeaking = false;
let ttsWarnedNoVoiceForLang = '';
const LIVE_CAPTION_QUEUE_MAX = 12;
const liveCaptionQueue = [];
let ttsQueueLastText = '';
// [FIX] Giảm merge window để không gộp quá nhiều câu vào nhau → TTS nhanh hơn
const LIVE_CAPTION_QUEUE_MERGE_MS = 600;
let liveCaptionLastQueuedAt = 0;
// [FIX] Giảm ngưỡng MIN xuống để bắt đầu TTS sớm hơn, không chờ đủ câu dài
const LIVE_CAPTION_MIN_CHARS = 12;
const LIVE_CAPTION_MIN_WORDS = 3;
let liveCaptionLastSpokenText = '';
let liveCaptionLastSpokenAt = 0;
const LIVE_CAPTION_REPEAT_WINDOW_MS = 6000;
let liveCaptionBuffer = '';
let liveCaptionLastAppendedText = '';
let liveCaptionLastAppendedAt = 0;
const LIVE_CAPTION_BUFFER_MAX = 320;
let liveCaptionFlushInterval = null;
// [FIX] Giảm flush interval để drain queue nhanh hơn
const LIVE_CAPTION_FLUSH_INTERVAL_MS = 800;
let liveCaptionCurrentText = '';
let liveCaptionLastChangeAt = 0;
let liveCaptionLastTopLine = '';
let liveCaptionLastLineText = '';
// [FIX] Giảm stable time: không cần đợi 700ms mới đọc, 250ms là đủ
const LIVE_CAPTION_STABLE_MS = 100;
const LIVE_CAPTION_WARMUP_MS = 5000;
let liveCaptionWarmupUntil = 0;
let ttsLastStartAt = 0;
let ttsWatchdogInterval = null;
let ttsCurrentSegEnd = null;
const TTS_WATCHDOG_MS = 1200;
const TTS_STUCK_MS = 10000;
const TTS_RATE_DEFAULT = 1.0;
const TTS_RATE_MIN = 0.8;  // Cho phép đọc chậm nếu segment dài
const TTS_RATE_MAX = 2.2;  // Tăng nhẹ lên 2.2 để có thể bắt kịp nếu bị trễ
const TTS_MS_PER_CHAR = 55; // Ước tính thời gian đọc 1 ký tự ở tốc độ 1.0
const TTS_PITCH = 1.0;
let TTS_VOLUME = 1.0;
let VIDEO_VOLUME = 1.0;
// YouTube timedtext already includes start/end times. Keep lead at 0 to avoid speaking ahead of video time.
const SUBTITLE_LEAD_S = 0;
// Adaptive TTS lead: measures actual speechSynthesis startup latency and adjusts automatically
const TTS_LEAD_INITIAL = 0.8;
const TTS_LEAD_MIN = 0.3;
const TTS_LEAD_MAX = 1.5;
let ttsLatencySamples = [];
const TTS_LATENCY_SAMPLE_MAX = 10;

// [FIX] Quản lý setTimeout-based TTS scheduler cho normal mode
let ttsScheduleTimers = [];

// Language names for display
const langNames = {
  ar: 'Arabic', zh: 'Chinese', en: 'English', fr: 'French',
  de: 'German', hi: 'Hindi', it: 'Italian', ja: 'Japanese',
  ko: 'Korean', pt: 'Portuguese', ru: 'Russian', es: 'Spanish',
  tr: 'Turkish', vi: 'Vietnamese', th: 'Thai'
};

// Extract video ID from URL
function getVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

// Create UI overlay
function createOverlay() {
  const existing = document.getElementById('yt-translator-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'yt-translator-overlay';
  overlay.innerHTML = `
    <div class="yt-trans-header">
      <span class="yt-trans-title"> Trình dịch AI (Lồng tiếng)</span>
      <button class="yt-trans-close">×</button>
    </div>
    <div class="yt-trans-content">
      <div class="yt-trans-status">Sẵn sàng</div>
      <div class="yt-trans-progress-bar">
        <div class="yt-trans-progress-fill"></div>
      </div>
      <div class="yt-trans-controls">
        <button class="yt-trans-btn" id="toggleDubbing"> Bật lồng tiếng</button>
      </div>
      <div class="yt-trans-volume-controls" style="margin-top: 15px; display: flex; flex-direction: column; gap: 8px;">
        <label style="display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: #fff;">
          <span>Âm lượng gốc:</span>
          <input type="range" id="ytTransOriginalVolume" min="0" max="1" step="0.05" value="1.0" style="width: 100px; accent-color: #ff0000;">
        </label>
        <label style="display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: #fff;">
          <span>Âm lượng lồng tiếng:</span>
          <input type="range" id="ytTransDubbingVolume" min="0" max="1" step="0.05" value="1.0" style="width: 100px; accent-color: #ff0000;">
        </label>
      </div>
      <div class="yt-trans-subtitle"></div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Event listeners
  overlay.querySelector('.yt-trans-close').addEventListener('click', () => {
    overlay.style.display = 'none';
  });

  overlay.querySelector('#toggleDubbing').addEventListener('click', toggleDubbing);

  const originalVolInput = overlay.querySelector('#ytTransOriginalVolume');
  const dubbingVolInput = overlay.querySelector('#ytTransDubbingVolume');

  const video = document.querySelector('video');
  if (video) {
    VIDEO_VOLUME = video.volume;
  }
  originalVolInput.value = VIDEO_VOLUME;
  dubbingVolInput.value = TTS_VOLUME;

  originalVolInput.addEventListener('input', (e) => {
    VIDEO_VOLUME = parseFloat(e.target.value);
    const vid = document.querySelector('video');
    if (vid) {
      vid.volume = VIDEO_VOLUME;
    }
  });

  dubbingVolInput.addEventListener('input', (e) => {
    TTS_VOLUME = parseFloat(e.target.value);
  });

  return overlay;
}

// Parse seconds from various formats
function parseSeconds(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;

  const s = String(val).trim();
  if (!s) return 0;

  // Plain number
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const num = parseFloat(s);
    return Number.isFinite(num) ? num : 0;
  }

  // TTML / VTT style times: HH:MM:SS.mmm or MM:SS.mmm
  if (s.includes(':')) {
    const parts = s.split(':').map(p => p.trim());
    let hours = 0;
    let minutes = 0;
    let seconds = 0;
    if (parts.length === 3) {
      hours = parseInt(parts[0], 10) || 0;
      minutes = parseInt(parts[1], 10) || 0;
      seconds = parseFloat(parts[2]) || 0;
    } else if (parts.length === 2) {
      minutes = parseInt(parts[0], 10) || 0;
      seconds = parseFloat(parts[1]) || 0;
    } else {
      seconds = parseFloat(parts[0]) || 0;
    }
    return hours * 3600 + minutes * 60 + seconds;
  }

  // Strip trailing unit if present (e.g. "1.23s")
  const num = parseFloat(s.replace(/s$/i, ''));
  return Number.isFinite(num) ? num : 0;
}

// Parse YouTube JSON3 caption format using word-level timing
// Tận dụng tOffsetMs từng chữ để tạo segment ngắn (~3 giây)
// → TTS đọc đúng nhịp thời gian thực, không phải đọc nhanh vèo
function parseYouTubeJson3(data) {
  const normalize = s => s.replace(/\s+/g, ' ').trim();

  // === Bước 1: Thu thập tất cả từ với timing tuyệt đối ===
  const allWords = [];
  let hasWordTiming = false;

  for (const event of data.events) {
    if (!event.segs) continue;
    const baseMs = event.tStartMs || 0;
    const eventDur = event.dDurationMs || 0;

    for (const seg of event.segs) {
      const rawText = seg.utf8 || '';

      // \n = line break marker
      if (rawText === '\n') {
        if (allWords.length > 0) {
          allWords[allWords.length - 1].lineBreak = true;
        }
        continue;
      }

      if (!rawText.trim()) continue;

      const offsetMs = seg.tOffsetMs || 0;
      if (seg.tOffsetMs != null && seg.tOffsetMs > 0) hasWordTiming = true;

      allWords.push({
        text: rawText,
        startMs: baseMs + offsetMs,
        eventEndMs: baseMs + eventDur,
        lineBreak: false
      });
    }
  }

  // Nếu không có word-level timing → fallback về line-based parsing cũ
  if (!hasWordTiming || allWords.length === 0) {
    return parseYouTubeJson3Legacy(data);
  }

  // === Bước 2: Gom từ thành segment ~3 giây dựa trên timing thực tế ===
  const TARGET_SEGMENT_MS = 3500;  // Mục tiêu ~3.5 giây mỗi segment
  const MAX_SEGMENT_MS = 5000;     // Tối đa 5 giây (flush bắt buộc)
  const PAUSE_THRESHOLD_MS = 600;  // Khoảng nghỉ > 600ms → flush

  const segments = [];
  let groupWords = [];
  let groupStartMs = null;

  const flushGroup = (endMs) => {
    const text = normalize(groupWords.map(w => w.text).join(''));
    if (text && groupStartMs !== null) {
      segments.push({
        text,
        start: groupStartMs / 1000,
        end: (endMs || groupStartMs + 2000) / 1000
      });
    }
    groupWords = [];
    groupStartMs = null;
  };

  for (let i = 0; i < allWords.length; i++) {
    const word = allWords[i];

    if (groupStartMs === null) {
      groupStartMs = word.startMs;
    }
    groupWords.push(word);

    const duration = word.startMs - groupStartMs;
    const isLast = i === allWords.length - 1;
    const nextStartMs = isLast ? null : allWords[i + 1].startMs;
    const gapToNext = nextStartMs !== null ? nextStartMs - word.startMs : 0;

    // Điều kiện flush:
    // 1. Line break (caption sang dòng mới)
    // 2. Đã đủ dài (> TARGET) VÀ có khoảng nghỉ nhỏ phía trước
    // 3. Quá dài (> MAX) → flush bắt buộc
    // 4. Khoảng nghỉ dài giữa các từ (> PAUSE_THRESHOLD)
    // 5. Từ cuối cùng
    const shouldFlush = word.lineBreak
      || (duration >= TARGET_SEGMENT_MS && gapToNext >= 150)
      || duration >= MAX_SEGMENT_MS
      || gapToNext >= PAUSE_THRESHOLD_MS
      || isLast;

    if (shouldFlush) {
      const endMs = nextStartMs || word.eventEndMs || word.startMs + 2000;
      flushGroup(endMs);
    }
  }

  return segments;
}

// Fallback: line-based parsing cũ cho khi không có word-level timing
function parseYouTubeJson3Legacy(data) {
  const sentences = [];
  let lineText = '';
  let lineStart = null;

  const normalize = s => s.replace(/\s+/g, ' ').trim();

  const flushLine = (endMs) => {
    const text = normalize(lineText);
    if (text && lineStart !== null) {
      sentences.push({ text, start: lineStart / 1000, end: endMs / 1000 });
    }
    lineText = '';
    lineStart = null;
  };

  for (const event of data.events) {
    if (!event.segs) continue;
    const text = event.segs.map(s => s.utf8).join('');

    if (text === '\n' || text.trim() === '') {
      flushLine(event.tStartMs);
      continue;
    }

    if (event.aAppend) {
      if (lineStart === null) lineStart = event.tStartMs;
      lineText += text;
    } else {
      const normExisting = normalize(lineText);
      const normNew = normalize(text);

      if (normExisting && normNew.startsWith(normExisting)) {
        lineText = text;
      } else {
        flushLine(event.tStartMs);
        lineStart = event.tStartMs;
        lineText = text;
      }
    }
  }

  if (lineText.trim() && lineStart !== null) {
    flushLine(lineStart + 2000);
  }

  return sentences;
}

// Parse YouTube captions response (JSON3 or XML fallback)
function parseCaptionsResponse(responseText) {
  const stripXssi = (text) => {
    const trimmed = (text || '').trimStart();
    // Common XSSI prefix used by Google services: )]}'\n
    if (trimmed.startsWith(")]}'")) {
      return trimmed.replace(/^\)\]\}'\s*\n?/, '');
    }
    return text;
  };

  const extractFirstJsonObject = (text) => {
    const s = stripXssi(text || '');
    const firstBrace = s.indexOf('{');
    const lastBrace = s.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
    return s.slice(firstBrace, lastBrace + 1);
  };

  const parseVtt = (text) => {
    const lines = (text || '').replace(/\r/g, '').split('\n');
    if (lines.length === 0) return [];
    if (!/^WEBVTT/i.test(lines[0] || '')) return [];

    const parseTime = (t) => {
      // 00:00:01.234 or 00:01.234
      const parts = t.trim().split(':');
      let hours = 0, minutes = 0, seconds = 0;
      if (parts.length === 3) {
        hours = parseInt(parts[0], 10) || 0;
        minutes = parseInt(parts[1], 10) || 0;
        seconds = parseFloat(parts[2]) || 0;
      } else if (parts.length === 2) {
        minutes = parseInt(parts[0], 10) || 0;
        seconds = parseFloat(parts[1]) || 0;
      } else {
        seconds = parseFloat(parts[0]) || 0;
      }
      return hours * 3600 + minutes * 60 + seconds;
    };

    const segments = [];
    let i = 0;
    while (i < lines.length) {
      const line = (lines[i] || '').trim();
      if (!line) {
        i++;
        continue;
      }
      // Optional cue identifier line
      let timeLine = line;
      if (!line.includes('-->') && i + 1 < lines.length && (lines[i + 1] || '').includes('-->')) {
        timeLine = (lines[i + 1] || '').trim();
        i++;
      }

      if (!timeLine.includes('-->')) {
        i++;
        continue;
      }

      const [startRaw, endRaw] = timeLine.split('-->').map(s => s.trim());
      const start = parseTime(startRaw);
      const end = parseTime((endRaw || '').split(' ')[0]);
      i++;

      const textLines = [];
      while (i < lines.length && (lines[i] || '').trim() !== '') {
        const t = (lines[i] || '').trim();
        if (t) textLines.push(t);
        i++;
      }

      const cueText = textLines.join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (cueText) segments.push({ text: cueText, start, end });
    }

    return segments;
  };

  try {
    // Try parsing as JSON first (json3 format)
    const jsonCandidate = stripXssi(responseText);
    const data = JSON.parse(jsonCandidate);
    if (data.events) {
      if (typeof timedtextLog === 'function') timedtextLog('Parsed captions as JSON3');
      return parseYouTubeJson3(data);
    }
    return [];
  } catch (e) {
    // Retry with extracted JSON object (handles wrappers / junk before/after)
    try {
      const extracted = extractFirstJsonObject(responseText);
      if (extracted) {
        const data2 = JSON.parse(extracted);
        if (data2?.events) {
          if (typeof timedtextLog === 'function') timedtextLog('Parsed captions as JSON3 (extracted)');
          return parseYouTubeJson3(data2);
        }
      }
    } catch {
      // ignore
    }

    // WEBVTT fallback
    const vttSegments = parseVtt(responseText);
    if (vttSegments.length > 0) {
      if (typeof timedtextLog === 'function') timedtextLog('Parsed captions as WEBVTT');
      return vttSegments;
    }

    // Fallback to XML parsing (srv1 or srv3 format)
    const looksLikeXml = /^\s*</.test(responseText || '');
    if (!looksLikeXml) {
      // Not JSON, not XML (or JSON with unexpected wrapper)
      return [];
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(responseText, 'text/xml');

    // srv1 uses <text>, srv3 uses <p>, TTML can be namespaced (e.g., tt:p)
    const collectByLocalName = (localName) => {
      const list = [];
      try {
        // Namespaced elements
        list.push(...Array.from(doc.getElementsByTagNameNS('*', localName)));
      } catch {
        // ignore
      }
      try {
        // Non-namespaced / qualified name
        list.push(...Array.from(doc.getElementsByTagName(localName)));
      } catch {
        // ignore
      }
      return list;
    };

    const textNodes = collectByLocalName('text');
    const pNodes = collectByLocalName('p');

    const seen = new Set();
    const textElements = [...textNodes, ...pNodes].filter((node) => {
      if (!node) return false;
      if (seen.has(node)) return false;
      seen.add(node);
      return true;
    });

    const segments = [];
    textElements.forEach((el, index) => {
      const startAttr = el.getAttribute('start') || el.getAttribute('t') || el.getAttribute('begin');
      const durAttr = el.getAttribute('dur') || el.getAttribute('d');
      const endAttr = el.getAttribute('end');

      const start = parseSeconds(startAttr);
      const dur = parseSeconds(durAttr);
      const end = endAttr
        ? parseSeconds(endAttr)
        : (dur > 0
          ? start + dur
          : (index < textElements.length - 1
            ? parseSeconds(textElements[index + 1].getAttribute('start') || textElements[index + 1].getAttribute('t') || textElements[index + 1].getAttribute('begin'))
            : start + 5));

      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = el.textContent;
      const text = tempDiv.textContent.replace(/\n/g, ' ').trim();

      if (text) {
        segments.push({ text, start, end });
      }
    });

    if (segments.length === 0 && typeof timedtextLog === 'function') {
      const snippet = (responseText || '').slice(0, 200).replace(/\s+/g, ' ');
      timedtextLog('XML parsed but produced 0 segments', {
        nodes: textElements.length,
        snippet
      });
    }
    return segments;
  }
}

function waitForInterceptedTranscript(videoId, timeoutMs = 8000) {
  if (!videoId) return Promise.resolve(null);
  if (interceptedTranscription.videoId === videoId && Array.isArray(interceptedTranscription.segments) && interceptedTranscription.segments.length > 0) {
    return Promise.resolve({
      segments: interceptedTranscription.segments,
      url: interceptedTranscription.url
    });
  }

  if (interceptWaiter.timer) {
    clearTimeout(interceptWaiter.timer);
  }

  return new Promise((resolve) => {
    interceptWaiter = {
      videoId,
      resolve,
      timer: setTimeout(() => {
        interceptWaiter = { videoId: null, resolve: null, timer: null };
        resolve(null);
      }, timeoutMs)
    };
  });
}

// Receive timedtext responses captured in MAIN world (inject.js)
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.type !== 'YT_TRANS_TIMEDTEXT_CAPTURE') return;

  const url = data.url || '';
  const bodyText = data.bodyText || '';
  if (!url || !bodyText) return;
  if (!url.includes('timedtext')) return;

  if (isAutomatedQueriesBlockText(bodyText)) {
    timedtextLog('Intercepted timedtext was blocked (automated queries)');
    return;
  }

  const videoId = getVideoIdFromTimedtextUrl(url) || getVideoId();
  const segments = parseCaptionsResponse(bodyText) || [];
  timedtextLog('Intercepted timedtext', { videoId, segments: segments.length });

  if (!videoId || segments.length === 0) return;

  interceptedTranscription = {
    videoId,
    url,
    segments,
    capturedAt: data.capturedAt || Date.now()
  };

  if (interceptWaiter.videoId === videoId && typeof interceptWaiter.resolve === 'function') {
    if (interceptWaiter.timer) clearTimeout(interceptWaiter.timer);
    const resolve = interceptWaiter.resolve;
    interceptWaiter = { videoId: null, resolve: null, timer: null };
    resolve({ segments, url });
  }
});

async function fetchTranscriptionFromTextTracks(targetLang) {
  const video = document.querySelector('video');
  if (!video) {
    throw new Error('Video element not found');
  }

  const waitForTracks = async () => {
    const maxWaitMs = 5000;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (video.textTracks && video.textTracks.length > 0) return true;
      await sleep(200);
    }
    return false;
  };

  const tracksReady = await waitForTracks();
  if (!tracksReady) {
    throw new Error('No text tracks available');
  }

  const tracks = Array.from(video.textTracks || []);
  const normalizedTarget = (targetLang || '').toLowerCase();

  const pickTrack = () => {
    const candidates = tracks.filter(track => track.kind === 'captions' || track.kind === 'subtitles');
    const byLang = candidates.find(track => (track.language || '').toLowerCase().startsWith(normalizedTarget));
    if (byLang) return byLang;
    const anyCaption = candidates[0] || tracks[0];
    return anyCaption || null;
  };

  const track = pickTrack();
  if (!track) {
    throw new Error('No usable text track found');
  }

  track.mode = 'hidden';

  const waitForCues = async () => {
    const maxWaitMs = 6000;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (track.cues && track.cues.length > 0) return true;
      await sleep(200);
    }
    return false;
  };

  const cuesReady = await waitForCues();
  if (!cuesReady) {
    throw new Error('Text track cues not available');
  }

  const segments = Array.from(track.cues).map(cue => ({
    text: (cue.text || '').replace(/\n/g, ' ').trim(),
    start: cue.startTime,
    end: cue.endTime
  })).filter(segment => segment.text);

  if (segments.length === 0) {
    throw new Error('Text track cues were empty');
  }

  return segments;
}

function parseCaptionsList(responseText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(responseText, 'text/xml');
  const tracks = [];
  doc.querySelectorAll('track').forEach(track => {
    tracks.push({
      lang: track.getAttribute('lang_code') || '',
      name: track.getAttribute('name') || '',
      kind: track.getAttribute('kind') || ''
    });
  });
  return tracks;
}

function extractJsonArrayAfterKey(haystack, key) {
  const keyIndex = haystack.indexOf(key);
  if (keyIndex === -1) return null;

  const startBracket = haystack.indexOf('[', keyIndex + key.length);
  if (startBracket === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startBracket; i < haystack.length; i++) {
    const ch = haystack[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) {
        return haystack.slice(startBracket, i + 1);
      }
    }
  }

  return null;
}

function normalizeTimedtextBaseUrl(url) {
  if (!url) return null;
  let result = url;
  // Sometimes baseUrl contains literal "\\u0026" sequences.
  result = result.replace(/\\u0026/g, '&');
  // Remove any existing fmt param to avoid duplication.
  result = result.replace(/([?&])fmt=[^&]+&?/, '$1').replace(/[?&]$/, '');
  return result;
}

async function extractTimedtextUrlFromWatchHtml() {
  try {
    timedtextLog('Extracting captionTracks from watch HTML...');
    const html = await fetch(location.href, { signal: currentAbortController?.signal }).then(r => r.text());
    const arrayText = extractJsonArrayAfterKey(html, '"captionTracks":');
    if (!arrayText) {
      timedtextLog('captionTracks not found in HTML');
      return null;
    }

    // Some variants embed an escaped JSON string; attempt both.
    let tracks = null;
    try {
      tracks = JSON.parse(arrayText);
    } catch {
      tracks = JSON.parse(arrayText.replace(/\\"/g, '"'));
    }

    if (!Array.isArray(tracks) || tracks.length === 0) return null;

    const preferred = tracks.find(t => (t?.kind || '') !== 'asr') || tracks[0];
    const baseUrl = preferred?.baseUrl || null;
    const normalized = normalizeTimedtextBaseUrl(baseUrl);
    timedtextLog('captionTracks found:', tracks.length, 'preferred.kind=', preferred?.kind || '', 'lang=', preferred?.languageCode || preferred?.vssId || preferred?.lang_code || '');
    timedtextLog('Timedtext baseUrl:', normalized);
    if (normalized) timedtextLog('JSON3 URL:', `${normalized}${normalized.includes('?') ? '&' : '?'}fmt=json3`);
    return normalized;
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    timedtextLog('HTML captionTracks extraction failed:', error?.message || error);
    return null;
  }
}

// Fetch transcription from YouTube
async function fetchTranscription(videoId, targetLang) {
  updateStatus('Đang lấy link phụ đề...', 5);

  let captionsUrl = null;

  timedtextLog('fetchTranscription()', { videoId, targetLang });

  try {
    // Extract captions URL via the main world script
    captionsUrl = await new Promise((resolve) => {
      // Set a timeout in case the main world script doesn't respond
      const timeoutId = setTimeout(() => {
        window.removeEventListener('message', messageHandler);
        resolve(null);
      }, 3000);

      const messageHandler = (event) => {
        // Ensure message comes from our injected script
        if (event.source === window && event.data && event.data.type === 'CAPTIONS_URL_RESPONSE') {
          clearTimeout(timeoutId);
          window.removeEventListener('message', messageHandler);
          resolve(event.data.url);
        }
      };

      window.addEventListener('message', messageHandler);

      // Request captions URL from inject.js
      window.postMessage({ type: 'GET_CAPTIONS_URL' }, '*');
    });

    if (captionsUrl) {
      log('Successfully extracted captions URL from YouTube internal variables');
      captionsUrl = normalizeTimedtextBaseUrl(captionsUrl);
      timedtextLog('Captions URL via inject.js:', captionsUrl);
    }
  } catch (e) {
    log('Failed to extract captions via MAIN world script', e);
    timedtextLog('Inject.js captions extraction failed');
  }

  if (!captionsUrl) {
    captionsUrl = await extractTimedtextUrlFromWatchHtml();
    if (captionsUrl) {
      log('Successfully extracted captions URL from watch HTML');
      timedtextLog('Captions URL via watch HTML:', captionsUrl);
    }
  }

  if (!captionsUrl) {
    try {
      const bgResponse = await chrome.runtime.sendMessage({
        action: 'getCaptionsUrl',
        videoId
      });
      if (bgResponse?.success && bgResponse.captionsUrl) {
        captionsUrl = normalizeTimedtextBaseUrl(bgResponse.captionsUrl);
        timedtextLog('Captions URL via background:', captionsUrl);
      }
    } catch (bgError) {
      if (bgError.name === 'AbortError') throw bgError;
      timedtextLog('Background captionsUrl failed:', bgError?.message || bgError);
    }
  }

  if (!captionsUrl) {
    throw new Error('No captions/subtitles available for this video. The video may not have subtitles enabled.');
  }

  if (!captionsUrl.startsWith('http')) {
    if (captionsUrl.startsWith('//')) {
      captionsUrl = 'https:' + captionsUrl;
    } else if (captionsUrl.startsWith('/')) {
      captionsUrl = 'https://www.youtube.com' + captionsUrl;
    }
  }

  // Fetch the timedtext using multiple formats in case the default is empty
  updateStatus('Đang tải phụ đề...', 10);

  const isAutomatedQueriesBlock = (text) => {
    const snippet = (text || '').slice(0, 1200);
    return /automated\s+queries/i.test(snippet)
      || /we\s*'?re\s*sorry/i.test(snippet)
      || /sorry\/index/i.test(snippet)
      || /To protect our users/i.test(snippet);
  };

  const ensureNotBlocked = (responseText) => {
    if (isAutomatedQueriesBlock(responseText)) {
      const err = new Error('YouTube blocked the request (automated queries). Try slowing requests, disabling VPN/proxy, and avoid repeated reloads.');
      err.name = 'AutomatedQueriesBlocked';
      throw err;
    }
  };

  const buildUrlWithFmt = (baseUrl, fmt) => {
    try {
      const urlObj = new URL(baseUrl);
      urlObj.searchParams.set('fmt', fmt);
      return urlObj.toString();
    } catch {
      const hasFmt = /[?&]fmt=/.test(baseUrl);
      if (hasFmt) return baseUrl.replace(/([?&]fmt=)[^&]+/, `$1${fmt}`);
      const joiner = baseUrl.includes('?') ? '&' : '?';
      return `${baseUrl}${joiner}fmt=${fmt}`;
    }
  };

  const buildUrlWithTlang = (baseUrl, tlang) => {
    if (!tlang) return baseUrl;
    try {
      const urlObj = new URL(baseUrl);
      urlObj.searchParams.set('tlang', tlang);
      return urlObj.toString();
    } catch {
      const hasTlang = /[?&]tlang=/.test(baseUrl);
      if (hasTlang) return baseUrl.replace(/([?&]tlang=)[^&]+/, `$1${tlang}`);
      const joiner = baseUrl.includes('?') ? '&' : '?';
      return `${baseUrl}${joiner}tlang=${tlang}`;
    }
  };

  const baseCandidates = [
    buildUrlWithFmt(captionsUrl, 'srv1'),
    buildUrlWithFmt(captionsUrl, 'srv3'),
    buildUrlWithFmt(captionsUrl, 'json3'),
    captionsUrl
  ];

  const candidateUrls = [
    ...baseCandidates,
    ...baseCandidates.map(url => buildUrlWithTlang(url, targetLang))
  ].filter((value, index, self) => self.indexOf(value) === index);

  const tryFetchCaptions = async (url, useBackground = false) => {
    if (!useBackground) {
      const response = await fetch(url, { signal: currentAbortController?.signal });

      if (!response.ok) {
        throw new Error(`Failed to fetch captions: ${response.status}`);
      }

      const responseText = await response.text();
      ensureNotBlocked(responseText);
      const segments = parseCaptionsResponse(responseText);
      return { segments, raw: responseText };
    }

    const bgResponse = await chrome.runtime.sendMessage({
      action: 'fetchCaptionsXml',
      url
    });

    if (!bgResponse) {
      throw new Error('Background script did not respond. Please reload the extension.');
    }

    if (!bgResponse.success) {
      throw new Error(bgResponse.error || 'Unknown background fetch error');
    }

    const raw = bgResponse.xml || '';
    ensureNotBlocked(raw);
    const segments = parseCaptionsResponse(raw);
    return { segments, raw };
  };

  let lastError = null;
  for (const url of candidateUrls) {
    try {
      const directResult = await tryFetchCaptions(url, false);
      if (directResult.segments.length > 0) {
        log(`Fetched ${directResult.segments.length} caption segments`);
        timedtextLog('Fetched segments (direct):', directResult.segments.length, 'from', url);
        return directResult.segments;
      }
      const snippet = (directResult.raw || '').substring(0, 120).replace(/\n/g, ' ');
      lastError = new Error(`Captions file was empty. Response snippet: ${snippet}`);
      timedtextLog('Empty captions (direct):', url, snippet);
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      if (error.name === 'AutomatedQueriesBlocked') {
        timedtextLog('Blocked by automated queries page; stopping retries.');
        throw error;
      }
      lastError = error;
      timedtextLog('Fetch captions failed (direct):', url, error?.message || error);

      // Only try background fetch on network/CORS-like errors (avoid double-hitting YouTube)
      const isNetworkError = error?.name === 'TypeError' || /fetch/i.test(String(error?.message || ''));
      if (!isNetworkError) continue;

      try {
        const bgResult = await tryFetchCaptions(url, true);
        if (bgResult.segments.length > 0) {
          log(`Fetched ${bgResult.segments.length} caption segments via background`);
          timedtextLog('Fetched segments (bg):', bgResult.segments.length, 'from', url);
          return bgResult.segments;
        }
        const snippet = (bgResult.raw || '').substring(0, 120).replace(/\n/g, ' ');
        lastError = new Error(`Captions file was empty. Response snippet: ${snippet}`);
        timedtextLog('Empty captions (bg):', url, snippet);
      } catch (bgError) {
        if (bgError.name === 'AbortError') throw bgError;
        if (bgError.name === 'AutomatedQueriesBlocked') {
          timedtextLog('Blocked by automated queries page (bg); stopping retries.');
          throw bgError;
        }
        lastError = bgError;
        timedtextLog('Fetch captions failed (bg):', url, bgError?.message || bgError);
      }
    }
  }

  // Fallback: request caption track list and build timedtext URLs
  try {
    const listResponse = await chrome.runtime.sendMessage({
      action: 'fetchCaptionsList',
      videoId
    });

    if (listResponse?.success) {
      const tracks = parseCaptionsList(listResponse.xml || '');
      if (tracks.length > 0) {
        const preferred = [
          ...tracks.filter(t => t.kind !== 'asr'),
          ...tracks.filter(t => t.kind === 'asr')
        ];

        const buildTimedtextUrl = (track, fmt, tlang) => {
          const urlObj = new URL('https://video.google.com/timedtext');
          urlObj.searchParams.set('v', videoId);
          if (track.lang) urlObj.searchParams.set('lang', track.lang);
          if (track.name) urlObj.searchParams.set('name', track.name);
          if (track.kind) urlObj.searchParams.set('kind', track.kind);
          if (fmt) urlObj.searchParams.set('fmt', fmt);
          if (tlang) urlObj.searchParams.set('tlang', tlang);
          return urlObj.toString();
        };

        for (const track of preferred) {
          // [FIX] Ưu tiên lấy bản dịch sẵn (tlang) của YouTube trước để đồng bộ 100% với phụ đề trên màn hình
          const trackUrls = [
            buildTimedtextUrl(track, 'json3', targetLang),
            buildTimedtextUrl(track, 'json3'),
            buildTimedtextUrl(track, 'srv3', targetLang),
            buildTimedtextUrl(track, 'srv3'),
            buildTimedtextUrl(track, 'srv1', targetLang),
            buildTimedtextUrl(track, 'srv1')
          ];

          for (const url of trackUrls) {
            try {
              const directResult = await tryFetchCaptions(url, false);
              if (directResult.segments.length > 0) {
                log(`Fetched ${directResult.segments.length} caption segments via track list (url: ${url})`);
                return { segments: directResult.segments, url };
              }
              const snippet = (directResult.raw || '').substring(0, 100).replace(/\n/g, ' ');
              lastError = new Error(`Captions file was empty. Response snippet: ${snippet}`);
            } catch (error) {
              if (error.name === 'AbortError') throw error;
              lastError = error;
            }

            try {
              const bgResult = await tryFetchCaptions(url, true);
              if (bgResult.segments.length > 0) {
                log(`Fetched ${bgResult.segments.length} caption segments via background track list (url: ${url})`);
                return { segments: bgResult.segments, url };
              }
              const snippet = (bgResult.raw || '').substring(0, 100).replace(/\n/g, ' ');
              lastError = new Error(`Captions file was empty. Response snippet: ${snippet}`);
            } catch (bgError) {
              if (bgError.name === 'AbortError') throw bgError;
              lastError = bgError;
            }
          }
        }
      } else {
        lastError = new Error('No caption tracks found in timedtext list');
      }
    } else if (listResponse?.error) {
      lastError = new Error(listResponse.error);
    }
  } catch (listError) {
    if (listError.name === 'AbortError') throw listError;
    lastError = listError;
  }

  throw new Error(`Unable to fetch captions. ${lastError ? lastError.message : 'No data received.'}`);
}

function prefetchTimedtextForVideo(videoId) {
  if (!videoId) return;
  if (prefetchedTranscription.videoId === videoId && (prefetchedTranscription.promise || prefetchedTranscription.segments)) {
    return;
  }

  timedtextLog('Prefetch start', { videoId, prefetchTargetLang });

  prefetchedTranscription = {
    videoId,
    promise: null,
    segments: null,
    error: null,
    fetchedAt: Date.now()
  };

  prefetchedTranscription.promise = (async () => {
    try {
      // Prefer player-driven timedtext capture (Trancy-like)
      const intercepted = await waitForInterceptedTranscript(videoId, 8000);
      if (intercepted && intercepted.segments?.length > 0) {
        prefetchedTranscription.segments = intercepted.segments;
        prefetchedTranscription.url = intercepted.url;
        timedtextLog('Prefetch success (intercepted)', { videoId, segments: intercepted.segments.length });
        return intercepted;
      }

      // Do not proactively fetch timedtext on load (reduces automated-queries blocks).
      timedtextLog('Prefetch: no intercepted transcript yet (waiting for player request)');
      return [];
    } catch (error) {
      prefetchedTranscription.error = error;
      timedtextLog('Prefetch failed', { videoId, error: error?.message || error });
      throw error;
    }
  })();
}

function initTimedtextPrefetch() {
  try {
    chrome.storage.sync.get(['targetLang'], (data) => {
      if (data?.targetLang) {
        prefetchTargetLang = data.targetLang;
      }
      const videoId = getVideoId();
      if (videoId) prefetchTimedtextForVideo(videoId);
    });
  } catch {
    const videoId = getVideoId();
    if (videoId) prefetchTimedtextForVideo(videoId);
  }

  const handleMaybeNewVideo = () => {
    const videoId = getVideoId();
    if (!videoId) return;
    prefetchTimedtextForVideo(videoId);
  };

  window.addEventListener('yt-navigate-finish', handleMaybeNewVideo);
  window.addEventListener('popstate', handleMaybeNewVideo);

  // Fallback for cases where YT doesn't emit events to content scripts
  let lastVideoId = getVideoId();
  setInterval(() => {
    const current = getVideoId();
    if (current && current !== lastVideoId) {
      lastVideoId = current;
      handleMaybeNewVideo();
    }
  }, 1000);
}


// Sleep function for delays
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Map helper with limited concurrency
async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;

  const workers = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (true) {
      const currentIndex = index++;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

// Free translation using public Google Translate endpoint
async function translateTextFree(text, targetLang) {
  const maxRetries = 2;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const params = new URLSearchParams({
        client: 'gtx',
        sl: 'auto',
        tl: targetLang,
        dt: 't',
        q: text
      });

      const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`, {
        signal: currentAbortController?.signal
      });

      if (!response.ok) {
        throw new Error(`Free translate failed: ${response.status}`);
      }

      const data = await response.json();
      if (!Array.isArray(data) || !Array.isArray(data[0])) {
        throw new Error('Unexpected free translate response');
      }

      const translated = data[0].map(part => part[0]).join('');
      return translated || text;

    } catch (error) {
      if (error.name === 'AbortError') throw error;

      const isNetworkError = error.name === 'TypeError' || error.message.includes('fetch');
      if (isNetworkError) {
        try {
          const bgResponse = await chrome.runtime.sendMessage({
            action: 'freeTranslate',
            text,
            targetLang
          });

          if (bgResponse?.success && Array.isArray(bgResponse.data?.[0])) {
            const translated = bgResponse.data[0].map(part => part[0]).join('');
            return translated || text;
          }
        } catch (bgError) {
          if (bgError.name === 'AbortError') throw bgError;
        }
      }

      if (attempt >= maxRetries) throw error;
      await sleep(800);
      attempt++;
    }
  }

  return text;
}

// Translate a chunk using free endpoint
async function translateChunkFree(segments, targetLang, chunkNum = 1, totalChunks = 1) {
  if (totalChunks > 1) {
    updateStatus(`Đang dịch phần ${chunkNum}/${totalChunks} (${segments.length} câu)...`, 30 + (chunkNum / totalChunks) * 60);
  }

  const translated = await mapWithConcurrency(segments, 3, async (segment) => {
    const translatedText = await translateTextFree(segment.text, targetLang);
    return {
      ...segment,
      originalText: segment.text,
      translatedText: translatedText || segment.text
    };
  });

  return translated;
}

// Translate all segments using free Google Translate
async function translateAllSegments(segments, targetLang, onChunkTranslated) {
  updateStatus('Đang dịch...', 15);

  const MAX_SEGMENTS_PER_CHUNK = 15;

  if (segments.length <= MAX_SEGMENTS_PER_CHUNK) {
    const translated = await translateChunkFree(segments, targetLang, 0, 1);
    if (typeof onChunkTranslated === 'function') {
      try { onChunkTranslated(translated, 1, 1); } catch { /* ignore */ }
    }
    return translated;
  } else {
    const chunks = [];
    for (let i = 0; i < segments.length; i += MAX_SEGMENTS_PER_CHUNK) {
      chunks.push(segments.slice(i, i + MAX_SEGMENTS_PER_CHUNK));
    }

    console.log(`Processing ${segments.length} segments in ${chunks.length} chunks`);

    let allTranslatedSegments = [];
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      const translatedChunk = await translateChunkFree(chunk, targetLang, chunkIndex + 1, chunks.length);
      allTranslatedSegments.push(...translatedChunk);

      if (typeof onChunkTranslated === 'function') {
        try { onChunkTranslated(translatedChunk, chunkIndex + 1, chunks.length); } catch { /* ignore */ }
      }

      if (chunkIndex < chunks.length - 1) {
        await sleep(500);
      }
    }
    return allTranslatedSegments;
  }
}




// Update UI status
function updateStatus(message, progress = null) {
  const overlay = document.getElementById('yt-translator-overlay');
  if (!overlay) return;

  const statusEl = overlay.querySelector('.yt-trans-status');
  const progressFill = overlay.querySelector('.yt-trans-progress-fill');

  statusEl.textContent = message;

  if (progress !== null) {
    progressFill.style.width = `${progress}%`;
  }
}

// Show subtitle with dynamic timing
let subtitleTimeout = null;

function showSubtitle(text) {
  const overlay = document.getElementById('yt-translator-overlay');
  if (!overlay) return;

  const subtitleEl = overlay.querySelector('.yt-trans-subtitle');
  subtitleEl.textContent = text;
  subtitleEl.style.display = 'block';

  // Clear any existing timeout
  if (subtitleTimeout) {
    clearTimeout(subtitleTimeout);
  }

  // Hide subtitle after reading time (minimum 3 seconds, maximum 8 seconds)
  const readingTime = Math.max(3000, Math.min(text.length * 50, 8000));
  subtitleTimeout = setTimeout(() => {
    subtitleEl.style.display = 'none';
  }, readingTime);
}

function pickVoiceForLang(langCode) {
  const voices = speechSynthesis.getVoices ? speechSynthesis.getVoices() : [];
  if (!voices || voices.length === 0) return null;

  const normalized = (langCode || '').toLowerCase();
  const scored = voices
    .map((voice) => {
      const voiceLang = (voice.lang || '').toLowerCase();
      const voiceName = (voice.name || '').toLowerCase();
      let score = 0;

      if (voiceLang === normalized) score += 100;
      else if (voiceLang.startsWith(normalized)) score += 80;

      if (/natural|neural|google|microsoft|online/i.test(voice.name || '')) score += 20;
      if (/female|woman|girl|zira|susan|aria|jenny|sara|tessa|mira|tien|vi/i.test(voiceName)) score += 5;

      return { voice, score };
    })
    .sort((a, b) => b.score - a.score);

  const exact = scored.find(entry => (entry.voice.lang || '').toLowerCase() === normalized)?.voice;
  if (exact) return exact;

  const partial = scored.find(entry => (entry.voice.lang || '').toLowerCase().startsWith(normalized))?.voice;
  return partial || voices[0] || null;
}

// =============================================
// Cloud TTS synthesis via background proxy
// =============================================
async function fetchCloudTtsAudio(text, segStart, segEnd) {
  if (!cloudTtsApiKey || !cloudTtsVoiceName) {
    return null;
  }

  let speakingRate = 1.0;
  if (segStart != null && segEnd != null && segEnd > segStart) {
    const segDuration = segEnd - segStart;
    const estimatedDuration = (text || '').length * TTS_MS_PER_CHAR / 1000;
    speakingRate = estimatedDuration / segDuration;
    // Không đọc chậm hơn tốc độ bình thường (1.0), chỉ tăng tốc nếu cần
    speakingRate = Math.max(1.0, Math.min(2.0, speakingRate));
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'cloudTtsSynthesize',
      apiKey: cloudTtsApiKey,
      text: text,
      voiceName: cloudTtsVoiceName,
      languageCode: cloudTtsLangCode,
      speakingRate: speakingRate
    });

    if (!response || !response.success || !response.audioContent) {
      log('[CloudTTS] Synthesis failed:', response?.error);
      return null;
    }

    const audioData = atob(response.audioContent);
    const audioArray = new Uint8Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
      audioArray[i] = audioData.charCodeAt(i);
    }

    if (!cloudTtsAudioContext || cloudTtsAudioContext.state === 'closed') {
      cloudTtsAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (cloudTtsAudioContext.state === 'suspended') {
      await cloudTtsAudioContext.resume();
    }

    const audioBuffer = await cloudTtsAudioContext.decodeAudioData(audioArray.buffer.slice(0));
    return audioBuffer;
  } catch (error) {
    log('[CloudTTS] Error fetching audio:', error);
    return null;
  }
}

function playCloudTtsAudio(audioBuffer) {
  if (!audioBuffer || !cloudTtsAudioContext) return Promise.resolve(false);

  try {
    const source = cloudTtsAudioContext.createBufferSource();
    source.buffer = audioBuffer;

    const gainNode = cloudTtsAudioContext.createGain();
    gainNode.gain.value = TTS_VOLUME;
    source.connect(gainNode);
    gainNode.connect(cloudTtsAudioContext.destination);

    return new Promise((resolve) => {
      source.onended = () => {
        resolve(true);
      };
      source.start(0);

      const maxDuration = audioBuffer.duration * 1000 + 1500;
      setTimeout(() => {
        try { source.stop(); } catch { }
        resolve(true);
      }, maxDuration);
    });
  } catch (error) {
    log('[CloudTTS] Error playing audio:', error);
    return Promise.resolve(false);
  }
}

function normalizeTtsText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function computeTtsRate(text, segStart, segEnd) {
  if (segStart == null || segEnd == null || segEnd <= segStart) {
    return TTS_RATE_DEFAULT;
  }

  const segDuration = segEnd - segStart;
  const estimatedDuration = (text || '').length * TTS_MS_PER_CHAR / 1000;

  // Tính tỷ lệ cần thiết
  let rawRate = estimatedDuration / segDuration;

  let rate = rawRate;
  if (rate < 1.0) rate = 1.0;

  return Math.max(TTS_RATE_MIN, Math.min(TTS_RATE_MAX, rate));
}

function getAdaptiveTtsLead() {
  if (ttsLatencySamples.length === 0) return TTS_LEAD_INITIAL;
  const avg = ttsLatencySamples.reduce((a, b) => a + b, 0) / ttsLatencySamples.length;
  // Add 20% buffer on top of measured average latency
  const leadS = (avg * 1.2) / 1000;
  return Math.max(TTS_LEAD_MIN, Math.min(TTS_LEAD_MAX, leadS));
}

function shouldDropTtsText(normalizedText, now = Date.now()) {
  const t = normalizeTtsText(normalizedText);
  if (!t) return true;

  const lastSpoken = normalizeTtsText(liveCaptionLastSpokenText);
  if (lastSpoken && now - liveCaptionLastSpokenAt < LIVE_CAPTION_REPEAT_WINDOW_MS) {
    if (t === lastSpoken) return true;
    if (t.includes(lastSpoken)) return true;
    if (lastSpoken.includes(t)) return true;
  }

  if (t === ttsQueueLastText) return true;
  if (liveCaptionQueue.some(item => item.text === t)) return true;

  return false;
}

function ttsSpeakNext() {
  if (!isDubbingEnabled) return;
  startTtsWatchdog();

  const video = document.querySelector('video');
  if (video && (video.paused || video.seeking)) {
    return;
  }

  // Cloud TTS path
  if (ttsSource === 'cloud' && cloudTtsApiKey && cloudTtsVoiceName) {
    if (isCloudTtsSpeaking || isLiveCaptionSpeaking) return;

    const nextItem = liveCaptionQueue.shift();
    if (!nextItem) return;
    const nextText = nextItem.text;



    isLiveCaptionSpeaking = true;
    isCloudTtsSpeaking = true;
    ttsCurrentSegEnd = nextItem.segEnd;
    ttsLastStartAt = Date.now();

    // If using ttsSpeakNext (DOM observer fallback), just fetch and play sequentially
    // (scheduleTtsFromSegments uses prefetching instead)
    const audioPromise = nextItem.audioBufferPromise || fetchCloudTtsAudio(nextText, nextItem.segStart, nextItem.segEnd);
    audioPromise
      .then((audioBuffer) => {
        if (!audioBuffer) {
          console.warn('[CloudTTS] Audio fetch failed. Skipping segment to prevent jarring voice change.');
          // systemTtsSpeakItem(nextItem); // Vô hiệu hoá fallback để tránh lọt giọng mặc định
          return;
        }
        return playCloudTtsAudio(audioBuffer);
      })
      .then((success) => {
        if (success !== undefined) {
          isCloudTtsSpeaking = false;
          isLiveCaptionSpeaking = false;
          ttsCurrentSegEnd = null;
          liveCaptionLastSpokenText = nextText;
          liveCaptionLastSpokenAt = Date.now();
          ttsSpeakNext();
        }
      })
      .catch(() => {
        isCloudTtsSpeaking = false;
        isLiveCaptionSpeaking = false;
        ttsCurrentSegEnd = null;
        liveCaptionLastSpokenText = nextText;
        liveCaptionLastSpokenAt = Date.now();
        ttsSpeakNext();
      });
    return;
  }

  // System TTS path (original behavior)
  if (!('speechSynthesis' in window)) return;

  if (speechSynthesis.paused) {
    speechSynthesis.resume();
  }

  if (isLiveCaptionSpeaking || speechSynthesis.speaking) return;

  const nextItem = liveCaptionQueue.shift();
  if (!nextItem) return;



  systemTtsSpeakItem(nextItem);
}

// System TTS: speak a single queue item using Web Speech API
function systemTtsSpeakItem(nextItem) {
  const nextText = nextItem.text;

  const voices = speechSynthesis.getVoices ? speechSynthesis.getVoices() : [];
  if (!voices || voices.length === 0) {
    // Voices not ready yet; push back and retry shortly.
    liveCaptionQueue.unshift(nextItem);
    if (liveCaptionQueue.length > LIVE_CAPTION_QUEUE_MAX) {
      liveCaptionQueue.pop();
    }
    setTimeout(ttsSpeakNext, 300);
    return;
  }

  const utterance = new SpeechSynthesisUtterance(nextText);
  utterance.rate = computeTtsRate(nextText, nextItem.segStart, nextItem.segEnd);
  utterance.pitch = TTS_PITCH;
  utterance.volume = TTS_VOLUME;
  utterance.lang = currentTargetLang || 'vi';
  const voice = pickVoiceForLang(utterance.lang);
  if (voice) {
    utterance.voice = voice;
  } else {
    const langKey = (utterance.lang || '').toLowerCase();
    if (langKey && ttsWarnedNoVoiceForLang !== langKey) {
      ttsWarnedNoVoiceForLang = langKey;
      console.warn('[YT-Trans][TTS] No matching voice for lang:', utterance.lang, 'Falling back to default system voice.');
      updateStatus(`Không tìm thấy giọng đọc cho ngôn ngữ "${utterance.lang}" trên máy này. Hãy cài TTS/voice phù hợp (ví dụ Tiếng Việt) trong Windows/Chrome.`, null);
    }
  }

  let safetyTimer = null;
  const finalizeSpeech = () => {
    if (safetyTimer) {
      clearTimeout(safetyTimer);
      safetyTimer = null;
    }
    isLiveCaptionSpeaking = false;
    isCloudTtsSpeaking = false;
    ttsCurrentSegEnd = null;
    liveCaptionLastSpokenText = nextText;
    liveCaptionLastSpokenAt = Date.now();
    ttsSpeakNext();
  };

  let speakCalledAt = 0;
  utterance.onstart = () => {
    ttsLastStartAt = Date.now();
    // Measure actual TTS startup latency for adaptive lead
    if (speakCalledAt > 0) {
      const latencyMs = Date.now() - speakCalledAt;
      ttsLatencySamples.push(latencyMs);
      if (ttsLatencySamples.length > TTS_LATENCY_SAMPLE_MAX) {
        ttsLatencySamples.shift();
      }
    }
  };
  utterance.onend = finalizeSpeech;
  utterance.onerror = finalizeSpeech;

  isLiveCaptionSpeaking = true;
  ttsCurrentSegEnd = nextItem.segEnd;
  speakCalledAt = Date.now();
  speechSynthesis.speak(utterance);

  const segDurationMs = (nextItem.segEnd != null && nextItem.segStart != null && nextItem.segEnd > nextItem.segStart)
    ? (nextItem.segEnd - nextItem.segStart) * 1000 + 1500
    : null;
  const maxDurationMs = segDurationMs
    ? Math.min(segDurationMs, Math.max(2000, nextText.length * 60))
    : Math.min(8000, Math.max(2000, nextText.length * 60));
  safetyTimer = setTimeout(finalizeSpeech, maxDurationMs);
}

function ttsClearQueue() {
  liveCaptionQueue.length = 0;
  ttsQueueLastText = '';
  liveCaptionBuffer = '';
  liveCaptionPendingText = '';
  liveCaptionCurrentText = '';
  ttsCurrentSegEnd = null;
}

// Unified TTS push: dedup 2 chiều + queue drain tuần tự (không drop câu)
function ttsPush(text, allowMerge = true, segStart = null, segEnd = null, audioBufferPromise = null) {
  if (!isDubbingEnabled) return;
  const now = Date.now();
  const normalized = normalizeTtsText(text);
  if (!normalized) return;

  // Buffer short fragments to reduce choppiness
  const wordCount = normalized.split(' ').filter(Boolean).length;
  const hasPunctuation = /[.!?,;…]$/.test(normalized);
  const isLongEnough = normalized.length >= LIVE_CAPTION_MIN_CHARS || wordCount >= LIVE_CAPTION_MIN_WORDS || hasPunctuation;
  const isShort = !isLongEnough;

  let finalText = normalized;
  if (isShort) {
    liveCaptionBuffer = liveCaptionBuffer ? `${liveCaptionBuffer} ${normalized}`.trim() : normalized;

    const bufferWords = liveCaptionBuffer.split(' ').filter(Boolean).length;
    const bufferHasPunctuation = /[.!?,;…]$/.test(liveCaptionBuffer);
    const bufferLongEnough = liveCaptionBuffer.length >= LIVE_CAPTION_MIN_CHARS
      || bufferWords >= LIVE_CAPTION_MIN_WORDS
      || bufferHasPunctuation;

    if (!bufferLongEnough) return;

    finalText = normalizeTtsText(liveCaptionBuffer);
    liveCaptionBuffer = '';
  } else if (liveCaptionBuffer) {
    finalText = normalizeTtsText(`${liveCaptionBuffer} ${normalized}`);
    liveCaptionBuffer = '';
  }

  if (shouldDropTtsText(finalText, now)) return;

  if (allowMerge && liveCaptionQueue.length > 0 && now - liveCaptionLastQueuedAt < LIVE_CAPTION_QUEUE_MERGE_MS) {
    const lastIndex = liveCaptionQueue.length - 1;
    const lastItem = liveCaptionQueue[lastIndex];
    const merged = normalizeTtsText(`${lastItem.text} ${finalText}`);
    if (!shouldDropTtsText(merged, now)) {
      liveCaptionQueue[lastIndex] = {
        text: merged,
        segStart: lastItem.segStart ?? segStart,
        segEnd: segEnd ?? lastItem.segEnd
      };
      ttsQueueLastText = merged;
    }
  } else {
    liveCaptionQueue.push({ text: finalText, segStart, segEnd, audioBufferPromise });
    ttsQueueLastText = finalText;
  }

  liveCaptionLastQueuedAt = now;

  if (liveCaptionQueue.length > LIVE_CAPTION_QUEUE_MAX) {
    liveCaptionQueue.shift();
  }

  ttsSpeakNext();
}

function startTtsWatchdog() {
  if (ttsWatchdogInterval || !('speechSynthesis' in window)) return;
  ttsWatchdogInterval = setInterval(() => {
    if (!isDubbingEnabled || !('speechSynthesis' in window)) return;

    const video = document.querySelector('video');
    if (video && (video.paused || video.seeking)) return;

    if (speechSynthesis.paused) {
      speechSynthesis.resume();
    }

    if (speechSynthesis.speaking && Date.now() - ttsLastStartAt > TTS_STUCK_MS) {
      speechSynthesis.cancel();
      isLiveCaptionSpeaking = false;
      ttsCurrentSegEnd = null;
    }

    // Interrupt if current segment's time window has passed (anti-cascading delay)
    if (speechSynthesis.speaking && ttsCurrentSegEnd != null && video && video.currentTime > ttsCurrentSegEnd + 0.3) {
      speechSynthesis.cancel();
      isLiveCaptionSpeaking = false;
      ttsCurrentSegEnd = null;
    }

    ttsSpeakNext();
  }, TTS_WATCHDOG_MS);
}

function stopTtsWatchdog() {
  if (ttsWatchdogInterval) {
    clearInterval(ttsWatchdogInterval);
    ttsWatchdogInterval = null;
  }
}

function speakText(text, allowInterrupt = true) {
  if (!isDubbingEnabled || !('speechSynthesis' in window)) return;
  if (allowInterrupt) {
    speechSynthesis.cancel();
    isLiveCaptionSpeaking = false;
  }
  ttsPush(text, false);
}

function appendLiveCaptionToBuffer(text) {
  const now = Date.now();
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return;

  if (normalized === liveCaptionLastAppendedText && now - liveCaptionLastAppendedAt < 1500) {
    return;
  }

  if (liveCaptionBuffer.endsWith(normalized)) {
    return;
  }

  liveCaptionBuffer = liveCaptionBuffer ? `${liveCaptionBuffer} ${normalized}`.trim() : normalized;
  liveCaptionLastAppendedText = normalized;
  liveCaptionLastAppendedAt = now;
}

function flushLiveCaptionBuffer(force = false) {
  const text = liveCaptionBuffer.replace(/\s+/g, ' ').trim();
  if (!text) return;

  const wordCount = text.split(' ').filter(Boolean).length;
  const hasPunctuation = /[.!?,;…]$/.test(text);
  const isLongEnough = text.length >= LIVE_CAPTION_MIN_CHARS || wordCount >= LIVE_CAPTION_MIN_WORDS || hasPunctuation;

  if (!force && !isLongEnough) return;

  ttsPush(text);
  liveCaptionBuffer = '';
}

function stopLiveCaptionMode() {
  if (liveCaptionObserver) {
    liveCaptionObserver.disconnect();
    liveCaptionObserver = null;
  }
  if (liveCaptionFlushInterval) {
    clearInterval(liveCaptionFlushInterval);
    liveCaptionFlushInterval = null;
  }
  liveCaptionLastText = '';
  isLiveCaptionMode = false;
  liveCaptionBuffer = '';
  liveCaptionPendingText = '';
  ttsClearQueue();
  liveCaptionCurrentText = '';
  liveCaptionLastChangeAt = 0;
  liveCaptionLastTopLine = '';
  liveCaptionLastLineText = '';
  liveCaptionWarmupUntil = 0;
}

async function startLiveCaptionMode() {
  stopLiveCaptionMode();

  const video = document.querySelector('video');
  if (!video) {
    throw new Error('Video element not found');
  }

  const waitForCaptionContainer = async () => {
    const maxWaitMs = 8000;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const container = document.querySelector('.ytp-caption-window-container, .caption-window');
      if (container) return container;
      await sleep(250);
    }
    return null;
  };

  const container = await waitForCaptionContainer();
  if (!container) {
    throw new Error('Caption container not found');
  }

  liveCaptionWarmupUntil = Date.now() + LIVE_CAPTION_WARMUP_MS;

  const getCaptionLines = () => {
    const rawText = (container.innerText || container.textContent || '').replace(/\r/g, '').trim();
    if (rawText) {
      const lines = rawText.split('\n')
        .map(line => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      if (lines.length > 0) return lines;
    }

    const segments = Array.from(container.querySelectorAll('.ytp-caption-segment'))
      .map(el => (el.textContent || '').trim())
      .filter(Boolean);
    const text = segments.length > 0
      ? segments.join(' ')
      : (container.textContent || '').replace(/\s+/g, ' ').trim();
    return text ? [text] : [];
  };

  liveCaptionObserver = new MutationObserver(() => {
    const lines = getCaptionLines();
    if (lines.length === 0) return;

    const displayText = lines.join(' ');
    if (displayText === liveCaptionLastText) return;

    liveCaptionLastText = displayText;
    showSubtitle(displayText);

    if (!isDubbingEnabled) return;

    const now = Date.now();
    if (now < liveCaptionWarmupUntil) return;

    const topLine = lines.length > 1 ? lines[0] : '';
    const bottomLine = lines[lines.length - 1];
    let completedLine = '';

    if (bottomLine !== liveCaptionLastLineText) {
      const previousLine = liveCaptionLastLineText;
      if (previousLine
        && !bottomLine.startsWith(previousLine)
        && !previousLine.startsWith(bottomLine)) {
        completedLine = previousLine;
        // [FIX] Dòng cũ đã bị đẩy ra ngoài (line flip) → đọc ngay, không đợi stable
        ttsPush(previousLine, false);
      }
      liveCaptionLastLineText = bottomLine;
      liveCaptionCurrentText = bottomLine;
      liveCaptionLastChangeAt = now;
    }

    if (topLine && topLine !== liveCaptionLastTopLine) {
      if (!completedLine || topLine !== completedLine) {
        ttsPush(topLine, false);
      }
      liveCaptionLastTopLine = topLine;
    }

    // [FIX] Detect dấu câu kết thúc trong bottom line → đọc ngay, không đợi stable timer
    if (bottomLine && /[.!?…]$/.test(bottomLine.trim())) {
      ttsPush(bottomLine, false);
      liveCaptionCurrentText = '';
    }
  });

  liveCaptionObserver.observe(container, {
    childList: true,
    characterData: true,
    subtree: true
  });

  // [FIX] Flush interval giảm xuống 800ms để drain queue liên tục
  liveCaptionFlushInterval = setInterval(() => {
    if (!isDubbingEnabled) return;
    const video = document.querySelector('video');
    if (!video || video.paused) return;
    const now = Date.now();
    if (now < liveCaptionWarmupUntil) return;

    // [FIX] Giảm STABLE_MS còn 250ms: stable ngắn hơn → bắt đầu TTS nhanh hơn
    if (liveCaptionCurrentText && now - liveCaptionLastChangeAt >= LIVE_CAPTION_STABLE_MS) {
      ttsPush(liveCaptionCurrentText);
      liveCaptionCurrentText = '';
    }
    if (now - liveCaptionLastAppendedAt >= LIVE_CAPTION_FLUSH_INTERVAL_MS) {
      flushLiveCaptionBuffer(true);
    } else {
      flushLiveCaptionBuffer(false);
    }
  }, LIVE_CAPTION_FLUSH_INTERVAL_MS);

  isLiveCaptionMode = true;
  updateStatus('Đang dùng phụ đề trên màn hình', 100);
}

// Main translation process
async function startTranslation(targetLang) {
  if (isTranslating) {
    return { success: false, error: 'Đang dịch, vui lòng đợi...' };
  }

  const videoId = getVideoId();
  if (!videoId) {
    return { success: false, error: 'Không tìm thấy ID video' };
  }

  if (currentVideoId === videoId && translatedSegments.length > 0) {
    return { success: true, message: 'Video này đã được dịch' };
  }

  // Cancel any in-flight requests from a previous translation
  if (currentAbortController) {
    currentAbortController.abort();
  }
  currentAbortController = new AbortController();

  isTranslating = true;
  currentVideoId = videoId;
  translatedSegments = [];
  currentTargetLang = targetLang || 'vi';

  const overlay = createOverlay();
  overlay.style.display = 'block';

  // [FIX] Tự động bật phụ đề YouTube nếu chưa bật
  const ccBtn = document.querySelector('.ytp-subtitles-button');
  if (ccBtn && ccBtn.getAttribute('aria-pressed') === 'false') {
    ccBtn.click();
  }

  // Khóa nút Lồng tiếng khi đang lấy dữ liệu
  const toggleBtn = document.getElementById('toggleDubbing');
  if (toggleBtn) {
    toggleBtn.disabled = true;
    toggleBtn.style.opacity = '0.5';
    toggleBtn.style.cursor = 'not-allowed';
    toggleBtn.title = 'Đang lấy dữ liệu, vui lòng đợi...';
  }

  try {
    updateStatus('Đang lấy phụ đề...', 10);
    stopLiveCaptionMode();
    let segments = [];
    let isAlreadyTranslated = false;
    let sourceUrl = '';

    try {
      if (interceptedTranscription.videoId === videoId && interceptedTranscription.segments?.length > 0) {
        segments = interceptedTranscription.segments;
        sourceUrl = interceptedTranscription.url || '';
        timedtextLog('Using intercepted transcription', { videoId, segments: segments.length });
      }

      if (prefetchedTranscription.videoId === videoId) {
        if (prefetchedTranscription.segments) {
          segments = prefetchedTranscription.segments;
          sourceUrl = prefetchedTranscription.url || '';
        } else if (prefetchedTranscription.promise) {
          const res = await prefetchedTranscription.promise;
          if (res) {
            segments = res.segments || res;
            sourceUrl = res.url || '';
          }
        }
      }
      if (!segments || segments.length === 0) {
        const intercepted = await waitForInterceptedTranscript(videoId, 4000);
        if (intercepted && intercepted.segments?.length > 0) {
          segments = intercepted.segments;
          sourceUrl = intercepted.url || '';
          timedtextLog('Using intercepted transcription (waited)', { videoId, segments: segments.length });
        }
      }
      if (!segments || segments.length === 0) {
        const fetchResult = await fetchTranscription(videoId, targetLang);
        if (fetchResult) {
          segments = fetchResult.segments || fetchResult;
          sourceUrl = fetchResult.url || '';
        }
      }
    } catch (error) {
      if (error?.name === 'AutomatedQueriesBlocked') {
        updateStatus('Có vấn đề, Video này không có phụ đề, hãy bật Play + bật CC 1 lần rồi thử lại.', 0);
      } else {
        updateStatus('Video này không có phụ đề, hãy bật Play + bật CC 1 lần...', 115, 'Cho đến phụ đề hiển thị trên video!');
      }
      try {
        segments = await fetchTranscriptionFromTextTracks(targetLang);
      } catch (trackError) {
        // User request: do NOT read captions via UI. If timedtext/textTracks fail, return error.
        throw trackError;
      }
    }

    if (!segments || segments.length === 0) {
      throw new Error('Video này không có phụ đề để dịch, hãy bật Play + bật CC 1 lần rồi thử lại.');
    }

    // Check if the source already contains translated text (via YouTube's tlang or native translation)
    if (sourceUrl && (sourceUrl.includes('tlang=') || sourceUrl.includes('lang=' + targetLang))) {
      isAlreadyTranslated = true;
      log('Bypassing translation: Source is already translated', sourceUrl);
    }

    updateStatus(isAlreadyTranslated ? `Đang xử lý ${segments.length} câu...` : `Đang dịch ${segments.length} câu...`, 30);

    const segmentsWithIndices = segments.map((segment, index) => ({
      ...segment,
      originalIndex: index
    }));

    // Progressive mode: start syncing immediately with original captions.
    translatedSegments = segmentsWithIndices.map(seg => ({
      ...seg,
      originalText: seg.text,
      translatedText: isAlreadyTranslated ? seg.text : ''
    }));

    // Mở khóa nút Lồng tiếng khi đã có dữ liệu
    if (toggleBtn) {
      toggleBtn.disabled = false;
      toggleBtn.style.opacity = '1';
      toggleBtn.style.cursor = 'pointer';
      toggleBtn.title = '';
    }

    syncSubtitles();
    const video = document.querySelector('video');
    if (video && isDubbingEnabled) {
      scheduleTtsFromSegments(video);
    }

    if (!isAlreadyTranslated) {
      const translatedCountByIndex = new Set();
      const onChunkTranslated = (translatedChunk) => {
        for (const tr of (translatedChunk || [])) {
          const idx = tr?.originalIndex;
          if (idx === null || idx === undefined) continue;
          const target = translatedSegments[idx];
          if (!target) continue;
          Object.assign(target, tr);
          translatedCountByIndex.add(idx);
        }
      };

      await translateAllSegments(segmentsWithIndices, targetLang, onChunkTranslated);

      const doneCount = translatedCountByIndex.size;
      if (doneCount > 0) {
        updateStatus(`✓ Dịch xong! Sẵn sàng ${doneCount}/${translatedSegments.length} câu`, 100);
      } else {
        updateStatus(`✓ Dịch xong! Sẵn sàng ${translatedSegments.length} câu`, 100);
      }
    } else {
      updateStatus(`✓ Đã tải xong ${translatedSegments.length} câu!`, 100);
    }

    return { success: true };

  } catch (error) {
    if (error.name === 'AbortError') {
      updateStatus('Đã huỷ dịch', 0);
      return { success: false, error: 'Đã huỷ dịch' };
    }
    updateStatus(`Lỗi: ${error.message}`, 0);
    return { success: false, error: error.message };
  } finally {
    isTranslating = false;
  }
}

let ttsScheduleGeneration = 0;

// [FIX] Hủy tất cả TTS schedule timers (dùng khi seek hoặc stop)
function clearTtsScheduleTimers() {
  ttsScheduleGeneration++;
  ttsScheduleTimers.forEach(t => clearTimeout(t));
  ttsScheduleTimers = [];
}

// [FIX] Pre-schedule TTS bằng setTimeout dựa trên timestamp JSON
// Thay vì reactive (chờ timeupdate rồi cancel/speak), giờ chủ động schedule trước
// → TTS bắt đầu đúng lúc, không bị trễ 1 nhịp
function scheduleTtsFromSegments(video) {
  clearTtsScheduleTimers();
  if (!isDubbingEnabled || !('speechSynthesis' in window)) return;

  const now = video.currentTime;
  const adaptiveLead = getAdaptiveTtsLead();

  translatedSegments.forEach((seg) => {
    // Prefetch logic (Cloud TTS only)
    if (ttsSource === 'cloud' && cloudTtsApiKey && cloudTtsVoiceName) {
      const prefetchLead = 4.0; // Tải trước 4 giây
      const prefetchFireTime = Math.max(0, (seg.start || 0) - prefetchLead);
      const prefetchDelayMs = (prefetchFireTime - now) * 1000;

      if (prefetchDelayMs > -4000) { // Bỏ qua nếu đã quá trễ
        const pt = setTimeout(() => {
          if (!isDubbingEnabled || video.paused || video.seeking) return;
          const translated = (seg.translatedText || '').trim();
          if (translated && !seg.audioBufferPromise) {
            seg.audioBufferPromise = fetchCloudTtsAudio(translated, seg.start, seg.end);
          }
        }, Math.max(0, prefetchDelayMs));
        ttsScheduleTimers.push(pt);
      }
    }

    // Playback logic
    // Fire adaptiveLead seconds before caption start to compensate for TTS startup latency
    const fireAtVideoTime = Math.max(0, (seg.start || 0) - adaptiveLead);
    const delayMs = (fireAtVideoTime - now) * 1000;
    if (delayMs < -500) return; // bỏ qua segment đã qua quá 0.5s

    const currentGeneration = ttsScheduleGeneration;
    const t = setTimeout(() => {
      if (ttsScheduleGeneration !== currentGeneration) return;
      if (!isDubbingEnabled) return;
      // Kiểm tra video không bị seek ra khỏi window này
      if (Math.abs(video.currentTime - fireAtVideoTime) > 3) return;

      // Progressive translation: only speak when translatedText is available.
      // This prevents speaking the original language (often English) on slower machines.
      const deadline = (seg.end ?? (seg.start ?? 0) + 2) + 0.6;
      const trySpeak = () => {
        if (ttsScheduleGeneration !== currentGeneration) return;
        if (!isDubbingEnabled) return;
        if (video.paused || video.seeking) return;

        const nowVideoTime = video.currentTime;
        if (nowVideoTime > deadline) return;

        const translated = (seg.translatedText || '').trim();
        if (translated) {
          // Bypass sequential queue to prevent accumulated delay and skipped segments
          if (ttsSource === 'cloud' && cloudTtsApiKey && cloudTtsVoiceName) {
            const audioPromise = seg.audioBufferPromise || fetchCloudTtsAudio(translated, seg.start, seg.end);
            audioPromise.then(audioBuffer => {
              if (ttsScheduleGeneration !== currentGeneration) return;
              if (audioBuffer && isDubbingEnabled && !video.paused && !video.seeking) {
                playCloudTtsAudio(audioBuffer);
              } else if (!audioBuffer) {
                console.warn('[CloudTTS] Audio fetch failed at playback time. Skipping segment.');
                // speechSynthesis.cancel();
                // systemTtsSpeakItem({ text: translated, segStart: seg.start, segEnd: seg.end });
              }
            });
          } else {
            speechSynthesis.cancel();
            systemTtsSpeakItem({ text: translated, segStart: seg.start, segEnd: seg.end });
          }
          return;
        }

        // Not ready yet: retry shortly until we pass the segment window.
        const pt = setTimeout(trySpeak, 350);
        ttsScheduleTimers.push(pt);
      };

      trySpeak();
    }, Math.max(0, delayMs));

    ttsScheduleTimers.push(t);
  });

  log(`Scheduled TTS for ${ttsScheduleTimers.length} segments`);
}

// Sync subtitles with video using binary search
function syncSubtitles() {
  const video = document.querySelector('video');
  if (!video) {
    log('Video element not found, retrying in 2 seconds...');
    setTimeout(syncSubtitles, 2000);
    return;
  }

  // Remove previous listener to prevent memory leak
  if (currentTimeUpdateHandler) {
    video.removeEventListener('timeupdate', currentTimeUpdateHandler);
  }

  // Remove previous playback handlers
  if (currentPlaybackHandlers.play) video.removeEventListener('play', currentPlaybackHandlers.play);
  if (currentPlaybackHandlers.pause) video.removeEventListener('pause', currentPlaybackHandlers.pause);
  if (currentPlaybackHandlers.seeking) video.removeEventListener('seeking', currentPlaybackHandlers.seeking);
  if (currentPlaybackHandlers.seeked) video.removeEventListener('seeked', currentPlaybackHandlers.seeked);
  if (currentPlaybackHandlers.ratechange) video.removeEventListener('ratechange', currentPlaybackHandlers.ratechange);

  let lastDisplayedIndex = -1;
  let lastDisplayedText = '';
  let lastVideoTime = 0;

  // Binary search for O(log n) lookup instead of O(n)
  function findSegmentIndex(time) {
    let lo = 0, hi = translatedSegments.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (time < translatedSegments[mid].start) hi = mid - 1;
      else if (time > translatedSegments[mid].end) lo = mid + 1;
      else return mid;
    }
    return -1;
  }

  // [FIX] timeupdate chỉ lo hiển thị subtitle, không lo TTS nữa
  // TTS được xử lý bởi scheduleTtsFromSegments()
  currentTimeUpdateHandler = () => {
    try {
      const currentTime = video.currentTime;

      // Detect seek (forward/backward jump) → reschedule toàn bộ TTS timers
      if (Math.abs(currentTime - lastVideoTime) > 0.75) {
        lastDisplayedIndex = -1;
        if (isDubbingEnabled) {
          speechSynthesis.cancel();
          isLiveCaptionSpeaking = false;
          ttsClearQueue();
          scheduleTtsFromSegments(video);
        }
      }
      lastVideoTime = currentTime;

      // Show subtitle exactly for its time window
      const displayIndex = findSegmentIndex(currentTime + SUBTITLE_LEAD_S);
      if (displayIndex !== -1) {
        const seg = translatedSegments[displayIndex];
        const textToShow = (seg?.translatedText || seg?.text || '').trim();
        if (displayIndex !== lastDisplayedIndex || textToShow !== lastDisplayedText) {
          showSubtitle(textToShow);
          lastDisplayedIndex = displayIndex;
          lastDisplayedText = textToShow;
        }
      }
    } catch (error) {
      console.error('Error in subtitle sync:', error);
    }
  };

  video.addEventListener('timeupdate', currentTimeUpdateHandler);

  // [FIX] Schedule TTS ngay khi sync bắt đầu
  if (isDubbingEnabled) {
    scheduleTtsFromSegments(video);
  }

  currentPlaybackHandlers.pause = () => {
    if (!isDubbingEnabled) return;
    try {
      speechSynthesis.cancel();
    } catch { /* ignore */ }
    isLiveCaptionSpeaking = false;
    ttsClearQueue();
    clearTtsScheduleTimers();
  };

  currentPlaybackHandlers.seeking = () => {
    if (!isDubbingEnabled) return;
    try {
      speechSynthesis.cancel();
    } catch { /* ignore */ }
    isLiveCaptionSpeaking = false;
    ttsClearQueue();
    clearTtsScheduleTimers();
  };

  // Khi play/seek xong → schedule lại theo currentTime hiện tại
  currentPlaybackHandlers.play = () => {
    if (isDubbingEnabled) scheduleTtsFromSegments(video);
  };

  currentPlaybackHandlers.seeked = () => {
    if (isDubbingEnabled && !video.paused) scheduleTtsFromSegments(video);
  };

  currentPlaybackHandlers.ratechange = () => {
    if (isDubbingEnabled && !video.paused && !video.seeking) scheduleTtsFromSegments(video);
  };

  video.addEventListener('pause', currentPlaybackHandlers.pause);
  video.addEventListener('seeking', currentPlaybackHandlers.seeking);
  video.addEventListener('play', currentPlaybackHandlers.play);
  video.addEventListener('seeked', currentPlaybackHandlers.seeked);
  video.addEventListener('ratechange', currentPlaybackHandlers.ratechange);

  log('Subtitle synchronization started');
}

// Toggle dubbing with Web Speech API
function toggleDubbing() {
  const btn = document.getElementById('toggleDubbing');
  isDubbingEnabled = !isDubbingEnabled;

  if (isDubbingEnabled) {
    if (!('speechSynthesis' in window)) {
      updateStatus('Trình duyệt không hỗ trợ đọc văn bản (TTS)', null);
      isDubbingEnabled = false;
      return;
    }
    btn.textContent = 'Tắt lồng tiếng';
    updateStatus('Đã bật lồng tiếng (TTS)', null);
    startTtsWatchdog();
    // [FIX] Khi bật dubbing → schedule ngay nếu đang có segments
    if (translatedSegments.length > 0) {
      const video = document.querySelector('video');
      if (video) scheduleTtsFromSegments(video);
    }
  } else {
    speechSynthesis.cancel();
    clearTtsScheduleTimers();
    stopTtsWatchdog();
    btn.textContent = ' Bật lồng tiếng';
    updateStatus('Đã tắt lồng tiếng', null);
  }
}

// Listen for messages from popup and background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startTranslation') {
    // Apply TTS settings from popup
    if (request.ttsSource) ttsSource = request.ttsSource;
    if (request.cloudTtsApiKey) cloudTtsApiKey = request.cloudTtsApiKey;
    if (request.cloudTtsVoiceName) cloudTtsVoiceName = request.cloudTtsVoiceName;
    if (request.cloudTtsLangCode) cloudTtsLangCode = request.cloudTtsLangCode;

    log('[TTS Config]', { ttsSource, cloudTtsVoiceName, cloudTtsLangCode });

    startTranslation(request.targetLang)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'autoTranslate') {
    chrome.storage.sync.get(['targetLang', 'ttsSource', 'cloudTtsApiKey', 'cloudTtsVoiceName'], (data) => {
      if (data.ttsSource) ttsSource = data.ttsSource;
      if (data.cloudTtsApiKey) cloudTtsApiKey = data.cloudTtsApiKey;
      if (data.cloudTtsVoiceName) cloudTtsVoiceName = data.cloudTtsVoiceName;
      if (data.targetLang) {
        startTranslation(data.targetLang);
      }
    });
    return false;
  }
});

// [FIX] Phát hiện khi người dùng bấm sang video khác (SPA navigation của YouTube)
document.addEventListener('yt-navigate-finish', () => {
  console.log('[YT-Trans] Chuyển video mới, tự động tải lại tiện ích...');

  // Dừng giọng đọc cũ
  if ('speechSynthesis' in window) {
    speechSynthesis.cancel();
  }
  isLiveCaptionSpeaking = false;
  clearTtsScheduleTimers();
  ttsClearQueue();
  stopTtsWatchdog();

  // Xóa dữ liệu cũ
  translatedSegments = [];
  rawSegments = [];
  isTranslating = false;

  // Ẩn phụ đề cũ
  const overlay = document.getElementById('yt-translator-overlay');
  if (overlay) {
    overlay.style.display = 'none';
  }

  // Cập nhật UI
  updateStatus('Đã phát hiện video mới. Đang chuẩn bị...', null);
  const toggleBtn = document.getElementById('toggleDubbing');
  if (toggleBtn) toggleBtn.style.display = 'none';

  // Thử tự động dịch lại cho video mới nếu đã có API Key
  setTimeout(() => {
    chrome.storage.sync.get(['targetLang', 'ttsSource', 'cloudTtsApiKey', 'cloudTtsVoiceName'], (data) => {
      if (data.ttsSource) ttsSource = data.ttsSource;
      if (data.cloudTtsApiKey) cloudTtsApiKey = data.cloudTtsApiKey;
      if (data.cloudTtsVoiceName) cloudTtsVoiceName = data.cloudTtsVoiceName;
      if (data.targetLang) {
        startTranslation(data.targetLang);
      } else {
        updateStatus('Sẵn sàng dịch. Vui lòng bấm Dịch ở Popup.', null);
      }
    });
  }, 1000); // Đợi 1 giây để YouTube load xong player mới
});

// Initialize when page loads (YouTube is SPA; content script may load before watch?v=)
if (!window.__YT_TRANS_TIMEDTEXT_INIT__) {
  window.__YT_TRANS_TIMEDTEXT_INIT__ = true;
  timedtextLog('Content script init', { href: location.href, videoId: getVideoId() });
  initTimedtextPrefetch();
}
