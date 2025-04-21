// DISABLED SERVICE WORKER - Prevents update notifications
self.addEventListener('install', (event) => {
  // Skip waiting to become active immediately
  self.skipWaiting();
  console.log('Service worker installed and disabled');
});

self.addEventListener('activate', (event) => {
  // Claim clients
  event.waitUntil(self.clients.claim());
  console.log('Service worker activated but disabled');
});

// Pass through all fetch requests without caching
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

// Handle messages
self.addEventListener('message', (event) => {
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
}); 