// Injected into the MAIN world to access YouTube's global variables safely without CSP errors
if (!window.__YT_TRANS_HOOKS_INSTALLED__) {
  window.__YT_TRANS_HOOKS_INSTALLED__ = true;

  const shouldCaptureTimedtext = (url) => {
    try {
      const u = typeof url === 'string' ? url : (url?.url || '');
      return !!u && u.includes('timedtext');
    } catch {
      return false;
    }
  };

  const postTimedtextCapture = (url, bodyText) => {
    try {
      if (!url || !bodyText) return;
      window.postMessage({
        type: 'YT_TRANS_TIMEDTEXT_CAPTURE',
        url,
        bodyText,
        capturedAt: Date.now()
      }, '*');
    } catch {
      // ignore
    }
  };

  // Hook XHR
  try {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...args) {
      this.__ytTransTimedtextUrl = url;
      return originalOpen.call(this, method, url, ...args);
    };

    XMLHttpRequest.prototype.send = function(...args) {
      try {
        const url = this.__ytTransTimedtextUrl;
        if (shouldCaptureTimedtext(url) && !this.__ytTransTimedtextHooked) {
          this.__ytTransTimedtextHooked = true;
          this.addEventListener('load', () => {
            try {
              const text = typeof this.responseText === 'string' ? this.responseText : '';
              postTimedtextCapture(url, text);
            } catch {
              // ignore
            }
          });
        }
      } catch {
        // ignore
      }
      return originalSend.apply(this, args);
    };
  } catch {
    // ignore
  }

  // Hook fetch
  try {
    const originalFetch = window.fetch;
    window.fetch = async function(input, init) {
      const response = await originalFetch.call(this, input, init);
      try {
        const url = typeof input === 'string' ? input : (input?.url || '');
        if (shouldCaptureTimedtext(url)) {
          response.clone().text().then((text) => {
            postTimedtextCapture(url, text);
          }).catch(() => {});
        }
      } catch {
        // ignore
      }
      return response;
    };
  } catch {
    // ignore
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data.type !== 'GET_CAPTIONS_URL') return;
  
  let captionsUrl = null;
  
  try {
    // Attempt 1: Check ytInitialPlayerResponse
    if (window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
      const tracks = window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
      if (tracks.length > 0) {
        captionsUrl = tracks[0].baseUrl;
      }
    }
    
    // Attempt 2: Check ytplayer.config.args.raw_player_response
    if (!captionsUrl && window.ytplayer?.config?.args?.raw_player_response) {
      const response = JSON.parse(window.ytplayer.config.args.raw_player_response);
      if (response?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
        const tracks = response.captions.playerCaptionsTracklistRenderer.captionTracks;
        if (tracks.length > 0) {
          captionsUrl = tracks[0].baseUrl;
        }
      }
    }
  } catch (e) {
    console.error('YouTube AI Translator: Error extracting captions URL from global variables', e);
  }
  
  window.postMessage({ type: 'CAPTIONS_URL_RESPONSE', url: captionsUrl }, '*');
});
