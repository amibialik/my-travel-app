// ============= Constants =============
export const STORAGE_KEY = 'mytravel-places';
export const GROUPS_KEY = 'mytravel-groups';
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
export const DEFAULT_CENTER = [31.5, 34.8]; // Israel center
export const DEFAULT_ZOOM = 7;

// Default groups for first visit
export const DEFAULT_GROUPS = [
    { id: 'grp-1', name: 'טיולים בישראל', color: '#2C4E72' },
    { id: 'grp-2', name: 'טרקים בחו"ל', color: '#E5B23A' }
];

// Demo places shown on first visit
export const DEMO_PLACES = [
    {
        id: 'demo-1',
        name: 'Ala Archa National Park',
        description: 'פארק לאומי מדהים בקירגיזסטן, ממוקם בהרי טיאן שאן. שפע של מסלולי הליכה ברמות קושי שונות, מפלי מים מרהיבים, ושלג על הפסגות גם בקיץ. מושלם לטרקים של יום או יומיים.',
        lat: 42.6500,
        lng: 74.4833,
        images: [],
        links: [
            { url: 'https://maps.google.com/?q=Ala+Archa+National+Park', label: 'Google Maps', type: 'google_maps' }
        ],
        groupId: 'grp-2',
        createdAt: Date.now()
    },
    {
        id: 'demo-2',
        name: 'Jyrgalan Valley',
        description: 'עמק ג\'ירגלן מציע נופים פרועים וחיים כפריים אותנטיים. מקום מושלם לרוכבי סוסים ולהאקים מרתקים בהרים, עם כפרים מרוחקים ואווירה ייחודית של קירגיזסטן.',
        lat: 42.8167,
        lng: 78.3333,
        images: [],
        links: [
            { url: 'https://maps.google.com/?q=Jyrgalan+Valley', label: 'Google Maps', type: 'google_maps' }
        ],
        groupId: 'grp-2',
        createdAt: Date.now()
    },
    {
        id: 'demo-3',
        name: 'Chunkurchak Gorge',
        description: 'אחר הרדי שכל לראשון עם משפחה מקים הרבים למסלול או פתיחה/סיום של הטיול.',
        lat: 42.7000,
        lng: 74.4000,
        images: [],
        links: [
            { url: 'https://maps.google.com/?q=Chunkurchak+Gorge', label: 'Google Maps', type: 'google_maps' }
        ],
        groupId: 'grp-2',
        createdAt: Date.now()
    }
];

// ============= Performance Helpers =============
export function debounce(fn, delay) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

export function throttle(fn, limit) {
    let lastCall = 0;
    return function(...args) {
        const now = Date.now();
        if (now - lastCall >= limit) {
            lastCall = now;
            return fn.apply(this, args);
        }
    };
}

// ============= State Variables =============
export let places = [];
export let groups = [];
export let activeGroupId = 'all'; 
export let activeSubGroupId = 'all'; 
export let map = null;
export let markers = [];
export let miniMap = null;
export let miniMapMarker = null;
export let editingPlaceId = null;
export let pendingImages = [];
export let deleteTargetId = null;
export let searchTimeout = null;
export let activeMarkerId = null;
export let pendingGpxData = null;
export let activePolylines = [];
export let placesService = null;
export let additionalGroupIds = [];
export let additionalSubGroupIds = [];
export let hoverMarker = null;
export let kmMarkers = [];
export let searchQuery = '';
export let markerClustererInstance = null;
export let slopeColoringEnabled = false;
export let slopePolylines = [];
export let kmMarkerMode = 'dynamic';
export let isTrackingUser = false;
export let userLocationMarker = null;
export let watchId = null;
export let leafletMap = null;
export let leafletPolylines = [];
export let leafletMarkers = [];
export let leafletUserMarker = null;
export let isOfflineMode = false;
export let leafletMarkerClusterer = null;

// Itinerary State
export let itineraries = [];
export let activeTrip = null;

