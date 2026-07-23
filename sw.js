const CACHE_NAME = 'bialik-travels-v14';
const ASSETS = [
  './',
  './index.html',
  './index.css',
  './firebase-config.js',
  './logo.jpg',
  './manifest.json',
  './js/state.js',
  './js/db.js',
  './js/map.js',
  './js/map-styles.js',
  './js/elevation.js',
  './js/roadbook.js',
  './js/animation.js',
  './js/ui.js',
  './js/itinerary.js',
  './js/app.js',
  'https://fonts.googleapis.com/css2?family=Amatic+SC:wght@400;700&family=Varela+Round&family=Caveat:wght@400;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js',
  'https://unpkg.com/@googlemaps/markerclusterer/dist/index.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

// Install Event - cache core assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[Service Worker] Caching static assets');
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event - clean up old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Clearing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Network first, fallback to cache for local assets
self.addEventListener('fetch', e => {
  // Only handle HTTP/HTTPS (ignore chrome-extension, etc.)
  if (!e.request.url.startsWith('http')) return;

  // Intercept Leaflet offline map tiles
  if (e.request.url.includes('tile.openstreetmap.org') || e.request.url.includes('tile.opentopomap.org')) {
    e.respondWith(
      caches.open('offline-tiles-cache').then(cache => {
        return cache.match(e.request).then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // If not in cache, fetch from network and cache dynamically if online
          return fetch(e.request).then(response => {
            if (response.status === 200) {
              cache.put(e.request, response.clone());
            }
            return response;
          }).catch(() => {
            // Return empty response for offline tile failure
            return new Response('', { status: 404 });
          });
        });
      })
    );
    return;
  }

  // For Google Maps API requests, we always fetch from network because it is dynamic
  if (e.request.url.includes('maps.googleapis.com') || e.request.url.includes('google.com/maps')) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Clone and save to cache if it's a successful response from our assets
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(e.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Offline fallback
        return caches.match(e.request).then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // If a page/file isn't in cache:
          if (e.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          // Return a valid offline 404 Response to prevent unhandled promise rejection
          return new Response('Not found', { status: 404, statusText: 'Not Found' });
        });
      })
  );
});
