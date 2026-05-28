// State management
const DEBUG = false;
function log(...args) { if (DEBUG) console.log('[YT-Trans]', ...args); }

let currentVideoId = null;
let translatedSegments = [];
let isTranslating = false;
let currentAbortController = null;
let currentTimeUpdateHandler = null;
let isDubbingEnabled = false;
let liveCaptionObserver = null;
let liveCaptionLastText = '';
let isLiveCaptionMode = false;
let currentTargetLang = 'vi';
let liveCaptionSpeakTimer = null;
let liveCaptionPendingText = '';
let isLiveCaptionSpeaking = false;
const LIVE_CAPTION_DEBOUNCE_MS = 1200;
const LIVE_CAPTION_QUEUE_MAX = 12;
const liveCaptionQueue = [];
let liveCaptionLastQueuedText = '';
const LIVE_CAPTION_QUEUE_MERGE_MS = 1200;
let liveCaptionLastQueuedAt = 0;
const LIVE_CAPTION_MIN_CHARS = 28;
const LIVE_CAPTION_MIN_WORDS = 5;
let liveCaptionLastSpokenText = '';
let liveCaptionLastSpokenAt = 0;
const LIVE_CAPTION_REPEAT_WINDOW_MS = 6000;
let liveCaptionBuffer = '';
let liveCaptionLastAppendedText = '';
let liveCaptionLastAppendedAt = 0;
const LIVE_CAPTION_BUFFER_MAX = 320;
let liveCaptionFlushInterval = null;
const LIVE_CAPTION_FLUSH_INTERVAL_MS = 2500;
let liveCaptionCurrentText = '';
let liveCaptionLastChangeAt = 0;
const LIVE_CAPTION_STABLE_MS = 700;
const LIVE_CAPTION_WARMUP_MS = 5000;
let liveCaptionWarmupUntil = 0;
let ttsLastStartAt = 0;
let ttsWatchdogInterval = null;
const TTS_WATCHDOG_MS = 1200;
const TTS_STUCK_MS = 10000;
const TTS_RATE = 3;
const TTS_LEAD_MS = 500;

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
      <span class="yt-trans-title">🎬 AI Translator</span>
      <button class="yt-trans-close">×</button>
    </div>
    <div class="yt-trans-content">
      <div class="yt-trans-status">Ready to translate</div>
      <div class="yt-trans-progress-bar">
        <div class="yt-trans-progress-fill"></div>
      </div>
      <div class="yt-trans-controls">
        <button class="yt-trans-btn" id="toggleDubbing">🔊 Enable Dubbing</button>
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
  
  return overlay;
}

// Parse seconds from various formats
function parseSeconds(val) {
  const num = parseFloat(val);
  return isNaN(num) ? 0 : num;
}

// Parse YouTube captions response (JSON3 or XML fallback)
function parseCaptionsResponse(responseText) {
  try {
    // Try parsing as JSON first (json3 format)
    const data = JSON.parse(responseText);
    const segments = [];
    if (data.events) {
      data.events.forEach(event => {
        if (!event.segs) return;
        
        const start = (event.tStartMs || 0) / 1000;
        const dur = (event.dDurationMs || 0) / 1000;
        const end = start + dur;
        
        let text = '';
        event.segs.forEach(seg => {
          if (seg.utf8) text += seg.utf8;
        });
        
        text = text.replace(/\n/g, ' ').trim();
        if (text) {
          segments.push({ text, start, end });
        }
      });
    }
    return segments;
  } catch (e) {
    // Fallback to XML parsing (srv1 or srv3 format)
    const parser = new DOMParser();
    const doc = parser.parseFromString(responseText, 'text/xml');
    
    // srv1 uses <text>, srv3 uses <p>
    const textElements = doc.querySelectorAll('text, p');

    const segments = [];
    textElements.forEach((el, index) => {
      const start = parseSeconds(el.getAttribute('start') || el.getAttribute('t'));
      const dur = parseSeconds(el.getAttribute('dur') || el.getAttribute('d'));
      const end = dur > 0 ? start + dur : (index < textElements.length - 1
        ? parseSeconds(textElements[index + 1].getAttribute('start') || textElements[index + 1].getAttribute('t'))
        : start + 5);

      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = el.textContent;
      const text = tempDiv.textContent.replace(/\n/g, ' ').trim();

      if (text) {
        segments.push({ text, start, end });
      }
    });
    return segments;
  }
}

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