// ============= State Setters (Required for ES Modules live binding updates) =============
export function setPlaces(val) { places = val; }
export function setGroups(val) { groups = val; }
export function setActiveGroupId(val) { activeGroupId = val; }
export function setActiveSubGroupId(val) { activeSubGroupId = val; }
export function setMap(val) { map = val; }
export function setMarkers(val) { markers = val; }
export function setMiniMap(val) { miniMap = val; }
export function setMiniMapMarker(val) { miniMapMarker = val; }
export function setEditingPlaceId(val) { editingPlaceId = val; }
export function setPendingImages(val) { pendingImages = val; }
export function setDeleteTargetId(val) { deleteTargetId = val; }
export function setSearchTimeout(val) { searchTimeout = val; }
export function setActiveMarkerId(val) { activeMarkerId = val; }
export function setPendingGpxData(val) { pendingGpxData = val; }
export function setActivePolylines(val) { activePolylines = val; }
export function setPlacesService(val) { placesService = val; }
export function setAdditionalGroupIds(val) { additionalGroupIds = val; }
export function setAdditionalSubGroupIds(val) { additionalSubGroupIds = val; }
export function setHoverMarker(val) { hoverMarker = val; }
export function setKmMarkers(val) { kmMarkers = val; }
export function setSearchQuery(val) { searchQuery = val; }
export function setMarkerClustererInstance(val) { markerClustererInstance = val; }
export function setSlopeColoringEnabled(val) { slopeColoringEnabled = val; }
export function setSlopePolylines(val) { slopePolylines = val; }
export function setKmMarkerMode(val) { kmMarkerMode = val; }
export function setIsTrackingUser(val) { isTrackingUser = val; }
export function setUserLocationMarker(val) { userLocationMarker = val; }
export function setWatchId(val) { watchId = val; }
export function setLeafletMap(val) { leafletMap = val; }
export function setLeafletPolylines(val) { leafletPolylines = val; }
export function setLeafletMarkers(val) { leafletMarkers = val; }
export function setLeafletUserMarker(val) { leafletUserMarker = val; }
export function setIsOfflineMode(val) { isOfflineMode = val; }
export function setLeafletMarkerClusterer(val) { leafletMarkerClusterer = val; }
export function setItineraries(val) { itineraries = val; }
export function setActiveTrip(val) { activeTrip = val; }

// ============= LocalStorage Operations =============
export function loadPlacesFromLocalStorage() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        places = JSON.parse(stored);
    } else {
        places = [...DEMO_PLACES];
        savePlaces();
    }
}

export function savePlaces() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(places));
}

export function loadGroupsFromLocalStorage() {
    const stored = localStorage.getItem(GROUPS_KEY);
    if (stored) {
        groups = JSON.parse(stored);
    } else {
        groups = [...DEFAULT_GROUPS];
        saveGroups();
    }
}

// Debounced Firebase sync helper
export const _syncGroupsToFirebase = debounce(() => {
    if (window.IS_FIREBASE_CONFIGURED && window.db) {
        groups.forEach(g => {
            window.db.collection('groups').doc(g.id).set(g)
                .catch(err => console.error('Error syncing group to Firebase:', err));
        });
    }
}, 600);

export function saveGroups() {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
    _syncGroupsToFirebase();
}

// ============= Helper Functions =============
export function generateId() {
    return 'place-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

export function generateGroupId() {
    return 'grp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
}

export function getGroupById(groupId) {
    return groups.find(g => g.id === groupId);
}

export function getGroupPlaceCount(groupId) {
    return places.filter(p => p.groupId === groupId).length;
}

export function getFilteredPlaces() {
    let result = [];
    if (activeGroupId === 'all') {
        result = [...places];
    } else {
        const allowedGroupIds = new Set();
        
        // 1. Add activeGroupId and its child groups
        if (activeSubGroupId !== 'all') {
            allowedGroupIds.add(activeSubGroupId);
            additionalSubGroupIds.forEach(id => {
                const sub = getGroupById(id);
                if (sub && sub.parentId === activeGroupId) {
                    allowedGroupIds.add(id);
                }
            });
        } else {
            allowedGroupIds.add(activeGroupId);
            groups.filter(g => g.parentId === activeGroupId).forEach(g => allowedGroupIds.add(g.id));
        }
        
        // 2. Add additionalGroupIds and their sub groups
        additionalGroupIds.forEach(mainId => {
            allowedGroupIds.add(mainId);
            groups.filter(g => g.parentId === mainId).forEach(g => allowedGroupIds.add(g.id));
        });
        
        // 3. Add additionalSubGroupIds from other groups
        additionalSubGroupIds.forEach(subId => {
            allowedGroupIds.add(subId);
        });
        
        result = places.filter(p => allowedGroupIds.has(p.groupId));
    }
    
    return result.sort((a, b) => (a.sortOrder ?? 99999) - (b.sortOrder ?? 99999));
}
