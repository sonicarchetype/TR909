// DISABLED SERVICE WORKER - Prevents update notifications
self.addEventListener('install', (event) => {
  // Skip waiting to become active immediately
  event.waitUntil(self.skipWaiting());
  console.log('Service worker installed and disabled');
});

self.addEventListener('activate', (event) => {
  // Claim clients
  event.waitUntil(self.clients.claim());
  console.log('Service worker activated but disabled');
});

// Pass through all fetch requests without caching
self.addEventListener('fetch', (event) => {
  // Use a safer approach for Safari - just let the browser handle the request
  // This avoids potential issues with Safari's service worker implementation
  if (!event.request) {
    return;
  }
  
  try {
    event.respondWith(fetch(event.request).catch(err => {
      console.log('Fetch error in service worker:', err);
      // Return an empty response rather than failing
      return new Response('', {
        status: 408,
        statusText: 'Service Worker Error'
      });
    }));
  } catch (e) {
    console.log('Error in service worker fetch handler:', e);
  }
});

// Handle messages
self.addEventListener('message', (event) => {
  if (!event || !event.data || !event.data.action) {
    return;
  }
  
  try {
    if (event.data.action === 'checkForUpdates') {
      // Always respond with "no updates"
      event.source.postMessage({ 
        action: 'updateAvailable', 
        needsRefresh: false,
        type: 'none'
      });
    }
    else if (event.data.action === 'forceUpdate') {
      // Respond with cache cleared
      event.source.postMessage({
        action: 'cacheCleared',
        success: true
      });
    }
  } catch (e) {
    console.log('Error in service worker message handler:', e);
    // Try to respond even if there was an error
    if (event.source && event.source.postMessage) {
      try {
        event.source.postMessage({
          action: 'error',
          error: e.message
        });
      } catch (postError) {
        console.log('Failed to post error message:', postError);
      }
    }
  }
}); 