// Fetch transcription from YouTube
async function fetchTranscription(videoId) {
  updateStatus('Getting captions URL...', 5);

  let captionsUrl = null;

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
    }
  } catch (e) {
    log('Failed to extract captions via MAIN world script', e);
  }

  if (!captionsUrl) {
    try {
      const bgResponse = await chrome.runtime.sendMessage({
        action: 'getCaptionsUrl',
        videoId
      });
      if (bgResponse?.success && bgResponse.captionsUrl) {
        captionsUrl = bgResponse.captionsUrl;
      }
    } catch (bgError) {
      if (bgError.name === 'AbortError') throw bgError;
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
  updateStatus('Downloading captions...', 10);

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
    captionsUrl,
    buildUrlWithFmt(captionsUrl, 'json3'),
    buildUrlWithFmt(captionsUrl, 'srv3'),
    buildUrlWithFmt(captionsUrl, 'srv1')
  ];

  const candidateUrls = [
    ...baseCandidates,
    ...baseCandidates.map(url => buildUrlWithTlang(url, targetLang))
  ].filter((value, index, self) => self.indexOf(value) === index);

  const tryFetchCaptions = async (url, useBackground = false) => {
    if (!useBackground) {
      const response = await fetch(url, {
        signal: currentAbortController?.signal
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch captions: ${response.status}`);
      }

      const responseText = await response.text();
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

    const segments = parseCaptionsResponse(bgResponse.xml || '');
    return { segments, raw: bgResponse.xml || '' };
  };

  let lastError = null;
  for (const url of candidateUrls) {
    try {
      const directResult = await tryFetchCaptions(url, false);
      if (directResult.segments.length > 0) {
        log(`Fetched ${directResult.segments.length} caption segments`);
        return directResult.segments;
      }
      const snippet = (directResult.raw || '').substring(0, 100).replace(/\n/g, ' ');
      lastError = new Error(`Captions file was empty. Response snippet: ${snippet}`);
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      lastError = error;
    }

    // Background fallback for the same URL
    try {
      const bgResult = await tryFetchCaptions(url, true);
      if (bgResult.segments.length > 0) {
        log(`Fetched ${bgResult.segments.length} caption segments via background`);
        return bgResult.segments;
      }
      const snippet = (bgResult.raw || '').substring(0, 100).replace(/\n/g, ' ');
      lastError = new Error(`Captions file was empty. Response snippet: ${snippet}`);
    } catch (bgError) {
      if (bgError.name === 'AbortError') throw bgError;
      lastError = bgError;
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
          const trackUrls = [
            buildTimedtextUrl(track, 'json3'),
            buildTimedtextUrl(track, 'srv3'),
            buildTimedtextUrl(track, 'srv1'),
            buildTimedtextUrl(track, 'json3', targetLang),
            buildTimedtextUrl(track, 'srv3', targetLang),
            buildTimedtextUrl(track, 'srv1', targetLang)
          ];

          for (const url of trackUrls) {
            try {
              const directResult = await tryFetchCaptions(url, false);
              if (directResult.segments.length > 0) {
                log(`Fetched ${directResult.segments.length} caption segments via track list`);
                return directResult.segments;
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
                log(`Fetched ${bgResult.segments.length} caption segments via background track list`);
                return bgResult.segments;
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
    updateStatus(`Translating chunk ${chunkNum}/${totalChunks} (${segments.length} segments)...`, 30 + (chunkNum / totalChunks) * 60);
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

// Translate all segments in one batch request
async function translateAllSegments(segments, targetLang, apiKey) {
  const useGemini = apiKey && apiKey.length >= 20;

  if (!useGemini) {
    updateStatus('Using free translation (may be slower)...', 15);
  }

  // Use the correct model name
  const modelName = 'gemini-1.5-flash';
  const url = useGemini
    ? `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`
    : null;

  // For very large videos, split into chunks to avoid token limits
  const MAX_SEGMENTS_PER_CHUNK = useGemini ? 40 : 15; // Smaller chunks for free endpoint
  
  if (segments.length <= MAX_SEGMENTS_PER_CHUNK) {
    // Process small videos in one chunk
    return useGemini
      ? await translateChunk(segments, targetLang, url, 0, 1)
      : await translateChunkFree(segments, targetLang, 0, 1);
  } else {
    // Process large videos in chunks
    const chunks = [];
    for (let i = 0; i < segments.length; i += MAX_SEGMENTS_PER_CHUNK) {
      chunks.push(segments.slice(i, i + MAX_SEGMENTS_PER_CHUNK));
    }

    console.log(`Processing ${segments.length} segments in ${chunks.length} chunks`);
    
    let allTranslatedSegments = [];
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      const translatedChunk = useGemini
        ? await translateChunk(chunk, targetLang, url, chunkIndex + 1, chunks.length)
        : await translateChunkFree(chunk, targetLang, chunkIndex + 1, chunks.length);
      allTranslatedSegments.push(...translatedChunk);
      
      // Small delay between chunks
      if (chunkIndex < chunks.length - 1) {
        await sleep(useGemini ? 1000 : 500);
      }
    }
    return allTranslatedSegments;
  }
}

// Translate a single chunk of segments
async function translateChunk(segments, targetLang, url, chunkNum = 1, totalChunks = 1) {
  // Update status with chunk progress
  if (totalChunks > 1) {
    updateStatus(`Translating chunk ${chunkNum}/${totalChunks} (${segments.length} segments)...`, 30 + (chunkNum / totalChunks) * 60);
  }

  // Create JSON structure for this chunk - use global index for proper mapping
  const segmentsJson = segments.map((segment, localIndex) => ({
    id: segments[localIndex].originalIndex || localIndex, // Use original index if available
    text: segment.text,
    timestamp: segment.timestamp
  }));

  const prompt = `Translate the following JSON array of video segments to ${langNames[targetLang]}. 
Return a JSON array with the exact same structure, keeping the "id" and "timestamp" fields unchanged, but translate only the "text" field.
Important: Return ONLY the JSON array, no markdown formatting, no explanations.

Input JSON:
${JSON.stringify(segmentsJson)}

Translated JSON:`;

  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: currentAbortController?.signal,
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8000 // Increased for larger responses
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Gemini API error:', errorData);
        
        // Handle quota exceeded error
        if (errorData.error?.message?.includes('Quota exceeded')) {
          const retryAfterMatch = errorData.error.message.match(/Please retry in ([\d.]+)s/);
          const retryAfter = retryAfterMatch ? parseFloat(retryAfterMatch[1]) * 1000 + 1000 : 15000;
          
          if (retryCount < maxRetries - 1) {
            console.log(`Quota exceeded. Waiting ${retryAfter}ms before retry (attempt ${retryCount + 1}/${maxRetries})`);
            updateStatus(`Rate limited. Waiting ${Math.ceil(retryAfter / 1000)} seconds...`, null);
            await sleep(retryAfter);
            retryCount++;
            continue;
          }
        }
        
        throw new Error(`Translation failed: ${errorData.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();

      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        throw new Error('Invalid response format from Gemini API');
      }

      const responseText = data.candidates[0].content.parts[0].text.trim();
      
      // Clean up the response - remove any markdown formatting and extra text
      let jsonText = responseText;
      
      // Remove markdown code blocks
      if (jsonText.includes('```json')) {
        jsonText = jsonText.split('```json')[1].split('```')[0].trim();
      } else if (jsonText.includes('```')) {
        jsonText = jsonText.split('```')[1].split('```')[0].trim();
      }
      
      // Find the JSON array boundaries more reliably
      const firstBracket = jsonText.indexOf('[');
      const lastBracket = jsonText.lastIndexOf(']');
      
      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        jsonText = jsonText.substring(firstBracket, lastBracket + 1);
      }
      
      // Remove any remaining non-JSON text
      jsonText = jsonText.replace(/^[^[]*/, '').replace(/[^\]]*$/, '');

      try {
        const translatedSegments = JSON.parse(jsonText);
        
        // Validate that we got an array
        if (!Array.isArray(translatedSegments)) {
          throw new Error('Response is not an array');
        }

        // Merge with original segment data
        return segments.map((originalSegment, index) => {
          const lookupId = originalSegment.originalIndex ?? index;
          const translated = translatedSegments.find(t => t.id === lookupId) || translatedSegments[index];
          return {
            ...originalSegment,
            originalText: originalSegment.text,
            translatedText: translated?.text || originalSegment.text // Fallback to original
          };
        });

      } catch (parseError) {
        console.error('Failed to parse translation JSON:', parseError);
        console.error('Raw response:', responseText);
        console.error('Cleaned JSON:', jsonText);
        
        if (retryCount < maxRetries - 1) {
          console.log(`JSON parse failed, retrying... (attempt ${retryCount + 1}/${maxRetries})`);
          await sleep(2000);
          retryCount++;
          continue;
        }
        
        // Final fallback: return original texts
        return segments.map(segment => ({
          ...segment,
          originalText: segment.text,
          translatedText: segment.text
        }));
      }
      
    } catch (error) {
      if (retryCount === maxRetries - 1) {
        console.error('Translation error after all retries:', error);
        // Return segments with original text as fallback
        return segments.map(segment => ({
          ...segment,
          originalText: segment.text,
          translatedText: segment.text
        }));
      }
      
      // For network errors, wait and retry
      if (error.name === 'TypeError' || error.message.includes('fetch')) {
        console.log(`Network error, retrying in 2 seconds (attempt ${retryCount + 1}/${maxRetries})`);
        await sleep(2000);
        retryCount++;
        continue;
      }
      
      throw error;
    }
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
  const exact = voices.find(voice => (voice.lang || '').toLowerCase() === normalized);
  if (exact) return exact;

  const partial = voices.find(voice => (voice.lang || '').toLowerCase().startsWith(normalized));
  return partial || null;
}

function startTtsWatchdog() {
  if (ttsWatchdogInterval || !('speechSynthesis' in window)) return;
  ttsWatchdogInterval = setInterval(() => {
    if (!isDubbingEnabled || !('speechSynthesis' in window)) return;

    if (speechSynthesis.paused) {
      speechSynthesis.resume();
    }

    if (speechSynthesis.speaking && Date.now() - ttsLastStartAt > TTS_STUCK_MS) {
      speechSynthesis.cancel();
      isLiveCaptionSpeaking = false;
    }

    if (!speechSynthesis.speaking && !isLiveCaptionSpeaking && liveCaptionQueue.length > 0) {
      const nextText = liveCaptionQueue.shift();
      speakText(nextText, false);
    }
  }, TTS_WATCHDOG_MS);
}

function stopTtsWatchdog() {
  if (ttsWatchdogInterval) {
    clearInterval(ttsWatchdogInterval);
    ttsWatchdogInterval = null;
  }
}

function speakText(text, allowInterrupt = true, retry = 0) {
  if (!isDubbingEnabled || !('speechSynthesis' in window)) return;
  startTtsWatchdog();
  const voices = speechSynthesis.getVoices ? speechSynthesis.getVoices() : [];
  if (!voices || voices.length === 0) {
    if (retry < 3) {
      setTimeout(() => speakText(text, allowInterrupt, retry + 1), 300);
    }
    return;
  }
  if (speechSynthesis.paused) {
    speechSynthesis.resume();
  }
  if (!allowInterrupt && speechSynthesis.speaking && Date.now() - ttsLastStartAt > TTS_STUCK_MS) {
    speechSynthesis.cancel();
    isLiveCaptionSpeaking = false;
  }
  if (allowInterrupt) {
    speechSynthesis.cancel();
  } else if (speechSynthesis.speaking) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = TTS_RATE;
  utterance.lang = currentTargetLang || 'vi';
  const voice = pickVoiceForLang(utterance.lang);
  if (voice) utterance.voice = voice;
  let safetyTimer = null;
  const finalizeSpeech = () => {
    if (safetyTimer) {
      clearTimeout(safetyTimer);
      safetyTimer = null;
    }
    isLiveCaptionSpeaking = false;
    liveCaptionLastSpokenText = text;
    liveCaptionLastSpokenAt = Date.now();
    if (liveCaptionQueue.length > 0) {
      const nextText = liveCaptionQueue.shift();
      speakText(nextText, false);
    }
  };

  utterance.onstart = () => {
    ttsLastStartAt = Date.now();
  };
  utterance.onend = finalizeSpeech;
  utterance.onerror = finalizeSpeech;

  isLiveCaptionSpeaking = true;
  speechSynthesis.speak(utterance);

  const maxDurationMs = Math.min(12000, Math.max(2000, text.length * 60));
  safetyTimer = setTimeout(() => {
    finalizeSpeech();
  }, maxDurationMs);
}

function enqueueLiveCaption(text) {
  const now = Date.now();
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return;

  if (normalized === liveCaptionLastSpokenText && now - liveCaptionLastSpokenAt < LIVE_CAPTION_REPEAT_WINDOW_MS) {
    return;
  }

  if (liveCaptionLastSpokenText && normalized.includes(liveCaptionLastSpokenText)) {
    return;
  }

  if (liveCaptionQueue.includes(normalized)) {
    return;
  }

  const wordCount = normalized.split(' ').filter(Boolean).length;
  const hasPunctuation = /[.!?…]$/.test(normalized);
  const isLongEnough = normalized.length >= LIVE_CAPTION_MIN_CHARS || wordCount >= LIVE_CAPTION_MIN_WORDS || hasPunctuation;
  const isShort = !isLongEnough;

  if (isShort) {
    if (liveCaptionBuffer) {
      liveCaptionBuffer = `${liveCaptionBuffer} ${normalized}`.trim();
    } else {
      liveCaptionBuffer = normalized;
    }

    const bufferWords = liveCaptionBuffer.split(' ').filter(Boolean).length;
    const bufferHasPunctuation = /[.!?…]$/.test(liveCaptionBuffer);
    const bufferLongEnough = liveCaptionBuffer.length >= LIVE_CAPTION_MIN_CHARS
      || bufferWords >= LIVE_CAPTION_MIN_WORDS
      || bufferHasPunctuation;

    if (!bufferLongEnough) return;

    text = liveCaptionBuffer;
    liveCaptionBuffer = '';
  } else if (liveCaptionBuffer) {
    text = `${liveCaptionBuffer} ${normalized}`.trim();
    liveCaptionBuffer = '';
  }

  const normalizedText = text.replace(/\s+/g, ' ').trim();
  if (normalizedText === liveCaptionLastQueuedText) return;
  if (liveCaptionLastSpokenText && normalizedText.includes(liveCaptionLastSpokenText)) return;

  if (liveCaptionQueue.length > 0
    && now - liveCaptionLastQueuedAt < LIVE_CAPTION_QUEUE_MERGE_MS) {
    const lastIndex = liveCaptionQueue.length - 1;
    if (liveCaptionQueue[lastIndex] !== normalizedText) {
      liveCaptionQueue[lastIndex] = `${liveCaptionQueue[lastIndex]} ${normalizedText}`.trim();
    }
  } else if (normalizedText !== liveCaptionLastQueuedText) {
    liveCaptionQueue.push(normalizedText);
  }

  liveCaptionLastQueuedText = normalizedText;
  liveCaptionLastQueuedAt = now;

  if (liveCaptionQueue.length > LIVE_CAPTION_QUEUE_MAX) {
    liveCaptionQueue.shift();
  }
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
  const hasPunctuation = /[.!?…]$/.test(text);
  const isLongEnough = text.length >= LIVE_CAPTION_MIN_CHARS || wordCount >= LIVE_CAPTION_MIN_WORDS || hasPunctuation;

  if (!force && !isLongEnough) return;

  enqueueLiveCaption(text);
  liveCaptionBuffer = '';

  if (!isLiveCaptionSpeaking && liveCaptionQueue.length > 0) {
    const nextText = liveCaptionQueue.shift();
    speakText(nextText, false);
  }
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
  liveCaptionQueue.length = 0;
  liveCaptionCurrentText = '';
  liveCaptionLastChangeAt = 0;
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

  const getCaptionText = () => {
    const segments = Array.from(container.querySelectorAll('.ytp-caption-segment'))
      .map(el => (el.textContent || '').trim())
      .filter(Boolean);
    const text = segments.length > 0
      ? segments.join(' ')
      : (container.textContent || '').replace(/\s+/g, ' ').trim();
    return text;
  };

  liveCaptionObserver = new MutationObserver(() => {
    const text = getCaptionText();
    if (!text || text === liveCaptionLastText) return;

    liveCaptionLastText = text;
    showSubtitle(text);

    if (!isDubbingEnabled) return;
    liveCaptionCurrentText = text;
    liveCaptionLastChangeAt = Date.now();
  });

  liveCaptionObserver.observe(container, {
    childList: true,
    characterData: true,
    subtree: true
  });

  liveCaptionFlushInterval = setInterval(() => {
    if (!isDubbingEnabled) return;
    const video = document.querySelector('video');
    if (!video || video.paused) return;
    const now = Date.now();
    if (now < liveCaptionWarmupUntil) return;
    if (liveCaptionCurrentText && now - liveCaptionLastChangeAt >= LIVE_CAPTION_STABLE_MS) {
      enqueueLiveCaption(liveCaptionCurrentText);
      liveCaptionCurrentText = '';
      if (!isLiveCaptionSpeaking && liveCaptionQueue.length > 0) {
        const nextText = liveCaptionQueue.shift();
        speakText(nextText, false);
      }
    }
    if (now - liveCaptionLastAppendedAt >= LIVE_CAPTION_FLUSH_INTERVAL_MS) {
      flushLiveCaptionBuffer(true);
    } else {
      flushLiveCaptionBuffer(false);
    }
  }, LIVE_CAPTION_FLUSH_INTERVAL_MS);

  isLiveCaptionMode = true;
  updateStatus('Using on-screen captions', 100);
}

// Main translation process
async function startTranslation(apiKey, targetLang) {
  if (isTranslating) {
    return { success: false, error: 'Translation already in progress' };
  }
  
  const videoId = getVideoId();
  if (!videoId) {
    return { success: false, error: 'No video ID found' };
  }
  
  if (currentVideoId === videoId && translatedSegments.length > 0) {
    return { success: true, message: 'Video already translated' };
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
  
  try {
    updateStatus('Fetching transcription...', 10);
    stopLiveCaptionMode();
    let segments = [];
    try {
      segments = await fetchTranscription(videoId, targetLang);
    } catch (error) {
      updateStatus('Captions API empty. Trying on-page captions...', 15);
      try {
        segments = await fetchTranscriptionFromTextTracks(targetLang);
      } catch (trackError) {
        updateStatus('No text tracks. Watching on-screen captions...', 20);
        await startLiveCaptionMode();
        return { success: true, mode: 'live' };
      }
    }
    
    if (!segments || segments.length === 0) {
      throw new Error('No transcription available for this video');
    }
    
    updateStatus(`Translating ${segments.length} segments...`, 30);
    
    const segmentsWithIndices = segments.map((segment, index) => ({
      ...segment,
      originalIndex: index
    }));
    
    translatedSegments = await translateAllSegments(segmentsWithIndices, targetLang, apiKey);
    
    updateStatus(`✓ Translation complete! ${translatedSegments.length} segments ready`, 100);
    
    syncSubtitles();
    
    return { success: true };
    
  } catch (error) {
    if (error.name === 'AbortError') {
      updateStatus('Translation cancelled', 0);
      return { success: false, error: 'Translation cancelled' };
    }
    updateStatus(`Error: ${error.message}`, 0);
    return { success: false, error: error.message };
  } finally {
    isTranslating = false;
  }
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
  
  let lastDisplayedIndex = -1;
  let lastSpokenIndex = -1;
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
  
  currentTimeUpdateHandler = () => {
    try {
      const currentTime = video.currentTime;
      if (currentTime < lastVideoTime - 0.5) {
        lastDisplayedIndex = -1;
        lastSpokenIndex = -1;
      }
      lastVideoTime = currentTime;

      const displayIndex = findSegmentIndex(currentTime);
      if (displayIndex !== -1 && displayIndex !== lastDisplayedIndex) {
        showSubtitle(translatedSegments[displayIndex].translatedText);
        lastDisplayedIndex = displayIndex;
      }

      if (isDubbingEnabled && 'speechSynthesis' in window) {
        const ttsTime = currentTime + (TTS_LEAD_MS / 1000);
        const speakIndex = findSegmentIndex(ttsTime);
        if (speakIndex !== -1 && speakIndex !== lastSpokenIndex) {
          speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(translatedSegments[speakIndex].translatedText);
          utterance.rate = TTS_RATE;
          utterance.lang = currentTargetLang || 'vi';
          const voice = pickVoiceForLang(utterance.lang);
          if (voice) utterance.voice = voice;
          speechSynthesis.speak(utterance);
          lastSpokenIndex = speakIndex;
        }
      }
    } catch (error) {
      console.error('Error in subtitle sync:', error);
    }
  };
  
  video.addEventListener('timeupdate', currentTimeUpdateHandler);
  log('Subtitle synchronization started');
}

// Toggle dubbing with Web Speech API
function toggleDubbing() {
  const btn = document.getElementById('toggleDubbing');
  isDubbingEnabled = !isDubbingEnabled;
  
  if (isDubbingEnabled) {
    if (!('speechSynthesis' in window)) {
      updateStatus('Speech synthesis not supported in this browser', null);
      isDubbingEnabled = false;
      return;
    }
    btn.textContent = '🔇 Disable Dubbing';
    updateStatus('Dubbing enabled (Text-to-Speech)', null);
    startTtsWatchdog();
  } else {
    speechSynthesis.cancel();
    stopTtsWatchdog();
    btn.textContent = '🔊 Enable Dubbing';
    updateStatus('Dubbing disabled', null);
  }
}

// Listen for messages from popup and background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startTranslation') {
    startTranslation(request.apiKey, request.targetLang)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (request.action === 'autoTranslate') {
    chrome.storage.sync.get(['geminiApiKey', 'targetLang'], (data) => {
      if (data.geminiApiKey && data.targetLang) {
        startTranslation(data.geminiApiKey, data.targetLang);
      }
    });
    return false;
  }
});

// Initialize when page loads
if (getVideoId()) {
  log('YouTube AI Translator loaded');
}