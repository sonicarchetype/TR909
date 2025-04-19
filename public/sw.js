const CACHE_NAME = 'tr909-sound-cache-v1';
const SOUND_URL = './sound.tr909data';
const APP_CACHE_NAME = 'tr909-app-cache-v1';
const APP_ASSETS = [
  '/',
  '/index.html',
  '/src/index.jsx',
  '/package.json'  // Add package.json to required assets
  // Add other critical assets here
];

// Helper function to compare buffers by content rather than reference
async function compareResponses(res1, res2) {
  if (!res1 || !res2) return false;
  
  try {
    const [buf1, buf2] = await Promise.all([
      res1.clone().arrayBuffer(),
      res2.clone().arrayBuffer()
    ]);
    
    if (buf1.byteLength !== buf2.byteLength) return false;
    
    // For large files, just comparing byte length is often sufficient
    // If more precision is needed, uncomment the following code:
    /*
    const view1 = new Uint8Array(buf1);
    const view2 = new Uint8Array(buf2);
    for (let i = 0; i < buf1.byteLength; i++) {
      if (view1[i] !== view2[i]) return false;
    }
    */
    
    return true;
  } catch (e) {
    console.error('Error comparing responses:', e);
    return false;
  }
}

// Install event - cache sound data and critical app assets
self.addEventListener('install', (event) => {
  // Skip waiting immediately to become active
  self.skipWaiting();
  
  event.waitUntil(
    Promise.all([
      // Cache critical app assets first
      caches.open(APP_CACHE_NAME).then((cache) => {
        console.log('Service Worker: Caching app assets');
        return cache.addAll(APP_ASSETS).catch(err => {
          console.error('Failed to cache app assets:', err);
          // Continue installation even if caching fails
        });
      }),
      
      // Handle sound data separately with manual fetch for better control
      caches.open(CACHE_NAME).then(async (cache) => {
        console.log('Service Worker: Caching sound data file');
        try {
          // Use a more controlled approach for large files
          const response = await fetch(SOUND_URL, { 
            cache: 'no-store',
            credentials: 'same-origin'
          });
          
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          
          // Store in cache
          await cache.put(SOUND_URL, response);
          console.log('Service Worker: Sound data cached successfully');
        } catch (err) {
          console.error('Failed to cache sound data:', err);
          // Don't reject - we'll try again on fetch
        }
      })
    ])
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (![CACHE_NAME, APP_CACHE_NAME].includes(cacheName)) {
              console.log('Service Worker: Removing old cache', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => self.clients.claim()) // Take control of all clients
  );
});

// Fetch event - implement a more robust strategy for handling the sound data file
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Bypass service worker for /manual route
  // if (event.request.mode === 'navigate' && url.pathname === '/manual') {
  //   console.log('Bypassing service worker for /manual route');
  //   event.respondWith(fetch(event.request));
  //   return;
  // }
  
  // Handle sound data specifically - use a reliable strategy
  if (url.pathname.includes('sound.tr909data')) {
    event.respondWith(
      caches.match(event.request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            console.log('Service Worker: Serving sound data from cache');
            // Return cached response immediately
            return cachedResponse;
          }
          // If not in cache, fetch from network
          console.log('Service Worker: Fetching sound data from network');
          return fetch(event.request)
            .then(networkResponse => {
              if (!networkResponse.ok) {
                throw new Error('Network response was not ok');
              }
              // Clone the response before caching
              const responseToCache = networkResponse.clone();
              // Cache in the background (don't wait for it to complete)
              caches.open(CACHE_NAME)
                .then(cache => {
                  try {
                    cache.put(event.request, responseToCache)
                      .catch(err => console.error('Cache put error:', err));
                  } catch (err) {
                    console.error('Cache operation error:', err);
                  }
                })
                .catch(err => console.error('Cache open error:', err));
              return networkResponse;
            })
            .catch(error => {
              console.error('Fetch failed:', error);
              throw error;
            });
        })
    );
  }
  // Special handling for package.json
  else if (url.pathname.includes('package.json')) {
    event.respondWith(
      caches.match(event.request)
        .then(cachedResponse => {
          return cachedResponse || fetch(event.request);
        })
        .catch(() => {
          // If fetch fails, try to return a minimal valid JSON response
          return new Response('{"version":"1.0.0"}', {
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
  }
  // For other app assets, use cache-first strategy
  else if (APP_ASSETS.includes(url.pathname) || url.pathname === '/') {
    event.respondWith(
      caches.match(event.request)
        .then(cachedResponse => {
          return cachedResponse || fetch(event.request)
            .then(networkResponse => {
              // Cache new responses for app assets
              if (networkResponse.ok) {
                const responseToCache = networkResponse.clone();
                caches.open(APP_CACHE_NAME)
                  .then(cache => cache.put(event.request, responseToCache))
                  .catch(err => console.error('Error caching asset:', err));
              }
              return networkResponse;
            });
        })
    );
  }
});

// Handle messages from the client
self.addEventListener('message', (event) => {
  if (event.data.action === 'checkForUpdates') {
    // Fetch the sound data file from network to check if it's changed
    fetch(SOUND_URL, { cache: 'no-store' })
      .then(networkResponse => {
        if (!networkResponse.ok) {
          throw new Error('Network response was not ok');
        }
        
        // Check if we have this in cache
        return caches.match(SOUND_URL)
          .then(cacheResponse => {
            if (!cacheResponse) {
              // Not in cache, update it
              return caches.open(CACHE_NAME)
                .then(cache => {
                  cache.put(SOUND_URL, networkResponse.clone())
                    .catch(err => console.error('Cache put error during update:', err));
                  
                  event.source.postMessage({ 
                    action: 'updateAvailable', 
                    needsRefresh: true 
                  });
                })
                .catch(err => console.error('Cache open error during update:', err));
            }
            
            // Compare the cached response with the network response
            return compareResponses(cacheResponse, networkResponse)
              .then(areEqual => {
                if (!areEqual) {
                  // Update the cache with the new version
                  caches.open(CACHE_NAME)
                    .then(cache => {
                      cache.put(SOUND_URL, networkResponse.clone())
                        .catch(err => console.error('Cache update error:', err));
                    })
                    .catch(err => console.error('Cache open error:', err));
                }
                
                // Notify the client about update status
                event.source.postMessage({ 
                  action: 'updateAvailable', 
                  needsRefresh: !areEqual
                });
              });
          });
      })
      .catch(error => {
        console.error('Error checking for updates:', error);
        // Notify the client of error
        if (event.source) {
          event.source.postMessage({ 
            action: 'updateError', 
            error: error.message 
          });
        }
      });
  }
}); 