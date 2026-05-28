// Background service worker for the extension

// Fetch captions URL by fetching YouTube page HTML
async function fetchYouTubePageCaptionsUrl(videoId) {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`YouTube page fetch failed: ${response.status}`);
    }

    const html = await response.text();

    const marker = '"captionTracks":';
    if (html.includes(marker)) {
      const parts = html.split(marker);
      const textAfter = parts[1];
      const startIndex = textAfter.indexOf('[');
      
      if (startIndex !== -1) {
        let depth = 0;
        let inString = false;
        let isEscaped = false;
        let endIndex = -1;
        
        for (let i = startIndex; i < textAfter.length; i++) {
          const char = textAfter[i];
          
          if (isEscaped) {
            isEscaped = false;
            continue;
          }
          if (char === '\\') {
            isEscaped = true;
            continue;
          }
          if (char === '"') {
            inString = !inString;
            continue;
          }
          
          if (!inString) {
            if (char === '[') depth++;
            else if (char === ']') {
              depth--;
              if (depth === 0) {
                endIndex = i;
                break;
              }
            }
          }
        }
        
        if (endIndex !== -1) {
          const jsonStr = textAfter.substring(startIndex, endIndex + 1);
          try {
            const tracks = JSON.parse(jsonStr);
            if (tracks && tracks.length > 0) {
              console.log(`Found ${tracks.length} caption track(s) from HTML`);
              return tracks[0].baseUrl;
            }
          } catch(e) {
            console.error('Failed to parse captionTracks JSON', e);
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Background YouTube page fetch error:', error);
    throw error;
  }
}

// Fetch captions XML (CORS fallback)
async function fetchCaptionsXml(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Captions fetch failed: ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    console.error('Background captions fetch error:', error);
    throw error;
  }
}

// Installation handler
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('YouTube AI Translator installed');
    
    // Set default values
    chrome.storage.sync.set({
      targetLang: 'vi',
      autoTranslate: false
    });
    
    // Open welcome page
    chrome.tabs.create({
      url: 'https://www.youtube.com'
    });
  } else if (details.reason === 'update') {
    console.log('YouTube AI Translator updated');
  }
});

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSettings') {
    chrome.storage.sync.get(['geminiApiKey', 'targetLang', 'autoTranslate'], (data) => {
      sendResponse(data);
    });
    return true;
  }
  
  if (request.action === 'saveSettings') {
    chrome.storage.sync.set(request.settings, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (request.action === 'getCaptionsUrl') {
    fetchYouTubePageCaptionsUrl(request.videoId)
      .then(captionsUrl => sendResponse({ success: true, captionsUrl }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (request.action === 'fetchCaptionsXml') {
    fetchCaptionsXml(request.url)
      .then(xml => sendResponse({ success: true, xml }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'fetchCaptionsList') {
    const urls = [
      `https://video.google.com/timedtext?type=list&v=${encodeURIComponent(request.videoId)}`,
      `https://www.youtube.com/api/timedtext?type=list&v=${encodeURIComponent(request.videoId)}`
    ];

    (async () => {
      let lastError = null;
      for (const url of urls) {
        try {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`Captions list fetch failed: ${response.status}`);
          }
          const xml = await response.text();
          return sendResponse({ success: true, xml });
        } catch (error) {
          lastError = error;
        }
      }
      return sendResponse({ success: false, error: lastError?.message || 'Failed to fetch captions list' });
    })();
    return true;
  }

  if (request.action === 'freeTranslate') {
    const params = new URLSearchParams({
      client: 'gtx',
      sl: 'auto',
      tl: request.targetLang,
      dt: 't',
      q: request.text
    });

    fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`)
      .then(response => {
        if (!response.ok) {
          throw new Error(`Free translate failed: ${response.status}`);
        }
        return response.json();
      })
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (request.action === 'notification') {
    // Show notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: request.title || 'YouTube AI Translator',
      message: request.message,
      priority: 2
    });
  }
});

// Handle tab updates to detect YouTube videos
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('youtube.com/watch')) {
    // Check if auto-translate is enabled
    chrome.storage.sync.get(['autoTranslate'], (data) => {
      if (data.autoTranslate) {
        // Send message to content script to auto-start translation
        chrome.tabs.sendMessage(tabId, {
          action: 'autoTranslate'
        }, () => {
          // Suppress errors when content script isn't ready yet
          if (chrome.runtime.lastError) { /* expected */ }
        });
      }
    });
  }
});
