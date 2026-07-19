/* ============================================================
   Travel Site - Application Logic
   Features: Map, Places CRUD, Search, Image Upload, Carousel
   Storage: localStorage (Firebase-ready)
   ============================================================ */

// ============= Constants =============
const STORAGE_KEY = 'mytravel-places';
const GROUPS_KEY = 'mytravel-groups';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const DEFAULT_CENTER = [31.5, 34.8]; // Israel center
const DEFAULT_ZOOM = 7;

// ============= Performance Helpers =============
/**
 * מחזיר פונקציה שמופעלת רק לאחר השהייה מהקריאה האחרונה.
 * @param {Function} fn - הפונקציה לבצע
 * @param {number} delay - השהייה במילישניות
 */
function debounce(fn, delay) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

/**
 * מחזיר פונקציה שמופעלת לכל היותר פעם אחת בתוך מסגרת הזמן הנתונה.
 * @param {Function} fn - הפונקציה לבצע
 * @param {number} limit - מינימום פרק זמן בין קריאות (מילישניות)
 */
function throttle(fn, limit) {
    let lastCall = 0;
    return function(...args) {
        const now = Date.now();
        if (now - lastCall >= limit) {
            lastCall = now;
            return fn.apply(this, args);
        }
    };
}

// Default groups for first visit
const DEFAULT_GROUPS = [
    { id: 'grp-1', name: 'טיולים בישראל', color: '#2C4E72' },
    { id: 'grp-2', name: 'טרקים בחו"ל', color: '#E5B23A' }
];

// Demo places shown on first visit
const DEMO_PLACES = [
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

// ============= State =============
let places = [];
let groups = [];
let activeGroupId = 'all'; // 'all' = show all
let activeSubGroupId = 'all'; // 'all' = show all sub-groups of active main group
let map = null;
let markers = [];
let miniMap = null;
let miniMapMarker = null;
let editingPlaceId = null;
let pendingImages = [];
let deleteTargetId = null;
let searchTimeout = null;
let activeMarkerId = null;
let pendingGpxData = null;
let activePolylines = [];
let placesService = null;
let additionalGroupIds = [];
let additionalSubGroupIds = [];
let hoverMarker = null;
let kmMarkers = [];
let searchQuery = '';
let markerClustererInstance = null;
let slopeColoringEnabled = false;
let slopePolylines = [];
let kmMarkerMode = 'dynamic';
let isTrackingUser = false;
let userLocationMarker = null;
let watchId = null;
let leafletMap = null;
let leafletPolylines = [];
let leafletMarkers = [];
let leafletUserMarker = null;
let isOfflineMode = false;
let leafletMarkerClusterer = null;

// ============= Storage / Sync =============
function loadPlaces() {
    if (window.IS_FIREBASE_CONFIGURED && window.db) {
        window.db.collection('places').onSnapshot(snapshot => {
            if (snapshot.empty) {
                // Check if we have them in localStorage
                const stored = localStorage.getItem(STORAGE_KEY);
                if (stored) {
                    places = JSON.parse(stored);
                    places.forEach(p => {
                        window.db.collection('places').doc(p.id).set(p);
                    });
                } else {
                    places = [...DEMO_PLACES];
                    places.forEach(p => {
                        window.db.collection('places').doc(p.id).set(p);
                    });
                }
            } else {
                places = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(places));
            renderPlaces();
            renderMarkers();
            drawAllGpxTracks();
        }, err => {
            logFirebaseError("Error loading places from Firebase:", err);
            loadPlacesFromLocalStorage();
        });
    } else {
        loadPlacesFromLocalStorage();
    }
}

function loadPlacesFromLocalStorage() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        places = JSON.parse(stored);
    } else {
        places = [...DEMO_PLACES];
        savePlaces();
    }
}

function savePlaces() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(places));
}

function syncPlaceToFirebase(place) {
    if (window.IS_FIREBASE_CONFIGURED && window.db && place && place.id) {
        window.db.collection('places').doc(place.id).set(place)
            .catch(err => console.error("Error syncing place to Firebase:", err));
    }
}

function loadGroups() {
    if (window.IS_FIREBASE_CONFIGURED && window.db) {
        window.db.collection('groups').onSnapshot(snapshot => {
            if (snapshot.empty) {
                const stored = localStorage.getItem(GROUPS_KEY);
                if (stored) {
                    groups = JSON.parse(stored);
                } else {
                    groups = [...DEFAULT_GROUPS];
                }
                groups.forEach(g => {
                    window.db.collection('groups').doc(g.id).set(g);
                });
            } else {
                groups = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            }
            localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
            renderGroupTabs();
            renderGroupSelect();
            renderGroupParentSelect();
        }, err => {
            logFirebaseError("Error loading groups from Firebase:", err);
            loadGroupsFromLocalStorage();
        });
    } else {
        loadGroupsFromLocalStorage();
    }
}

function loadGroupsFromLocalStorage() {
    const stored = localStorage.getItem(GROUPS_KEY);
    if (stored) {
        groups = JSON.parse(stored);
    } else {
        groups = [...DEFAULT_GROUPS];
        saveGroups();
    }
}

// Debounced Firebase sync for groups – prevents rapid sequential writes
const _syncGroupsToFirebase = debounce(() => {
    if (window.IS_FIREBASE_CONFIGURED && window.db) {
        groups.forEach(g => {
            window.db.collection('groups').doc(g.id).set(g)
                .catch(err => console.error('Error syncing group to Firebase:', err));
        });
    }
}, 600);

function saveGroups() {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
    _syncGroupsToFirebase();
}

function generateId() {
    return 'place-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

function generateGroupId() {
    return 'grp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
}

// ============= Groups =============
function getFilteredPlaces() {
    let result = [];
    if (activeGroupId === 'all') {
        result = [...places];
    } else {
        const allowedGroupIds = new Set();
        
        // 1. Add activeGroupId and its child groups
        if (activeSubGroupId !== 'all') {
            allowedGroupIds.add(activeSubGroupId);
            // Also allow additional sub groups of activeGroupId
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

function getGroupById(groupId) {
    return groups.find(g => g.id === groupId);
}

function getGroupPlaceCount(groupId) {
    return places.filter(p => p.groupId === groupId).length;
}

function addGroup(name, color, parentId = '', description = '') {
    const group = {
        id: generateGroupId(),
        name: name.trim(),
        color: color || '#0D9488',
        parentId: parentId || '',
        description: description.trim()
    };
    groups.push(group);
    saveGroups();
    renderGroupTabs();
    renderGroupSelect();
    renderGroupParentSelect();
    return group;
}

function deleteGroup(groupId, deletePlaces = false) {
    const childGroupIds = groups.filter(g => g.parentId === groupId).map(g => g.id);

    if (deletePlaces) {
        // Delete all places belonging to this group OR any of its sub-groups
        const deletedPlaceIds = places.filter(p => p.groupId === groupId || childGroupIds.includes(p.groupId)).map(p => p.id);
        places = places.filter(p => p.groupId !== groupId && !childGroupIds.includes(p.groupId));
        
        if (window.IS_FIREBASE_CONFIGURED && window.db) {
            deletedPlaceIds.forEach(id => {
                window.db.collection('places').doc(id).delete()
                    .catch(err => console.error("Error deleting place from Firebase:", err));
            });
            childGroupIds.forEach(id => {
                window.db.collection('groups').doc(id).delete()
                    .catch(err => console.error("Error deleting child group from Firebase:", err));
            });
        }
    } else {
        // Unassign places from this group
        places.forEach(p => {
            if (p.groupId === groupId) {
                p.groupId = '';
                if (window.IS_FIREBASE_CONFIGURED && window.db) {
                    window.db.collection('places').doc(p.id).update({ groupId: '' })
                        .catch(err => console.error("Error updating place group in Firebase:", err));
                }
            }
        });
        
        // Decouple child groups
        groups.forEach(g => {
            if (g.parentId === groupId) {
                g.parentId = '';
                if (window.IS_FIREBASE_CONFIGURED && window.db) {
                    window.db.collection('groups').doc(g.id).update({ parentId: '' })
                        .catch(err => console.error("Error updating child group parent in Firebase:", err));
                }
            }
        });
    }

    groups = groups.filter(g => g.id !== groupId);
    saveGroups();
    
    if (window.IS_FIREBASE_CONFIGURED && window.db) {
        window.db.collection('groups').doc(groupId).delete()
            .catch(err => console.error("Error deleting group from Firebase:", err));
    }

    if (activeGroupId === groupId) {
        activeGroupId = 'all';
    }
    if (activeSubGroupId === groupId || childGroupIds.includes(activeSubGroupId)) {
        activeSubGroupId = 'all';
    }

    renderGroupTabs();
    renderGroupSelect();
    renderGroupParentSelect();
    renderPlaces();
    renderMarkers();
    fitMapBounds();
    drawAllGpxTracks();
}

function renameGroup(groupId, newName) {
    const group = getGroupById(groupId);
    if (group) {
        group.name = newName.trim();
        saveGroups();
        renderGroupTabs();
        renderGroupSelect();
    }
}

function updateGroupDescription(groupId, newDesc) {
    const group = getGroupById(groupId);
    if (group) {
        group.description = newDesc.trim();
        saveGroups();
        renderPlaces();
    }
}

function changeGroupColor(groupId, newColor) {
    const group = getGroupById(groupId);
    if (group) {
        group.color = newColor;
        saveGroups();
        renderGroupTabs();
        renderGroupSelect();
        renderPlaces();
        renderMarkers();
        drawAllGpxTracks();
    }
}

// ============= Group UI =============
function renderGroupTabs() {
    const scroll = document.querySelector('.groups-scroll');
    if (!scroll) return;
    scroll.innerHTML = '';

    // "All" tab
    const allTab = document.createElement('button');
    allTab.className = 'group-tab' + (activeGroupId === 'all' ? ' active' : '');
    allTab.dataset.groupId = 'all';
    allTab.innerHTML = `<i class="fas fa-globe-americas"></i> הכל <span class="group-count">${places.length}</span>`;
    allTab.addEventListener('click', () => setActiveGroup('all'));
    scroll.appendChild(allTab);

    // Only render parent groups (groups with no parentId) in the main bar
    const parentGroups = groups.filter(g => !g.parentId);
    parentGroups.sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));
    
    parentGroups.forEach(group => {
        // Calculate count including child groups
        const childGroupIds = groups.filter(g => g.parentId === group.id).map(g => g.id);
        const count = places.filter(p => p.groupId === group.id || childGroupIds.includes(p.groupId)).length;

        const isSelected = activeGroupId === group.id;
        const isAdditional = additionalGroupIds.includes(group.id);
        const isActive = isSelected || isAdditional;

        const tab = document.createElement('button');
        tab.className = 'group-tab' + (isSelected ? ' active' : '') + (isAdditional ? ' additional-active' : '');
        tab.dataset.groupId = group.id;

        if (isSelected) {
            tab.style.background = group.color;
            tab.style.borderColor = group.color;
            tab.style.boxShadow = `0 2px 8px ${group.color}40`;
        } else if (isAdditional) {
            tab.style.background = `${group.color}18`;
            tab.style.borderColor = group.color;
            tab.style.borderStyle = 'dashed';
        } else {
            tab.style.background = '';
            tab.style.borderColor = '';
            tab.style.boxShadow = '';
            tab.style.borderStyle = '';
        }

        tab.innerHTML = `
            <span class="group-drag-handle" style="cursor: grab; margin-left: 6px; color: var(--text-muted); opacity: 0.5; padding: 2px;" title="גרור לשינוי סדר"><i class="fas fa-grip-vertical" style="font-size:10px;"></i></span>
            <span class="group-dot" style="background:${group.color}"></span>
            <span class="group-tab-text">${escapeHtml(group.name)}</span>
            <span class="group-count">${count}</span>
            <span class="group-toggle-visibility ${isAdditional ? 'active' : ''}" title="${isAdditional ? 'הסר קבוצה זו מהתצוגה' : 'הצג קבוצה זו בנוסף'}">
                <i class="${isActive ? 'fas fa-eye' : 'far fa-eye-slash'}"></i>
            </span>
        `;
        
        tab.addEventListener('click', (e) => {
            if (e.target.closest('.group-drag-handle')) {
                e.stopPropagation();
                e.preventDefault();
                return;
            }
            if (e.target.closest('.group-toggle-visibility')) {
                e.stopPropagation();
                toggleAdditionalGroup(group.id);
                return;
            }
            setActiveGroup(group.id);
        });
        scroll.appendChild(tab);
    });

    // Initialize drag-to-reorder for groups
    if (scroll && typeof Sortable !== 'undefined') {
        if (scroll.$sortable) {
            scroll.$sortable.destroy();
        }
        scroll.$sortable = new Sortable(scroll, {
            animation: 150,
            handle: '.group-drag-handle',
            filter: '[data-group-id="all"]',
            onEnd: (evt) => {
                const tabs = scroll.querySelectorAll('.group-tab[data-group-id]');
                const newOrder = Array.from(tabs)
                    .map(t => t.dataset.groupId)
                    .filter(id => id !== 'all');
                
                newOrder.forEach((id, idx) => {
                    const group = groups.find(g => g.id === id);
                    if (group) group.sortOrder = idx;
                });
                
                saveGroups();
                renderGroupSelect();
                renderGroupParentSelect();
            }
        });
    }

    // Render Sub-groups Bar
    renderSubGroupTabs();
}

function renderSubGroupTabs() {
    const subBar = document.getElementById('sub-groups-bar');
    const subScroll = document.getElementById('sub-groups-scroll');
    if (!subBar || !subScroll) return;

    if (activeGroupId === 'all') {
        subBar.style.display = 'none';
        return;
    }

    const subGroups = groups.filter(g => g.parentId === activeGroupId);
    subGroups.sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));
    if (subGroups.length === 0) {
        subBar.style.display = 'none';
        return;
    }

    subBar.style.display = 'flex';
    subScroll.innerHTML = '';

    const parentGroup = getGroupById(activeGroupId);
    const parentColor = parentGroup ? parentGroup.color : '#2C4E72';

    // "All in parent" tab
    const allSubTab = document.createElement('button');
    allSubTab.className = 'sub-group-tab' + (activeSubGroupId === 'all' ? ' active' : '');
    allSubTab.dataset.groupId = 'all';
    
    // Count for parent group + all its sub groups
    const childGroupIds = subGroups.map(g => g.id);
    const totalCount = places.filter(p => p.groupId === activeGroupId || childGroupIds.includes(p.groupId)).length;

    if (activeSubGroupId === 'all') {
        allSubTab.style.background = parentColor;
        allSubTab.style.borderColor = parentColor;
    } else {
        allSubTab.style.background = '';
        allSubTab.style.borderColor = '';
    }

    allSubTab.innerHTML = `הכל ב-${escapeHtml(parentGroup?.name || '')} <span class="sub-group-count">${totalCount}</span>`;
    allSubTab.addEventListener('click', () => setActiveSubGroup('all'));
    subScroll.appendChild(allSubTab);

    // Sub-group tabs
    subGroups.forEach(sub => {
        const count = getGroupPlaceCount(sub.id);
        const isSelected = activeSubGroupId === sub.id;
        const isAdditional = additionalSubGroupIds.includes(sub.id);
        const isActive = isSelected || isAdditional;

        const tab = document.createElement('button');
        tab.className = 'sub-group-tab' + (isSelected ? ' active' : '') + (isAdditional ? ' additional-active' : '');
        tab.dataset.groupId = sub.id;

        if (isSelected) {
            tab.style.background = sub.color;
            tab.style.borderColor = sub.color;
        } else if (isAdditional) {
            tab.style.background = `${sub.color}15`;
            tab.style.borderColor = sub.color;
            tab.style.borderStyle = 'dashed';
        } else {
            tab.style.background = '';
            tab.style.borderColor = '';
            tab.style.borderStyle = '';
        }

        tab.innerHTML = `
            <span class="sub-group-drag-handle" style="cursor: grab; margin-left: 6px; color: var(--text-muted); opacity: 0.5; padding: 2px;" title="גרור לשינוי סדר"><i class="fas fa-grip-vertical" style="font-size:10px;"></i></span>
            <span class="sub-group-dot" style="background:${sub.color}"></span>
            <span class="sub-group-tab-text">${escapeHtml(sub.name)}</span>
            <span class="sub-group-count">${count}</span>
            <span class="sub-group-toggle-visibility ${isAdditional ? 'active' : ''}" title="${isAdditional ? 'הסר מקטע זה מהתצוגה' : 'הצג מקטע זה בנוסף'}">
                <i class="${isActive ? 'fas fa-eye' : 'far fa-eye-slash'}"></i>
            </span>
        `;
        
        tab.addEventListener('click', (e) => {
            if (e.target.closest('.sub-group-drag-handle')) {
                e.stopPropagation();
                e.preventDefault();
                return;
            }
            if (e.target.closest('.sub-group-toggle-visibility')) {
                e.stopPropagation();
                toggleAdditionalSubGroup(sub.id);
                return;
            }
            setActiveSubGroup(sub.id);
        });
        subScroll.appendChild(tab);
    });

    // Initialize drag-to-reorder for sub groups
    if (subScroll && typeof Sortable !== 'undefined') {
        if (subScroll.$sortable) {
            subScroll.$sortable.destroy();
        }
        subScroll.$sortable = new Sortable(subScroll, {
            animation: 150,
            handle: '.sub-group-drag-handle',
            filter: '[data-group-id="all"]',
            onEnd: (evt) => {
                const tabs = subScroll.querySelectorAll('.sub-group-tab[data-group-id]');
                const newOrder = Array.from(tabs)
                    .map(t => t.dataset.groupId)
                    .filter(id => id !== 'all');
                
                newOrder.forEach((id, idx) => {
                    const group = groups.find(g => g.id === id);
                    if (group) group.sortOrder = idx;
                });
                
                saveGroups();
                renderGroupSelect();
                renderGroupParentSelect();
            }
        });
    }
}

function setActiveGroup(groupId) {
    activeGroupId = groupId;
    activeSubGroupId = 'all'; // reset sub-group when changing main group
    additionalGroupIds = [];
    additionalSubGroupIds = [];
    
    if (activePolylines) {
        activePolylines.forEach(p => p.setMap(null));
        activePolylines = [];
    }
    
    renderGroupTabs();
    renderPlaces();
    renderMarkers();
    fitMapBounds();
    drawAllGpxTracks();
}

function setActiveSubGroup(subGroupId) {
    activeSubGroupId = subGroupId;
    additionalSubGroupIds = [];
    
    if (activePolylines) {
        activePolylines.forEach(p => p.setMap(null));
        activePolylines = [];
    }

    renderGroupTabs();
    renderPlaces();
    renderMarkers();
    fitMapBounds();
    drawAllGpxTracks();
}

function toggleAdditionalGroup(groupId) {
    if (groupId === activeGroupId) return; // Cannot toggle active group
    
    const index = additionalGroupIds.indexOf(groupId);
    if (index !== -1) {
        additionalGroupIds.splice(index, 1);
    } else {
        additionalGroupIds.push(groupId);
    }
    
    if (activePolylines) {
        activePolylines.forEach(p => p.setMap(null));
        activePolylines = [];
    }
    
    renderGroupTabs();
    renderPlaces();
    renderMarkers();
    fitMapBounds();
    drawAllGpxTracks();
}

function toggleAdditionalSubGroup(subGroupId) {
    if (subGroupId === activeSubGroupId) return; // Cannot toggle active sub-group
    
    const index = additionalSubGroupIds.indexOf(subGroupId);
    if (index !== -1) {
        additionalSubGroupIds.splice(index, 1);
    } else {
        additionalSubGroupIds.push(subGroupId);
    }
    
    if (activePolylines) {
        activePolylines.forEach(p => p.setMap(null));
        activePolylines = [];
    }
    
    renderGroupTabs();
    renderPlaces();
    renderMarkers();
    fitMapBounds();
    drawAllGpxTracks();
}

function renderGroupSelect() {
    const select = document.getElementById('place-group');
    if (!select) return;

    // Keep current value
    const currentValue = select.value;
    select.innerHTML = '<option value="">ללא קבוצה</option>';

    // Get parent groups (groups with no parentId)
    const parentGroups = groups.filter(g => !g.parentId);

    parentGroups.forEach(parent => {
        const option = document.createElement('option');
        option.value = parent.id;
        option.textContent = parent.name;
        select.appendChild(option);

        // Get and render sub-groups of this parent
        const subGroups = groups.filter(g => g.parentId === parent.id);
        subGroups.forEach(sub => {
            const subOption = document.createElement('option');
            subOption.value = sub.id;
            subOption.textContent = `    └── ${sub.name}`;
            select.appendChild(subOption);
        });
    });

    // Handle any orphan sub-groups
    const orphans = groups.filter(g => g.parentId && !groups.some(pg => pg.id === g.parentId));
    orphans.forEach(orphan => {
        const option = document.createElement('option');
        option.value = orphan.id;
        option.textContent = orphan.name;
        select.appendChild(option);
    });

    select.value = currentValue;
}

function renderGroupParentSelect() {
    const parentSelect = document.getElementById('new-group-parent');
    if (!parentSelect) return;

    // Filter to only parent groups
    const parentGroups = groups.filter(g => !g.parentId);

    parentSelect.innerHTML = '<option value="">ללא קבוצת אם (קבוצה ראשית)</option>';
    parentGroups.forEach(parent => {
        const option = document.createElement('option');
        option.value = parent.id;
        option.textContent = parent.name;
        parentSelect.appendChild(option);
    });
}

// Hierarchy Helper Functions
function isDescendantOf(candidateParentId, targetGroupId) {
    if (!candidateParentId || !targetGroupId) return false;
    let current = groups.find(g => g.id === candidateParentId);
    while (current) {
        if (current.parentId === targetGroupId) return true;
        current = current.parentId ? groups.find(g => g.id === current.parentId) : null;
    }
    return false;
}

function getGroupLevel(groupId) {
    let level = 0;
    let current = groups.find(g => g.id === groupId);
    while (current && current.parentId) {
        level++;
        current = groups.find(g => g.id === current.parentId);
    }
    return level;
}

function getParentOptionsHtml(groupId, currentParentId) {
    let html = '';
    groups.forEach(g => {
        if (g.id === groupId) return;
        if (isDescendantOf(g.id, groupId)) return; // Prevent circular references
        
        const level = getGroupLevel(g.id);
        const prefix = '&nbsp;&nbsp;'.repeat(level) + '📁 ';
        html += `<option value="${g.id}" ${g.id === currentParentId ? 'selected' : ''}>${prefix}${escapeHtml(g.name)}</option>`;
    });
    return html;
}

function updateGroupParent(groupId, newParentId) {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    
    group.parentId = newParentId || null;
    saveGroups();
    
    // Sync to Firebase if configured
    if (window.IS_FIREBASE_CONFIGURED && window.db) {
        window.db.collection('groups').doc(groupId).update({ parentId: group.parentId })
            .catch(err => console.error("Error updating group parent in Firebase:", err));
    }
    
    renderGroupManageList();
    renderGroupTabs();
    renderPlaces();
    renderMarkers();
    drawAllGpxTracks();
    showToast(`הקבוצה "${group.name}" הועברה בהצלחה!`, 'success');
}

function renderGroupManageList() {
    const list = document.getElementById('groups-manage-list');
    list.innerHTML = '';

    if (groups.length === 0) {
        list.innerHTML = '<p style="text-align:center; color:var(--text-tertiary); padding:20px; font-size:14px;">אין קבוצות עדיין. צור קבוצה חדשה למעלה.</p>';
        return;
    }

    // Find root groups (those without parents, or whose parents do not exist in groups)
    const rootGroups = groups.filter(g => !g.parentId || !groups.some(parent => parent.id === g.parentId));
    rootGroups.sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));

    // Render recursively
    rootGroups.forEach(group => {
        renderGroupNode(group, 0, list);
    });

    // Initialize drag-to-reorder for groups list in modal
    if (list && typeof Sortable !== 'undefined') {
        if (list.$sortable) {
            list.$sortable.destroy();
        }
        list.$sortable = new Sortable(list, {
            animation: 150,
            handle: '.group-manage-drag-handle',
            onEnd: (evt) => {
                const items = list.querySelectorAll('.group-manage-item');
                const newOrder = Array.from(items).map(item => item.dataset.groupId);
                
                newOrder.forEach((id, idx) => {
                    const group = groups.find(g => g.id === id);
                    if (group) group.sortOrder = idx;
                });
                
                saveGroups();
                renderGroupTabs();
                renderGroupSelect();
                renderGroupParentSelect();
                renderGroupManageList(); // Re-render to update connection indentation
            }
        });
    }
}

function renderGroupNode(group, level, container) {
    const count = getGroupPlaceCount(group.id);
    const item = document.createElement('div');
    item.className = 'group-manage-item';
    item.dataset.groupId = group.id;
    
    // Indent nested groups and add connection lines
    if (level > 0) {
        item.classList.add('group-manage-item-nested');
        item.style.marginRight = `${level * 28}px`; // Indent based on level (RTL)
    }

    item.innerHTML = `
        <div class="group-manage-drag-handle" style="cursor: grab; color: var(--text-muted); opacity: 0.5; padding: 0 4px; display: flex; align-items: center; font-size: 11px;" title="גרור לשינוי סדר"><i class="fas fa-grip-vertical"></i></div>
        <input type="color" class="group-manage-color" value="${group.color}" data-group-id="${group.id}" title="שנה צבע קבוצה">
        <div class="group-manage-name">
            <div class="group-manage-header-row">
                <input type="text" class="group-manage-name-input" value="${escapeHtml(group.name)}" data-group-id="${group.id}">
                <select class="group-manage-parent-select" title="קבוצת אם">
                    <option value="">(ללא - קבוצה ראשית)</option>
                    ${getParentOptionsHtml(group.id, group.parentId)}
                </select>
            </div>
            <input type="text" class="group-manage-desc-input" placeholder="תיאור כללי של הטרק..." value="${escapeHtml(group.description || '')}" data-group-id="${group.id}">
        </div>
        <span class="group-manage-count">${count} מקומות</span>
        <div class="group-manage-actions">
            <button class="group-delete-btn" data-group-id="${group.id}" title="מחק קבוצה">
                <i class="fas fa-trash-alt"></i>
            </button>
        </div>
    `;

    // Change color
    const colorInput = item.querySelector('.group-manage-color');
    colorInput.addEventListener('change', (e) => {
        changeGroupColor(group.id, e.target.value);
    });

    // Rename on blur/enter
    const nameInput = item.querySelector('.group-manage-name-input');
    nameInput.addEventListener('blur', () => {
        if (nameInput.value.trim()) {
            renameGroup(group.id, nameInput.value);
        }
    });
    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') nameInput.blur();
    });

    // Update description on blur/enter
    const descInput = item.querySelector('.group-manage-desc-input');
    descInput.addEventListener('blur', () => {
        updateGroupDescription(group.id, descInput.value);
    });
    descInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') descInput.blur();
    });

    // Parent group select change
    const parentSelect = item.querySelector('.group-manage-parent-select');
    parentSelect.addEventListener('change', (e) => {
        updateGroupParent(group.id, e.target.value);
    });

    // Delete
    item.querySelector('.group-delete-btn').addEventListener('click', () => {
        const childGroupIds = groups.filter(g => g.parentId === group.id).map(g => g.id);
        const totalCount = places.filter(p => p.groupId === group.id || childGroupIds.includes(p.groupId)).length;

        if (confirm(`האם אתה בטוח שברצונך למחוק את הקבוצה "${group.name}"?`)) {
            let deleteAssociatedPlaces = false;
            if (totalCount > 0) {
                deleteAssociatedPlaces = confirm(
                    `הקבוצה מכילה ${totalCount} מיקומים/ימים.\n\n` +
                    `לחץ על "אישור" כדי למחוק את הקבוצה יחד עם כל המקומות השייכים אליה לצמיתות.\n` +
                    `לחץ על "ביטול" כדי למחוק את הקבוצה בלבד (המקומות יישארו ויועברו ל"ללא קבוצה").`
                );
            }
            deleteGroup(group.id, deleteAssociatedPlaces);
            renderGroupManageList();
            showToast(`הקבוצה ${deleteAssociatedPlaces ? 'וכל המקומות בה נמחקו' : 'נמחקה'} בהצלחה!`, 'success');
        }
    });

    container.appendChild(item);

    // Recursively render children of this node
    const children = groups.filter(g => g.parentId === group.id);
    children.sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));
    children.forEach(child => {
        renderGroupNode(child, level + 1, container);
    });
}

function openGroupsModal() {
    const overlay = document.getElementById('groups-modal-overlay');
    renderGroupManageList();
    renderGroupParentSelect();
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    document.getElementById('new-group-name').focus();
}

function closeGroupsModal() {
    const overlay = document.getElementById('groups-modal-overlay');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
}

const customMapStyle = [
    {
        "featureType": "all",
        "elementType": "geometry.stroke",
        "stylers": [
            { "color": "#e7dfce" }
        ]
    },
    {
        "featureType": "administrative.country",
        "elementType": "geometry.stroke",
        "stylers": [
            { "color": "#a2927c" },
            { "weight": 1.5 }
        ]
    },
    {
        "featureType": "landscape",
        "elementType": "geometry.fill",
        "stylers": [
            { "color": "#f9f6f0" }
        ]
    },
    {
        "featureType": "water",
        "elementType": "geometry.fill",
        "stylers": [
            { "color": "#d6e6f2" }
        ]
    },
    {
        "featureType": "road",
        "elementType": "geometry.fill",
        "stylers": [
            { "color": "#ffffff" }
        ]
    },
    {
        "featureType": "road",
        "elementType": "geometry.stroke",
        "stylers": [
            { "color": "#ebdcc5" }
        ]
    },
    {
        "featureType": "poi",
        "elementType": "geometry.fill",
        "stylers": [
            { "color": "#f0ede4" }
        ]
    }
];

const darkMapStyle = [
    { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
    { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#4b6878' }] },
    { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#1d3d5c' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#283d6a' }] },
    { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#6f9ba5' }] },
    { featureType: 'poi.park', elementType: 'geometry.fill', stylers: [{ color: '#1a4435' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
    { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#98a5be' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2c6675' }] },
    { featureType: 'transit', elementType: 'labels.text.fill', stylers: [{ color: '#98a5be' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4e6d70' }] }
];

// ============= Map =============
function initMap() {
    const isDark = localStorage.getItem('theme') === 'dark';
    const isMobile = window.innerWidth <= 900;
    const mapOptions = {
        center: { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] },
        zoom: DEFAULT_ZOOM,
        zoomControl: !isMobile,
        mapTypeControl: false,
        streetViewControl: !isMobile,
        fullscreenControl: false,
        styles: isDark ? darkMapStyle : customMapStyle
    };
    map = new google.maps.Map(document.getElementById('map'), mapOptions);

    map.addListener('zoom_changed', () => {
        if (kmMarkerMode === 'dynamic') {
            drawKmMarkers();
        }
    });

    // Disable CSS sepia filter in satellite or hybrid views
    map.addListener('maptypeid_changed', () => {
        const type = map.getMapTypeId();
        const mapEl = document.getElementById('map');
        if (type === 'satellite' || type === 'hybrid') {
            mapEl.classList.add('no-filter');
        } else {
            mapEl.classList.remove('no-filter');
        }
    });

    // Disable CSS sepia filter in Street View mode
    const panorama = map.getStreetView();
    if (panorama) {
        panorama.addListener('visible_changed', () => {
            const mapEl = document.getElementById('map');
            if (panorama.getVisible()) {
                mapEl.classList.add('no-filter');
            } else {
                // Restore filter unless they are in satellite mode
                const type = map.getMapTypeId();
                if (type !== 'satellite' && type !== 'hybrid') {
                    mapEl.classList.remove('no-filter');
                }
            }
        });
    }

    // Initialize PlacesService
    placesService = new google.maps.places.PlacesService(map);

    // Click on map to show rich Google Place details for POIs
    map.addListener('click', (e) => {
        if (e.placeId) {
            e.stop();
            showGooglePlaceDetails(e.placeId);
        } else {
            closeGooglePlacePanel();
        }
    });

    // Set up OpenStreetMap, Israel Hiking Map, and OpenTopoMap layers
    const osmMapType = new google.maps.ImageMapType({
        getTileUrl: function(coord, zoom) {
            return "https://tile.openstreetmap.org/" + zoom + "/" + coord.x + "/" + coord.y + ".png";
        },
        tileSize: new google.maps.Size(256, 256),
        name: "OSM",
        maxZoom: 19
    });
    map.mapTypes.set('osm', osmMapType);

    const ihmMapType = new google.maps.ImageMapType({
        getTileUrl: function(coord, zoom) {
            return "https://tiles.israelhiking.osm.org.il/hiking/" + zoom + "/" + coord.x + "/" + coord.y + ".png";
        },
        tileSize: new google.maps.Size(256, 256),
        name: "IHM",
        maxZoom: 17
    });
    map.mapTypes.set('israel-hiking', ihmMapType);

    const topoMapType = new google.maps.ImageMapType({
        getTileUrl: function(coord, zoom) {
            return "https://a.tile.opentopomap.org/" + zoom + "/" + coord.x + "/" + coord.y + ".png";
        },
        tileSize: new google.maps.Size(256, 256),
        name: "Topo",
        maxZoom: 17
    });
    map.mapTypes.set('opentopo', topoMapType);

    const cyclOsmMapType = new google.maps.ImageMapType({
        getTileUrl: function(coord, zoom) {
            // CyclOSM – מפת אופניים ואופני הר מבוססת OSM
            const servers = ['a', 'b', 'c'];
            const s = servers[Math.abs(coord.x + coord.y) % servers.length];
            return `https://${s}.tile-cyclosm.openstreetmap.fr/cyclosm/${zoom}/${coord.x}/${coord.y}.png`;
        },
        tileSize: new google.maps.Size(256, 256),
        name: 'CyclOSM',
        maxZoom: 20,
        attribution: '\u00a9 CyclOSM contributors, \u00a9 OpenStreetMap contributors'
    });
    map.mapTypes.set('cyclosm', cyclOsmMapType);

    // Waymarked Trails Hiking – שכבת-על (overlay) שמוסיפים על כל מפה בסיסית
    const waymarkedHikingOverlay = new google.maps.ImageMapType({
        getTileUrl: function(coord, zoom) {
            return `https://tile.waymarkedtrails.org/hiking/${zoom}/${coord.x}/${coord.y}.png`;
        },
        tileSize: new google.maps.Size(256, 256),
        name: 'Waymarked Hiking',
        maxZoom: 19,
        opacity: 0.85
    });
    // Store overlay reference on map for toggling
    map._waymarkedHikingOverlay = waymarkedHikingOverlay;

    // Map Layer Controller UI bindings
    const layerToggleBtn = document.getElementById('layer-toggle-btn');
    const layerController = document.getElementById('map-layer-controller');
    if (layerToggleBtn && layerController) {
        layerToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            layerController.classList.toggle('active');
        });
        
        document.addEventListener('click', () => {
            layerController.classList.remove('active');
        });
        
        const options = layerController.querySelectorAll('.layer-option');
        options.forEach(opt => {
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                
                const layer = opt.dataset.layer;
                if (layer === 'slope-colors') {
                    slopeColoringEnabled = !slopeColoringEnabled;
                    const toggleLabel = opt.querySelector('.overlay-toggle-label');
                    if (slopeColoringEnabled) {
                        opt.classList.add('active');
                        if (toggleLabel) toggleLabel.textContent = 'פעיל';
                        drawSlopeColoredTracks();
                    } else {
                        opt.classList.remove('active');
                        if (toggleLabel) toggleLabel.textContent = 'כבוי';
                        slopePolylines.forEach(p => p.setMap(null));
                        slopePolylines = [];
                    }
                    // אל תסגור את התפריט לשכבות-על
                    return;
                }
                
                options.forEach(o => {
                    // אל תנקה את ה-active של slope-colors ו-waymarked-hiking (הם toggles עצמאיים)
                    if (o.dataset.layer !== 'slope-colors' && o.dataset.layer !== 'waymarked-hiking') {
                        o.classList.remove('active');
                    }
                });
                opt.classList.add('active');
                
                if (layer === 'roadmap') {
                    map.setMapTypeId(google.maps.MapTypeId.ROADMAP);
                } else if (layer === 'terrain') {
                    map.setMapTypeId(google.maps.MapTypeId.TERRAIN);
                } else if (layer === 'satellite') {
                    map.setMapTypeId(google.maps.MapTypeId.SATELLITE);
                } else if (layer === 'hybrid') {
                    map.setMapTypeId(google.maps.MapTypeId.HYBRID);
                } else if (layer === 'osm') {
                    map.setMapTypeId('osm');
                } else if (layer === 'israel-hiking') {
                    map.setMapTypeId('israel-hiking');
                } else if (layer === 'opentopo') {
                    map.setMapTypeId('opentopo');
                } else if (layer === 'cyclosm') {
                    map.setMapTypeId('cyclosm');
                } else if (layer === 'waymarked-hiking') {
                    // Waymarked Trails הוא overlay – toggle על המפה הנוכחית
                    const overlays = map.overlayMapTypes;
                    const existingIdx = overlays.getArray().findIndex(
                        o => o && o.name === 'Waymarked Hiking'
                    );
                    const toggleLabel = opt.querySelector('.overlay-toggle-label');
                    if (existingIdx !== -1) {
                        // כבר פעיל – הסר
                        overlays.removeAt(existingIdx);
                        opt.classList.remove('active');
                        if (toggleLabel) toggleLabel.textContent = 'כבוי';
                    } else {
                        // הוסף overlay
                        overlays.push(map._waymarkedHikingOverlay);
                        opt.classList.add('active');
                        if (toggleLabel) toggleLabel.textContent = 'פעיל';
                    }
                    // אל תסגור את התפריט לשכבות-על
                    return; // אל תבצע את הלוגיקה של active/non-active הרגילה
                }
                layerController.classList.remove('active');
            });
        });

        const kmSelect = document.getElementById('km-marker-mode');
        if (kmSelect) {
            kmSelect.addEventListener('change', (e) => {
                kmMarkerMode = e.target.value;
                drawKmMarkers();
            });
        }
    }

    // Fit to markers after initial load
    setTimeout(() => fitMapBounds(), 300);
}

function renderMarkers() {
    if (typeof google === 'undefined' || !google.maps) return;
    // Clear existing markers
    markers.forEach(m => m.setMap(null));
    markers = [];

    if (markerClustererInstance) {
        markerClustererInstance.clearMarkers();
    }

    const filtered = getFilteredPlaces();
    const hasClusterer = typeof markerClusterer !== 'undefined' && markerClusterer.MarkerClusterer;

    filtered.forEach((place, index) => {
        const group = getGroupById(place.groupId);
        const markerColor = getPlaceColor(place);

        const marker = new google.maps.Marker({
            position: { lat: place.lat, lng: place.lng },
            map: hasClusterer ? null : map,
            title: place.name,
            label: {
                text: place.customLabel || String(index + 1),
                color: '#FDFBF7',
                fontSize: '12px',
                fontWeight: 'bold',
                fontFamily: 'Varela Round, sans-serif'
            },
            icon: {
                path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z",
                fillColor: markerColor,
                fillOpacity: 1,
                strokeWeight: 2,
                strokeColor: '#E5B23A',
                scale: 1.5,
                anchor: new google.maps.Point(12, 22),
                labelOrigin: new google.maps.Point(12, 9)
            }
        });

        const infoWindow = new google.maps.InfoWindow({
            content: `
                <div style="text-align:right; direction:rtl; min-width:180px; font-family:'Varela Round', sans-serif; padding: 4px;">
                    <strong style="color:${markerColor}; font-size:15px;">${escapeHtml(place.name)}</strong>
                    ${group ? `<div style="font-size:11.5px; color:#92999E; margin-top:2px; font-weight:bold;">★ ${escapeHtml(group.name)}</div>` : ''}
                    ${place.description ? `<p style="margin:8px 0 0; font-size:13px; color:#5C6266; line-height:1.5;">${escapeHtml(place.description).substring(0, 80)}${place.description.length > 80 ? '...' : ''}</p>` : ''}
                </div>
            `
        });

        marker.addListener('click', () => {
            const placeGroup = getGroupById(place.groupId);
            if (activeGroupId !== 'all' && placeGroup && placeGroup.parentId && activeSubGroupId === 'all') {
                setActiveSubGroup(placeGroup.id);
            }
            scrollToCard(place.id);
            setActiveMarker(place.id, true);
            infoWindow.open(map, marker);
        });

        marker.placeId = place.id;
        markers.push(marker);
    });

    if (hasClusterer && markers.length > 0) {
        markerClustererInstance = new markerClusterer.MarkerClusterer({
            map: map,
            markers: markers,
            renderer: {
                render: ({ count, position }) => new google.maps.Marker({
                    position,
                    label: { text: String(count), color: '#FDFBF7', fontSize: '12px', fontWeight: 'bold', fontFamily: 'Varela Round, sans-serif' },
                    icon: {
                        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42"><circle cx="21" cy="21" r="19" fill="#2C4E72" stroke="#E5B23A" stroke-width="2.5"/><circle cx="21" cy="21" r="15" fill="#2C4E72" opacity="0.8"/></svg>`),
                        scaledSize: new google.maps.Size(42, 42),
                        anchor: new google.maps.Point(21, 21),
                        labelOrigin: new google.maps.Point(21, 21)
                    },
                    zIndex: 1000 + count
                })
            }
        });
    }
}

function fitMapBounds() {
    const filtered = getFilteredPlaces();
    if (filtered.length === 0 || markers.length === 0) {
        map.setCenter({ lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] });
        map.setZoom(DEFAULT_ZOOM);
        return;
    }
    if (markers.length === 1) {
        map.setCenter(markers[0].getPosition());
        map.setZoom(12);
        return;
    }
    const bounds = new google.maps.LatLngBounds();
    markers.forEach(m => bounds.extend(m.getPosition()));
    map.fitBounds(bounds);
}

function setActiveMarker(placeId, forceExpand = false) {
    if (!forceExpand && activeMarkerId === placeId) {
        activeMarkerId = null;
        renderMarkers();
        document.querySelectorAll('.place-card').forEach(card => {
            card.classList.remove('highlighted');
        });
        drawAllGpxTracks();
        return;
    }

    activeMarkerId = placeId;
    renderMarkers();

    // Highlight card
    document.querySelectorAll('.place-card').forEach(card => {
        card.classList.remove('highlighted');
        if (card.dataset.id === placeId) {
            card.classList.add('highlighted');
        }
    });

    drawAllGpxTracks();
}

function scrollToCard(placeId) {
    const card = document.querySelector(`.place-card[data-id="${placeId}"]`);
    if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('highlighted');
        setTimeout(() => {
            if (activeMarkerId !== placeId) {
                card.classList.remove('highlighted');
            }
        }, 2000);
    }
}

function panToPlace(latOrPlace, lng) {
    let lat, lngVal, place;
    
    if (typeof latOrPlace === 'object' && latOrPlace !== null) {
        place = latOrPlace;
        lat = place.lat;
        lngVal = place.lng;
    } else {
        lat = latOrPlace;
        lngVal = lng;
        if (typeof places !== 'undefined') {
            place = places.find(p => p.lat === lat && p.lng === lngVal);
        }
    }
    
    const hasGpx = place && place.gpxData && place.gpxData.length > 0;
    
    if (isOfflineMode) {
        if (typeof L !== 'undefined' && leafletMap) {
            if (hasGpx) {
                const bounds = L.latLngBounds(place.gpxData.map(pt => [pt.lat, pt.lng]));
                leafletMap.fitBounds(bounds, { padding: [40, 40] });
            } else if (lat && lngVal) {
                leafletMap.panTo([lat, lngVal]);
                leafletMap.setZoom(15);
            }
        }
    } else if (map) {
        if (hasGpx) {
            const bounds = new google.maps.LatLngBounds();
            place.gpxData.forEach(pt => bounds.extend({ lat: pt.lat, lng: pt.lng }));
            map.fitBounds(bounds);
        } else if (lat && lngVal) {
            map.panTo({ lat: lat, lng: lngVal });
            map.setZoom(15);
        }
    }
}

// ============= GPX Processing =============
function parseGpxFile(file, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const parser = new DOMParser();
            const xml = parser.parseFromString(e.target.result, "text/xml");
            
            // Extract track points <trkpt>
            const trackpoints = xml.querySelectorAll('trkpt');
            const points = [];
            
            trackpoints.forEach(pt => {
                const lat = parseFloat(pt.getAttribute('lat'));
                const lng = parseFloat(pt.getAttribute('lon'));
                const eleNode = pt.querySelector('ele');
                const ele = eleNode ? parseFloat(eleNode.textContent) : null;
                if (!isNaN(lat) && !isNaN(lng)) {
                    points.push({ lat: lat, lng: lng, ele: ele });
                }
            });
            
            // If no trkpt, try route points <rtept>
            if (points.length === 0) {
                const routepoints = xml.querySelectorAll('rtept');
                routepoints.forEach(pt => {
                    const lat = parseFloat(pt.getAttribute('lat'));
                    const lng = parseFloat(pt.getAttribute('lon'));
                    const eleNode = pt.querySelector('ele');
                    const ele = eleNode ? parseFloat(eleNode.textContent) : null;
                    if (!isNaN(lat) && !isNaN(lng)) {
                        points.push({ lat: lat, lng: lng, ele: ele });
                    }
                });
            }
            
            // If still no points, try waypoints <wpt>
            if (points.length === 0) {
                const waypoints = xml.querySelectorAll('wpt');
                waypoints.forEach(pt => {
                    const lat = parseFloat(pt.getAttribute('lat'));
                    const lng = parseFloat(pt.getAttribute('lon'));
                    const eleNode = pt.querySelector('ele');
                    const ele = eleNode ? parseFloat(eleNode.textContent) : null;
                    if (!isNaN(lat) && !isNaN(lng)) {
                        points.push({ lat: lat, lng: lng, ele: ele });
                    }
                });
            }
            
            if (points.length === 0) {
                callback(null, 'לא נמצאו נקודות GPS תקינות בקובץ ה-GPX');
            } else {
                const processed = processGpxData(points);
                callback(processed, null);
            }
        } catch (error) {
            console.error('GPX parse error:', error);
            callback(null, 'שגיאה בפענוח קובץ ה-GPX');
        }
    };
    reader.onerror = () => callback(null, 'שגיאה בקריאת הקובץ');
    reader.readAsText(file);
}

function processGpxData(points) {
    if (!points || points.length === 0) return [];
    
    let cumulativeDist = 0;
    const processed = [];
    
    function getDistance(lat1, lng1, lat2, lng2) {
        const R = 6371; // Earth radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
    
    for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        if (i > 0) {
            const prev = points[i - 1];
            const d = getDistance(prev.lat, prev.lng, pt.lat, pt.lng);
            cumulativeDist += d;
        }
        
        let slope = 0;
        if (i > 0 && pt.ele !== null && points[i - 1].ele !== null) {
            const prev = points[i - 1];
            const dEle = pt.ele - prev.ele; // in meters
            const dDist = getDistance(prev.lat, prev.lng, pt.lat, pt.lng) * 1000; // in meters
            if (dDist > 1) { // avoid tiny numbers
                slope = Math.round((dEle / dDist) * 100);
            }
        }
        
        processed.push({
            lat: pt.lat,
            lng: pt.lng,
            ele: pt.ele,
            dist: parseFloat(cumulativeDist.toFixed(2)),
            slope: slope
        });
    }
    return processed;
}

function showHoverMarkerOnMap(lat, lng, color) {
    if (!map) return;
    
    const pos = { lat: lat, lng: lng };
    
    if (hoverMarker) {
        hoverMarker.setPosition(pos);
        hoverMarker.setMap(map);
    } else {
        hoverMarker = new google.maps.Marker({
            position: pos,
            map: map,
            zIndex: 99999,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 7,
                fillColor: color,
                fillOpacity: 1,
                strokeColor: '#FFFFFF',
                strokeWeight: 2
            }
        });
    }
}

function renderElevationChart(place, canvasId, selectedSegmentId = 'full') {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    // Filter out points without elevation
    let dataPoints = place.gpxData.filter(pt => pt.ele !== undefined && pt.ele !== null);
    if (dataPoints.length === 0) return;

    let segmentName = 'מסלול מלא';

    // Filter points if a specific segment is selected
    if (selectedSegmentId && selectedSegmentId !== 'full' && place.gpxSegments) {
        const seg = place.gpxSegments.find(s => s.id === selectedSegmentId);
        if (seg) {
            const start = Math.min(seg.startIndex, seg.endIndex);
            const end = Math.max(seg.startIndex, seg.endIndex);
            dataPoints = dataPoints.filter(pt => {
                const origIdx = place.gpxData.indexOf(pt);
                return origIdx >= start && origIdx <= end;
            });
            segmentName = seg.name;
        }
    }

    // Reverse route points if isReversed is set
    let chartPoints = [];
    if (place.isReversed) {
        chartPoints = [...dataPoints].reverse();
    } else {
        chartPoints = [...dataPoints];
    }

    // Recalculate distance starting from 0 for chartPoints
    let accumDist = 0;
    chartPoints = chartPoints.map((pt, idx) => {
        if (idx > 0) {
            const prev = chartPoints[idx-1];
            accumDist += getDistance(prev.lat, prev.lng, pt.lat, pt.lng);
        }
        return {
            ...pt,
            chartDist: parseFloat(accumDist.toFixed(3))
        };
    });

    // Downsample if there are too many points to avoid slowing down rendering
    const maxPoints = 120;
    if (chartPoints.length > maxPoints) {
        const step = Math.ceil(chartPoints.length / maxPoints);
        chartPoints = chartPoints.filter((_, idx) => idx % step === 0 || idx === chartPoints.length - 1);
    }

    const ctx = canvas.getContext('2d');
    
    // Check if chart instance already exists on this canvas and destroy it first
    if (canvas.$chart) {
        canvas.$chart.destroy();
    }

    // Calculate Gain/Loss for this view
    let gain = 0;
    let loss = 0;
    for (let i = 0; i < dataPoints.length - 1; i++) {
        const diff = dataPoints[i+1].ele - dataPoints[i].ele;
        if (diff > 0) gain += diff;
        else loss += Math.abs(diff);
    }

    // Render stats label
    const statsDivId = `elevation-stats-${place.id}`;
    let statsDiv = document.getElementById(statsDivId);
    if (!statsDiv) {
        statsDiv = document.createElement('div');
        statsDiv.id = statsDivId;
        statsDiv.style = `font-size:11.5px; font-weight:bold; color:var(--text-secondary); text-align:center; margin-top:6px; background:var(--primary-bg); padding:4px 8px; border-radius:4px; border:1px solid var(--border-light);`;
        canvas.parentNode.appendChild(statsDiv);
    }
    statsDiv.innerHTML = `📊 <strong>${escapeHtml(segmentName)}:</strong> טיפוס מצטבר: <span style="color:#10B981; font-weight:bold;">${Math.round(gain)} מ'</span> | ירידה מצטברת: <span style="color:#EF4444; font-weight:bold;">${Math.round(loss)} מ'</span>`;

    const placeColor = getPlaceColor(place);
    const gradient = ctx.createLinearGradient(0, 0, 0, 140);
    gradient.addColorStop(0, `${placeColor}40`);
    gradient.addColorStop(1, `${placeColor}02`);

    const chartConfig = {
        type: 'line',
        data: {
            datasets: [{
                data: chartPoints.map(pt => ({ x: pt.chartDist, y: pt.ele })),
                borderColor: placeColor,
                borderWidth: 2,
                fill: true,
                backgroundColor: gradient,
                tension: 0.35,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: placeColor,
                pointHoverBorderColor: '#fff',
                pointHoverBorderWidth: 2
            }]
        },
        plugins: [{
            id: 'roadbookAnnotations',
            afterDraw: (chart) => {
                const rb = place.roadbooks && place.roadbooks.length > 0 ? 
                    (place.roadbooks.find(r => r.id === place.$displayedRoadbookId) || place.roadbooks[0]) : null;
                if (!rb || !rb.points || rb.points.length === 0) return;

                const ctx = chart.ctx;
                const xAxis = chart.scales.x;
                const yAxis = chart.scales.y;
                
                const totalLength = place.gpxData[place.gpxData.length - 1].dist;

                rb.points.forEach((pt, pIdx) => {
                    const gpxPt = place.gpxData[pt.index];
                    if (!gpxPt) return;

                    let ptDist = gpxPt.dist;
                    if (place.isReversed) {
                        ptDist = totalLength - ptDist;
                    }

                    const xPixel = xAxis.getPixelForValue(ptDist);
                    const yTop = yAxis.top;
                    const yBottom = yAxis.bottom;

                    ctx.save();
                    ctx.beginPath();
                    ctx.strokeStyle = pt.poi && pt.poi.type ? '#F59E0B' : 'rgba(0, 0, 0, 0.25)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 4]);
                    ctx.moveTo(xPixel, yTop);
                    ctx.lineTo(xPixel, yBottom);
                    ctx.stroke();

                    ctx.font = 'bold 9px Varela Round, sans-serif';
                    ctx.fillStyle = pt.poi && pt.poi.type ? '#b45309' : 'var(--primary-dark)';
                    ctx.textAlign = 'center';
                    
                    const labelText = pt.poi && pt.poi.type ? getPoiEmoji(pt.poi.type) : String(pIdx + 1);
                    ctx.fillText(labelText, xPixel, yBottom - 18);
                    
                    ctx.font = '8px sans-serif';
                    ctx.fillStyle = '#64748b';
                    ctx.fillText(ptDist.toFixed(1) + 'k', xPixel, yBottom - 6);
                    ctx.restore();
                });
            }
        }],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (event, elements) => {
                if (elements && elements.length > 0) {
                    const idx = elements[0].index;
                    const pt = chartPoints[idx];
                    if (pt && map) {
                        map.panTo({ lat: pt.lat, lng: pt.lng });
                        map.setZoom(16);
                        showToast(`מתמקד בנקודת גובה: ${pt.ele} מטרים`, 'info');
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    mode: 'index',
                    intersect: false,
                    rtl: true,
                    textDirection: 'rtl',
                    callbacks: {
                        title: (context) => {
                            const idx = context[0].dataIndex;
                            const pt = chartPoints[idx];
                            return `מרחק: ${pt.chartDist} ק"מ`;
                        },
                        label: (context) => {
                            const idx = context.dataIndex;
                            const pt = chartPoints[idx];
                            const slopeText = pt.slope !== undefined ? ` (שיפוע: ${pt.slope > 0 ? '+' : ''}${pt.slope}%)` : '';
                            return `גובה: ${context.parsed.y} מ'${slopeText}`;
                        }
                    },
                    external: function(context) {
                        const tooltipModel = context.tooltip;
                        if (tooltipModel.opacity === 0) {
                            if (hoverMarker) hoverMarker.setMap(null);
                            return;
                        }
                        if (tooltipModel.dataPoints && tooltipModel.dataPoints.length > 0) {
                            const idx = tooltipModel.dataPoints[0].dataIndex;
                            const pt = chartPoints[idx];
                            if (pt) {
                                showHoverMarkerOnMap(pt.lat, pt.lng, placeColor);
                            }
                        }
                    }
                }
            },
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'מרחק (ק"מ)',
                        font: { family: 'Varela Round, sans-serif', size: 10, weight: 'bold' }
                    },
                    grid: { display: false },
                    ticks: {
                        font: { family: 'Varela Round, sans-serif', size: 9 },
                        callback: function(value) { return value + ' ק"מ'; }
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'גובה (מטרים)',
                        font: { family: 'Varela Round, sans-serif', size: 10, weight: 'bold' }
                    },
                    grid: { color: 'rgba(0, 0, 0, 0.05)' },
                    ticks: {
                        font: { family: 'Varela Round, sans-serif', size: 9 },
                        callback: function(value) { return value.toLocaleString() + " מ'"; }
                    }
                }
            }
        }
    };

    // Store chart instance on the canvas element for clean disposal next time
    canvas.$chart = new Chart(ctx, chartConfig);
    
    // Hide hover marker when mouse leaves the canvas entirely
    canvas.addEventListener('mouseleave', () => {
        if (hoverMarker) hoverMarker.setMap(null);
    });
}

function drawAllGpxTracks() {
    if (typeof google === 'undefined' || !google.maps) return;
    // Clear all existing polylines
    if (activePolylines) {
        activePolylines.forEach(p => p.setMap(null));
        activePolylines = [];
    }

    // Clear existing km markers
    kmMarkers.forEach(m => m.setMap(null));
    kmMarkers = [];

    if (!map) return;

    const filtered = getFilteredPlaces();
    const bounds = new google.maps.LatLngBounds();
    let hasTracks = false;
    let activeTrackPoints = null;

    filtered.forEach(place => {
        if (place.gpxData && place.gpxData.length > 0) {
            hasTracks = true;
            const placeColor = getPlaceColor(place);

            const isActive = (place.id === activeMarkerId);
            if (isActive) {
                activeTrackPoints = place.gpxData;
            }

            const polyline = new google.maps.Polyline({
                path: place.gpxData,
                geodesic: true,
                strokeColor: isActive ? '#E5B23A' : placeColor,
                strokeOpacity: isActive ? 1.0 : 0.5,
                strokeWeight: isActive ? 5 : 2.5,
                map: map,
                zIndex: isActive ? 1000 : 100
            });

            activePolylines.push(polyline);

            // Draw active itinerary day specific GPX segments (e.g., Km 15 to 30) as highlighted markers on top
            let activeItinerary = null;
            if (typeof activeItineraryId !== 'undefined' && activeItineraryId && typeof itineraries !== 'undefined') {
                activeItinerary = itineraries.find(itin => itin.id === activeItineraryId);
            }

            if (activeItinerary) {
                activeItinerary.days.forEach((day, dayIdx) => {
                    if (day.gpxPlaceId === place.id && (day.gpxStartKm !== null || day.gpxEndKm !== null)) {
                        const startKm = day.gpxStartKm !== null ? day.gpxStartKm : 0;
                        const endKm = day.gpxEndKm !== null ? day.gpxEndKm : 99999;
                        
                        // Extract points within range
                        const segmentPath = place.gpxData.filter(pt => pt.dist >= startKm && pt.dist <= endKm);
                        
                        if (segmentPath.length > 1) {
                            const dayColor = day.color || activeItinerary.color || '#E5B23A';
                            const dayPoly = new google.maps.Polyline({
                                path: segmentPath,
                                geodesic: true,
                                strokeColor: dayColor,
                                strokeOpacity: 0.9,
                                strokeWeight: 7, // Thicker highlight
                                map: map,
                                zIndex: 1600 // Drawn on top
                            });
                            
                            const dayNum = dayIdx + 1;
                            const infoWindow = new google.maps.InfoWindow({
                                content: `
                                    <div style="direction: rtl; text-align: right; font-family: 'Varela Round', sans-serif; padding: 4px;">
                                        <strong style="color: ${dayColor}; font-size:13.5px;">יום ${dayNum}: ${escapeHtml(day.title || 'יום טיול')}</strong>
                                        <div style="font-size:12px; color: var(--text-secondary); margin-top:2px;">
                                            מקטע מסלול: ק"מ ${startKm.toFixed(1)} עד ק"מ ${endKm.toFixed(1)}
                                        </div>
                                    </div>
                                `
                            });
                            
                            dayPoly.addListener('click', (e) => {
                                infoWindow.setPosition(e.latLng);
                                infoWindow.open(map);
                            });
                            
                            activePolylines.push(dayPoly);
                        }
                    }
                });
            }

            // Kilometer markers are drawn dynamically via drawKmMarkers() at the end of this function

            // Draw saved GPX segments
            if (place.gpxSegments && place.gpxSegments.length > 0) {
                place.gpxSegments.forEach(seg => {
                    if (seg.visible) {
                        const start = Math.min(seg.startIndex, seg.endIndex);
                        const end = Math.max(seg.startIndex, seg.endIndex);
                        const segmentPath = place.gpxData.slice(start, end + 1);
                        
                        const segPoly = new google.maps.Polyline({
                            path: segmentPath,
                            geodesic: true,
                            strokeColor: seg.color || '#F43F5E',
                            strokeOpacity: 0.9,
                            strokeWeight: 6,
                            map: map,
                            zIndex: 2000
                        });
                        
                        const infoWindow = new google.maps.InfoWindow({
                            content: `<div style="direction: rtl; text-align: right; font-family: 'Varela Round', sans-serif; padding: 4px;">
                                <strong style="color: var(--primary); font-size:13.5px;">${escapeHtml(seg.name)}</strong><br>
                                <span style="font-size: 12.5px; font-weight: bold; color: var(--text-secondary);">${seg.distanceKm.toFixed(2)} ק"מ</span><br>
                                <span style="font-size: 11.5px; color: var(--text-tertiary); display:block; margin-top:2px;">${escapeHtml(seg.description || '')}</span>
                            </div>`
                        });
                        
                        segPoly.addListener('click', (e) => {
                            infoWindow.setPosition(e.latLng);
                            infoWindow.open(map);
                        });
                        
                        activePolylines.push(segPoly);
                    }
                });
            }

            // Extend bounds for all tracks
            place.gpxData.forEach(pt => bounds.extend(pt));
        }
    });

    // Handle zoom/fit bounds
    if (activeTrackPoints) {
        const activeBounds = new google.maps.LatLngBounds();
        activeTrackPoints.forEach(pt => activeBounds.extend(pt));
        map.fitBounds(activeBounds);
    } else if (hasTracks) {
        map.fitBounds(bounds);
    }

    if (slopeColoringEnabled) {
        drawSlopeColoredTracks();
    } else {
        slopePolylines.forEach(p => p.setMap(null));
        slopePolylines = [];
    }

    drawKmMarkers();
}

function drawSlopeColoredTracks() {
    slopePolylines.forEach(p => p.setMap(null));
    slopePolylines = [];
    
    if (!map) return;
    
    const visiblePlaces = getFilteredPlaces();
    visiblePlaces.forEach(place => {
        if (!place.gpxData || place.gpxData.length < 2) return;
        const points = place.gpxData;
        const stepSize = 4;
        
        for (let i = 0; i < points.length - 1; i += stepSize) {
            const segEnd = Math.min(i + stepSize, points.length - 1);
            const ptStart = points[i];
            const ptEnd = points[segEnd];
            
            const eleDiff = (ptEnd.ele || 0) - (ptStart.ele || 0);
            let distDiff;
            if (ptStart.dist !== undefined && ptEnd.dist !== undefined) {
                distDiff = (ptEnd.dist - ptStart.dist) * 1000;
            } else {
                distDiff = getDistance(ptStart.lat, ptStart.lng, ptEnd.lat, ptEnd.lng) * 1000;
            }
            
            const slope = distDiff > 0 ? (eleDiff / distDiff) * 100 : 0;
            
            let color;
            const absSlope = Math.abs(slope);
            if (absSlope < 5) {
                color = '#22c55e'; // Flat/easy
            } else if (absSlope < 12) {
                color = '#eab308'; // Moderate
            } else if (absSlope < 20) {
                color = '#f97316'; // Steep
            } else {
                color = '#ef4444'; // Very steep
            }
            
            const pathSegment = points.slice(i, segEnd + 1).map(pt => ({ lat: pt.lat, lng: pt.lng }));
            
            const poly = new google.maps.Polyline({
                path: pathSegment,
                strokeColor: color,
                strokeOpacity: 0.9,
                strokeWeight: 6,
                map: map,
                zIndex: 1800
            });
            
            slopePolylines.push(poly);
        }
    });
}

function drawKmMarkers() {
    // Clear existing km markers
    kmMarkers.forEach(m => m.setMap(null));
    kmMarkers = [];
    
    if (!map || kmMarkerMode === 'off') return;
    
    const activePlace = places.find(p => p.id === activeMarkerId);
    if (!activePlace || !activePlace.gpxData || activePlace.gpxData.length <= 1) return;
    
    // Calculate step size
    let step = 1;
    if (kmMarkerMode === 'dynamic') {
        const zoom = map.getZoom();
        if (zoom < 10) step = 10;
        else if (zoom <= 12) step = 5;
        else step = 1;
    } else {
        step = parseInt(kmMarkerMode);
    }
    
    const totalLength = activePlace.gpxData[activePlace.gpxData.length - 1].dist || 0;
    let lastKm = 0;
    
    if (activePlace.isReversed) {
        // Reversed direction
        for (let i = activePlace.gpxData.length - 2; i >= 0; i--) {
            const pt = activePlace.gpxData[i];
            if (pt.dist !== undefined && pt.dist !== null) {
                const currentKm = Math.floor(totalLength - pt.dist);
                if (currentKm > lastKm) {
                    for (let km = lastKm + 1; km <= currentKm; km++) {
                        if (km % step === 0) {
                            const kmIcon = {
                                url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><circle cx="11" cy="11" r="10" fill="white" stroke="#94a3b8" stroke-width="1.5"/><text x="11" y="15" text-anchor="middle" font-size="10" font-weight="bold" font-family="sans-serif" fill="#475569">${km}</text></svg>`),
                                anchor: new google.maps.Point(11, 11)
                            };
                            const kmMk = new google.maps.Marker({
                                position: { lat: pt.lat, lng: pt.lng },
                                map: map,
                                icon: kmIcon,
                                zIndex: 500,
                                clickable: false
                            });
                            kmMarkers.push(kmMk);
                        }
                    }
                    lastKm = currentKm;
                }
            }
        }
    } else {
        // Normal direction
        for (let i = 1; i < activePlace.gpxData.length; i++) {
            const pt = activePlace.gpxData[i];
            if (pt.dist !== undefined && pt.dist !== null) {
                const currentKm = Math.floor(pt.dist);
                if (currentKm > lastKm) {
                    for (let km = lastKm + 1; km <= currentKm; km++) {
                        if (km % step === 0) {
                            const kmIcon = {
                                url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><circle cx="11" cy="11" r="10" fill="white" stroke="#94a3b8" stroke-width="1.5"/><text x="11" y="15" text-anchor="middle" font-size="10" font-weight="bold" font-family="sans-serif" fill="#475569">${km}</text></svg>`),
                                anchor: new google.maps.Point(11, 11)
                            };
                            const kmMk = new google.maps.Marker({
                                position: { lat: pt.lat, lng: pt.lng },
                                map: map,
                                icon: kmIcon,
                                zIndex: 500,
                                clickable: false
                            });
                            kmMarkers.push(kmMk);
                        }
                    }
                    lastKm = currentKm;
                }
            }
        }
    }
}

// ============= Mini Map (Modal) =============
function initMiniMap() {
    miniMap = new google.maps.Map(document.getElementById('mini-map'), {
        center: { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] },
        zoom: 5,
        zoomControl: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        styles: [
            { "featureType": "landscape", "stylers": [{ "color": "#f9f6f0" }] },
            { "featureType": "water", "stylers": [{ "color": "#d6e6f2" }] }
        ]
    });

    // Click on mini-map to pin a point
    miniMap.addListener('click', (e) => {
        const lat = e.latLng.lat();
        const lng = e.latLng.lng();

        document.getElementById('place-lat').value = lat;
        document.getElementById('place-lng').value = lng;
        document.getElementById('place-google-url').value = `https://www.google.com/maps?q=${lat},${lng}`;

        updateMiniMap(lat, lng);

        // Reverse-geocode to update name/address
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ location: e.latLng }, (results, status) => {
            if (status === 'OK' && results[0]) {
                document.getElementById('place-search').value = results[0].formatted_address;
                const nameParts = results[0].formatted_address.split(',');
                document.getElementById('place-name').value = nameParts[0].trim();
            }
        });
    });
}

function updateMiniMap(lat, lng) {
    const wrapper = document.getElementById('mini-map-wrapper');
    wrapper.style.display = 'block';

    if (!miniMap) {
        initMiniMap();
    }

    setTimeout(() => {
        google.maps.event.trigger(miniMap, 'resize');
        const pos = { lat: lat, lng: lng };
        miniMap.setCenter(pos);
        miniMap.setZoom(13);

        if (miniMapMarker) {
            miniMapMarker.setPosition(pos);
        } else {
            miniMapMarker = new google.maps.Marker({
                position: pos,
                map: miniMap,
                icon: {
                    path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z",
                    fillColor: "#E5B23A",
                    fillOpacity: 1,
                    strokeWeight: 1.5,
                    strokeColor: "#2C4E72",
                    scale: 1.2,
                    anchor: new google.maps.Point(12, 22)
                }
            });
        }
    }, 100);
}

// ============= UI Rendering =============
function renderPlaces() {
    const list = document.getElementById('places-list');
    const emptyState = document.getElementById('empty-state');
    const count = document.getElementById('places-count');

    // Get all filtered places (for count & drawing tracks)
    let filtered = getFilteredPlaces();
    const isSearchActive = searchQuery.trim().length > 0;
    if (isSearchActive) {
        const q = searchQuery.trim().toLowerCase();
        filtered = filtered.filter(p => 
            (p.name && p.name.toLowerCase().includes(q)) ||
            (p.description && p.description.toLowerCase().includes(q))
        );
    }
    count.textContent = filtered.length;

    // Check if we are viewing a parent group (country) and haven't selected a specific sub-group (trek)
    const isParentGroup = activeGroupId !== 'all' && !getGroupById(activeGroupId)?.parentId;
    const subGroups = activeGroupId !== 'all' ? groups.filter(g => g.parentId === activeGroupId) : [];
    const hasSubGroups = subGroups.length > 0;

    list.innerHTML = '';

    if (!isSearchActive && isParentGroup && activeSubGroupId === 'all' && hasSubGroups) {
        // --- 1. Parent Group View: Show Trek Cards & standalone places ---
        emptyState.style.display = 'none';
        list.style.display = 'flex';

        // Render Trek Cards first
        subGroups.forEach((sub, subIdx) => {
            const trekCard = createTrekCard(sub, subIdx);
            list.appendChild(trekCard);
        });

        // Render standalone places belonging directly to this country (parent group)
        const standalonePlaces = places.filter(p => p.groupId === activeGroupId);
        standalonePlaces.forEach((place, index) => {
            const card = createPlaceCard(place, subGroups.length + index);
            list.appendChild(card);
        });

        if (subGroups.length === 0 && standalonePlaces.length === 0) {
            list.style.display = 'none';
            emptyState.style.display = 'flex';
            emptyState.querySelector('h3').textContent = 'אין מקומות בקבוצה הזו';
            emptyState.querySelector('p').textContent = 'הוסף מקום חדש או עבור לקבוצה אחרת';
        }
        return;
    }

    // --- 2. Normal View (Specific sub-group/trek selected, or All view, or group with no sub-groups) ---
    if (filtered.length === 0) {
        list.style.display = 'none';
        emptyState.style.display = 'flex';
        if (activeGroupId !== 'all' && places.length > 0) {
            emptyState.querySelector('h3').textContent = 'אין מקומות בקבוצה הזו';
            emptyState.querySelector('p').textContent = 'הוסף מקום חדש או עבור לקבוצה אחרת';
        } else {
            emptyState.querySelector('h3').textContent = 'אין מקומות שמורים עדיין';
            emptyState.querySelector('p').textContent = 'לחץ על "הוסף מקום" כדי להתחיל לבנות את מפת הטיולים שלך';
        }
        return;
    }

    emptyState.style.display = 'none';
    list.style.display = 'flex';

    // If viewing a specific sub-group (trek), render a Trek Header Card at the top
    if (activeSubGroupId !== 'all') {
        const subGroup = getGroupById(activeSubGroupId);
        if (subGroup) {
            const headerCard = createTrekHeaderCard(subGroup);
            list.appendChild(headerCard);
        }
    }

    filtered.forEach((place, index) => {
        const card = createPlaceCard(place, index);
        list.appendChild(card);
    });

    // Initialize drag-to-reorder
    if (typeof Sortable !== 'undefined' && list) {
        new Sortable(list, {
            animation: 150,
            handle: '.drag-handle',
            draggable: '.place-card',
            ghostClass: 'sortable-ghost',
            onEnd: (evt) => {
                const cards = list.querySelectorAll('.place-card[data-id]');
                const newOrder = Array.from(cards).map(card => card.dataset.id);
                // Update sortOrder for each place
                newOrder.forEach((id, idx) => {
                    const place = places.find(p => p.id === id);
                    if (place) {
                        place.sortOrder = idx;
                        syncPlaceToFirebase(place);
                    }
                });
                savePlaces();
                // Re-render markers to match new order labels
                renderMarkers();
                drawAllGpxTracks();
            }
        });
    }
}

function createPlaceCard(place, index) {
    const card = document.createElement('div');
    card.className = 'place-card';
    card.dataset.id = place.id;
    card.style.animationDelay = `${index * 0.08}s`;

    const labelText = place.customLabel || String(index + 1);
    const group = getGroupById(place.groupId);
    const badgeColor = getPlaceColor(place);

    // Apply colors to the card border
    card.style.borderRightColor = badgeColor;

    // Header
    const header = document.createElement('div');
    header.className = 'card-header';
    header.innerHTML = `
        <div class="drag-handle" title="גרור לשינוי סדר"><i class="fas fa-grip-vertical"></i></div>
        <div class="card-number" style="background: radial-gradient(circle, #FFF7D1 0%, ${badgeColor} 100%); border-color: ${badgeColor}; box-shadow: 0 2px 6px ${badgeColor}40;">${escapeHtml(labelText)}</div>
        <div class="card-title-section">
            <div class="card-title">${escapeHtml(place.name)}</div>
            ${group ? `<div class="card-group-badge" style="background:${group.color}18; color:${group.color};"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${group.color}"></span>${escapeHtml(group.name)}</div>` : ''}
        </div>
        <div class="card-actions">
            <button class="card-action-btn collapse-btn" title="סגור">
                <i class="fas fa-times"></i>
            </button>
            <button class="card-action-btn share-btn" title="שתף מקום" data-id="${place.id}">
                <i class="fas fa-share-alt"></i>
            </button>
            <button class="card-action-btn edit-btn" title="ערוך" data-id="${place.id}">
                <i class="fas fa-pen"></i>
            </button>
            <button class="card-action-btn delete-btn" title="מחק" data-id="${place.id}">
                <i class="fas fa-trash-alt"></i>
            </button>
        </div>
    `;
    card.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'card-body';

    if (place.description) {
        const desc = document.createElement('p');
        desc.className = 'card-description';
        desc.textContent = place.description;
        body.appendChild(desc);
    }

    if (place.tags && place.tags.length > 0) {
        const tagsContainer = document.createElement('div');
        tagsContainer.className = 'card-tags';
        tagsContainer.style = 'display:flex; flex-wrap:wrap; gap:6px; margin: 4px 0 10px 0;';
        
        place.tags.forEach(tag => {
            const tagSpan = document.createElement('span');
            tagSpan.className = 'card-tag';
            tagSpan.style = 'font-size:11px; padding:2px 8px; border-radius:12px; background:var(--primary-light); color:var(--text-secondary); border:1px solid var(--border-light); font-weight:bold; cursor:pointer;';
            tagSpan.innerHTML = `<i class="fas fa-tag" style="font-size:9px; margin-left:4px;"></i>${escapeHtml(tag)}`;
            
            // Add click to search this tag!
            tagSpan.onclick = (e) => {
                e.stopPropagation();
                const searchInput = document.getElementById('search-places-input');
                if (searchInput) {
                    searchInput.value = tag;
                    searchQuery = tag;
                    renderPlaces();
                }
            };
            
            tagsContainer.appendChild(tagSpan);
        });
        body.appendChild(tagsContainer);
    }

    // Image Carousel
    if (place.images && place.images.length > 0) {
        const carousel = document.createElement('div');
        carousel.className = 'card-carousel';

        const track = document.createElement('div');
        track.className = 'carousel-track';

        place.images.forEach((imgSrc, imgIndex) => {
            const item = document.createElement('div');
            item.className = 'carousel-item';
            const img = document.createElement('img');
            img.src = imgSrc;
            img.alt = `${place.name} - תמונה ${imgIndex + 1}`;
            img.loading = 'lazy';
            img.addEventListener('click', () => openLightbox(imgSrc));
            item.appendChild(img);
            track.appendChild(item);
        });

        carousel.appendChild(track);

        if (place.images.length > 2) {
            const prevBtn = document.createElement('button');
            prevBtn.className = 'carousel-btn carousel-btn-prev';
            prevBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
            prevBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                track.scrollBy({ left: -160, behavior: 'smooth' });
            });

            const nextBtn = document.createElement('button');
            nextBtn.className = 'carousel-btn carousel-btn-next';
            nextBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
            nextBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                track.scrollBy({ left: 160, behavior: 'smooth' });
            });

            carousel.appendChild(prevBtn);
            carousel.appendChild(nextBtn);
        }

        body.appendChild(carousel);
    }

    // Elevation Profile Chart
    const hasElevation = place.gpxData && place.gpxData.length > 0 && place.gpxData.some(pt => pt.ele !== undefined && pt.ele !== null);
    if (hasElevation) {
        const profileDiv = document.createElement('div');
        profileDiv.className = 'elevation-profile-container';
        profileDiv.innerHTML = `
            <div class="elevation-profile-header" style="display:flex; justify-content:space-between; align-items:center;">
                <span class="elevation-profile-title"><i class="fas fa-mountain"></i> גרף גבהים</span>
                <div style="display:flex; gap:6px; align-items:center;">
                    <button type="button" class="btn-reverse-route" style="font-size:10px; color:${place.isReversed ? 'var(--accent-rose)' : 'var(--primary)'}; border:1px solid ${place.isReversed ? 'var(--accent-rose)' : 'var(--border)'}; padding:2px 6px; border-radius:4px; background:${place.isReversed ? 'rgba(244, 63, 94, 0.05)' : 'white'}; cursor:pointer; font-family:inherit; font-weight:bold; display:flex; align-items:center; gap:3px;" title="הפוך את כיוון ההתקדמות וגרף הגבהים">
                        <i class="fas fa-exchange-alt"></i> <span>${place.isReversed ? 'בטל היפוך' : 'הפוך כיוון'}</span>
                    </button>
                    <select class="chart-segment-selector" id="chart-select-${place.id}" style="font-size:11px; padding:2px 4px; border-radius:4px; border:1px solid var(--border-light); font-family:inherit;">
                        <option value="full">מסלול מלא</option>
                        ${(place.gpxSegments || []).map(s => `<option value="${s.id}">מקטע: ${escapeHtml(s.name)}</option>`).join('')}
                    </select>
                    <span class="elevation-profile-toggle" title="הצג/הסתר גרף"><i class="fas fa-chevron-down"></i></span>
                </div>
            </div>
            <div class="elevation-profile-chart-wrapper" style="display: none;">
                <canvas id="elevation-chart-${place.id}" style="width: 100%; height: 140px;"></canvas>
            </div>
        `;
        
        const header = profileDiv.querySelector('.elevation-profile-header');
        const wrapper = profileDiv.querySelector('.elevation-profile-chart-wrapper');
        const icon = profileDiv.querySelector('.elevation-profile-toggle i');
        const select = profileDiv.querySelector('.chart-segment-selector');
        const reverseBtn = profileDiv.querySelector('.btn-reverse-route');
        
        select.addEventListener('click', (e) => e.stopPropagation());
        reverseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            place.isReversed = !place.isReversed;
            savePlaces();
            syncPlaceToFirebase(place);
            renderPlaces();
            showToast(place.isReversed ? 'כיוון ההתקדמות וגרף הגבהים נהפכו!' : 'כיוון ההתקדמות הוחזר למקור.', 'success');
        });
        
        select.addEventListener('change', (e) => {
            e.stopPropagation();
            renderElevationChart(place, `elevation-chart-${place.id}`, select.value);
        });
        
        header.addEventListener('click', (e) => {
            if (e.target.closest('select') || e.target.closest('.btn-reverse-route')) return;
            e.stopPropagation();
            const isVisible = wrapper.style.display !== 'none';
            if (isVisible) {
                wrapper.style.display = 'none';
                icon.className = 'fas fa-chevron-down';
                profileDiv.classList.remove('expanded');
            } else {
                wrapper.style.display = 'block';
                icon.className = 'fas fa-chevron-up';
                profileDiv.classList.add('expanded');
                setTimeout(() => renderElevationChart(place, `elevation-chart-${place.id}`, select.value), 50);
            }
        });
        
        body.appendChild(profileDiv);
    }

    // GPX Route Segments Section (if GPX exists)
    if (place.gpxData && place.gpxData.length > 0) {
        const segmentsDiv = document.createElement('div');
        segmentsDiv.className = 'route-segments-container';
        
        const segments = place.gpxSegments || [];
        const roadbooks = place.roadbooks || [];
        
        let roadbooksListHtml = '';
        if (roadbooks.length > 0) {
            roadbooksListHtml = `
                <div style="margin-top: 14px; border-top: 1.5px dashed var(--border-light); padding-top: 10px;">
                    <div style="font-size:12px; font-weight:bold; color:var(--primary-dark); margin-bottom:8px;"><i class="fas fa-book-open"></i> סיפורי דרך שמורים (${roadbooks.length})</div>
                    <div class="roadbooks-list">
                        ${roadbooks.map(rb => `
                            <div class="roadbook-item" style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; border:1px solid var(--border-light); border-radius:4px; padding:6px 10px; margin-bottom:6px;">
                                <span style="font-size:12px; font-weight:600; color:var(--text-secondary);"><i class="fas fa-file-alt" style="color:var(--primary);"></i> ${escapeHtml(rb.name)}</span>
                                <div style="display:flex; gap:6px; align-items:center;">
                                    <button type="button" class="btn-open-roadbook icon-btn-text" data-place-id="${place.id}" data-rb-id="${rb.id}" style="font-size:11px; color:var(--primary); border:1px solid var(--border); padding:2px 6px; border-radius:3px; background:white; cursor:pointer; font-family:inherit;">הצג</button>
                                    <button type="button" class="btn-edit-saved-roadbook icon-btn-text" data-place-id="${place.id}" data-rb-id="${rb.id}" style="font-size:11px; color:#b45309; border:1px solid #f59e0b; padding:2px 6px; border-radius:3px; background:#fef3c7; cursor:pointer; font-family:inherit;">ערוך</button>
                                    <button type="button" class="btn-delete-roadbook icon-btn" data-place-id="${place.id}" data-rb-id="${rb.id}" title="מחק סיפור דרך" style="border:none; background:transparent; padding:0; cursor:pointer; color:var(--accent-rose); font-size:12px;">
                                        <i class="fas fa-trash-alt"></i>
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        segmentsDiv.innerHTML = `
            <div class="segments-header">
                <span class="segments-title"><i class="fas fa-ruler-combined"></i> מקטעי ניווט וסיפורי דרך (${segments.length + roadbooks.length})</span>
                <span class="segments-toggle-list" title="הצג/הסתר רשימה"><i class="fas fa-chevron-down"></i></span>
            </div>
            <div class="segments-list-wrapper" style="display: none; padding: 12px 14px;">
                <button type="button" class="btn-create-roadbook" style="width:100%; height:34px; background:#0ea5e9; color:white; border:none; border-radius:var(--radius-sm); font-family:inherit; font-size:12.5px; font-weight:bold; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer; margin-bottom:12px; transition:all 0.2s;">
                    <i class="fas fa-plus"></i> צור סיפור דרך חדש (מדידה)
                </button>
                <!-- Segments list -->
                <div style="font-size:12px; font-weight:bold; color:var(--primary-dark); margin: 0 0 6px 0;"><i class="fas fa-chart-line"></i> מקטעי מדידה (${segments.length})</div>
                <div class="segments-list" style="padding:0; max-height: 180px;">
                    ${segments.length === 0 ? '<div style="font-size:11.5px; color:var(--text-tertiary); text-align:center; padding:10px 0;">אין מקטעי מדידה עדיין.</div>' : segments.map(seg => {
                        const stats = getSegmentStats(place, seg.startIndex, seg.endIndex);
                        return `
                            <div class="segment-item" data-seg-id="${seg.id}" style="border-right: 3px solid ${seg.color || '#F43F5E'}; padding: 8px 10px; margin-bottom: 6px; background: var(--primary-bg); border-radius: var(--radius-sm); display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                                <div class="segment-info" style="flex:1; overflow:hidden;">
                                    <div style="display:flex; justify-content:space-between; align-items:center; width:100%; gap:8px;">
                                        <strong class="segment-name" style="font-size:12.5px; color:var(--primary-dark); text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${escapeHtml(seg.name)}</strong>
                                        <span class="segment-distance" style="font-size:12px; font-weight:bold; color:var(--primary); white-space:nowrap;">${seg.distanceKm.toFixed(2)} ק"מ</span>
                                    </div>
                                    <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-secondary); margin-top:2px;">
                                        <span>📈 +${stats.gain}מ' / -${stats.loss}מ'</span>
                                    </div>
                                    <div class="segment-desc" style="font-size:11px; color:var(--text-tertiary); margin-top:2px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="${escapeHtml(seg.description || '')}">${escapeHtml(seg.description || 'ללא תיאור')}</div>
                                </div>
                                <div class="segment-actions" style="display:flex; gap:12px; align-items:center; flex-shrink:0;">
                                    <label class="segment-eye-toggle" title="הצג/הסתר מקטע במפה" style="cursor:pointer; font-size:14px;">
                                        <input type="checkbox" class="chk-segment-visibility" data-place-id="${place.id}" data-seg-id="${seg.id}" ${seg.visible ? 'checked' : ''} style="display:none;">
                                        <i class="fas ${seg.visible ? 'fa-eye' : 'fa-eye-slash'}" style="${seg.visible ? 'color: var(--primary);' : 'color: var(--text-muted);'}"></i>
                                    </label>
                                    <button type="button" class="btn-delete-segment icon-btn" data-place-id="${place.id}" data-seg-id="${seg.id}" title="מחק מקטע" style="border:none; background:transparent; padding:0; cursor:pointer; color:var(--accent-rose); font-size:13px;">
                                        <i class="fas fa-trash-alt"></i>
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>

                <!-- Roadbooks list -->
                ${roadbooksListHtml}
            </div>
        `;
        
        const header = segmentsDiv.querySelector('.segments-header');
        const listWrapper = segmentsDiv.querySelector('.segments-list-wrapper');
        const icon = segmentsDiv.querySelector('.segments-toggle-list i');
        
        if (header && listWrapper) {
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                const isVisible = listWrapper.style.display !== 'none';
                if (isVisible) {
                    listWrapper.style.display = 'none';
                    if (icon) icon.className = 'fas fa-chevron-down';
                } else {
                    listWrapper.style.display = 'block';
                    if (icon) icon.className = 'fas fa-chevron-up';
                }
            });
        }

        segmentsDiv.querySelectorAll('.btn-create-roadbook').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openMeasurementControlBar(place);
            });
        });
        
        segmentsDiv.querySelectorAll('.chk-segment-visibility').forEach(chk => {
            chk.addEventListener('change', (e) => {
                e.stopPropagation();
                const placeId = e.target.dataset.placeId;
                const segId = e.target.dataset.segId;
                toggleSegmentVisibility(placeId, segId, e.target.checked);
            });
            chk.parentElement.addEventListener('click', (e) => e.stopPropagation());
        });
        
        segmentsDiv.querySelectorAll('.btn-delete-segment').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetBtn = e.target.closest('.btn-delete-segment');
                const placeId = targetBtn.dataset.placeId;
                const segId = targetBtn.dataset.segId;
                if (confirm('האם אתה בטוח שברצונך למחוק מקטע זה?')) {
                    deleteSegment(placeId, segId);
                }
            });
        });
        
        segmentsDiv.querySelectorAll('.segment-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.btn-delete-segment') || e.target.closest('.segment-eye-toggle')) return;
                e.stopPropagation();
                const segId = item.dataset.segId;
                const seg = segments.find(s => s.id === segId);
                if (seg) {
                    focusMapOnSegment(place, seg);
                }
            });
        });

        // Roadbooks action buttons
        segmentsDiv.querySelectorAll('.btn-open-roadbook').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const rbId = btn.dataset.rbId;
                const rb = roadbooks.find(r => r.id === rbId);
                if (rb) {
                    openRoadbookModal(place, rb);
                }
            });
        });

        segmentsDiv.querySelectorAll('.btn-edit-saved-roadbook').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const rbId = btn.dataset.rbId;
                const rb = roadbooks.find(r => r.id === rbId);
                if (rb) {
                    loadRoadbookToEditor(place, rb);
                }
            });
        });

        segmentsDiv.querySelectorAll('.btn-delete-roadbook').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const rbId = btn.dataset.rbId;
                if (confirm('האם אתה בטוח שברצונך למחוק סיפור דרך זה?')) {
                    deleteRoadbook(place.id, rbId);
                }
            });
        });
        
        body.appendChild(segmentsDiv);
    }

    card.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'card-footer';

    const linksDiv = document.createElement('div');
    linksDiv.className = 'card-links';

    // Google Maps link
    const gmapsUrl = place.links?.find(l => l.type === 'google_maps')?.url ||
                     `https://www.google.com/maps?q=${place.lat},${place.lng}`;
    linksDiv.innerHTML = `
        <a href="${gmapsUrl}" target="_blank" rel="noopener" class="link-badge google-maps">
            <i class="fas fa-map-marker-alt"></i> Google Maps
        </a>
    `;

    // Other links
    if (place.links) {
        place.links.filter(l => l.type !== 'google_maps').forEach(link => {
            const icon = getLinkIcon(link.type);
            const a = document.createElement('a');
            a.href = link.url;
            a.target = '_blank';
            a.rel = 'noopener';
            a.className = 'link-badge';
            a.title = link.label || link.type;
            a.innerHTML = `<i class="${icon}"></i> <span>${escapeHtml(link.label || 'צפה בקישור')}</span>`;
            linksDiv.appendChild(a);
        });
    }

    // GPX Animation / Recording Button
    if (place.gpxData && place.gpxData.length > 0) {
        const recordBtn = document.createElement('button');
        recordBtn.className = 'link-badge record-route';
        recordBtn.innerHTML = `<i class="fas fa-video"></i> <span>הנפש מסלול</span>`;
        recordBtn.title = 'הנפש והקלט את מסלול הליכה על המפה';
        recordBtn.style.cursor = 'pointer';
        recordBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openRecordingControlBar(place);
        });
        linksDiv.appendChild(recordBtn);

        const measureBtn = document.createElement('button');
        measureBtn.className = 'link-badge measure-route';
        measureBtn.innerHTML = `<i class="fas fa-ruler-combined"></i> <span>מדוד מקטע</span>`;
        measureBtn.title = 'מדוד וסמן מקטעים מדויקים על גבי המסלול';
        measureBtn.style.cursor = 'pointer';
        measureBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openMeasurementControlBar(place);
        });
        linksDiv.appendChild(measureBtn);

        const exportGpxBtn = document.createElement('button');
        exportGpxBtn.className = 'link-badge export-gpx';
        exportGpxBtn.innerHTML = `<i class="fas fa-file-export"></i> <span>ייצוא GPX משודרג</span>`;
        exportGpxBtn.title = 'ייצא קובץ GPX המכיל את המקטעים ונקודות העניין';
        exportGpxBtn.style.cursor = 'pointer';
        exportGpxBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            exportPlaceToGpx(place);
        });
        linksDiv.appendChild(exportGpxBtn);
    }

    footer.appendChild(linksDiv);
    card.appendChild(footer);

    // Card click → pan to location on map
    card.addEventListener('click', (e) => {
        if (e.target.closest('.card-action-btn') || e.target.closest('a') || e.target.closest('.carousel-btn') || e.target.closest('.carousel-item') || e.target.closest('.route-segments-container') || e.target.closest('.elevation-profile-container') || e.target.closest('input') || e.target.closest('button')) return;
        
        const wasActive = (activeMarkerId === place.id);
        if (wasActive) {
            setActiveMarker(place.id);
            if (window.innerWidth <= 900 && typeof switchToMobileMapTab === 'function') {
                switchToMobileMapTab();
            }
            return;
        }

        panToPlace(place.lat, place.lng);
        setActiveMarker(place.id);
        
        if (window.innerWidth <= 900 && typeof switchToMobileMapTab === 'function') {
            switchToMobileMapTab();
        }
    });

    // Collapse button
    header.querySelector('.collapse-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        setActiveMarker(place.id);
    });

    // Share button
    header.querySelector('.share-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const shareUrl = `${window.location.origin}${window.location.pathname}?placeId=${place.id}`;
        
        if (navigator.clipboard) {
            navigator.clipboard.writeText(shareUrl)
                .then(() => showToast('הקישור לשיתוף הועתק ללוח!', 'success'))
                .catch(() => showToast('שגיאה בהעתקת הקישור', 'error'));
        } else {
            const input = document.createElement('input');
            input.value = shareUrl;
            document.body.appendChild(input);
            input.select();
            try {
                document.execCommand('copy');
                showToast('הקישור לשיתוף הועתק ללוח!', 'success');
            } catch (err) {
                showToast('שגיאה בהעתקת הקישור', 'error');
            }
            document.body.removeChild(input);
        }
    });

    // Edit button
    header.querySelector('.edit-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openModal('edit', place);
    });

    // Delete button
    header.querySelector('.delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDelete(place.id);
    });

    return card;
}

function createTrekCard(group, index) {
    const card = document.createElement('div');
    card.className = 'trek-card';
    card.style.animationDelay = `${index * 0.08}s`;
    card.style.borderRight = `6px solid ${group.color}`;

    const count = getGroupPlaceCount(group.id);

    card.innerHTML = `
        <div class="trek-card-header">
            <div class="trek-card-icon" style="color: ${group.color}; border-color: ${group.color}40; background: ${group.color}10;">
                <i class="fas fa-mountain"></i>
            </div>
            <div class="trek-card-title-section">
                <div class="trek-card-title">${escapeHtml(group.name)}</div>
                <div class="trek-card-count-badge" style="background:${group.color}15; color:${group.color}; border-color:${group.color}30;">
                    <i class="fas fa-route"></i> ${count} ימים/מקטעים
                </div>
            </div>
        </div>
        <div class="trek-card-body">
            <div class="trek-card-desc">${escapeHtml(group.description || 'אין תיאור לטרק זה עדיין. לחץ לפרטים וכניסה.')}</div>
            <button class="trek-card-btn" style="background:${group.color};">
                <span>כנס לטרק</span>
                <i class="fas fa-chevron-left"></i>
            </button>
        </div>
    `;

    // Click on the trek card triggers entering the sub-group
    card.addEventListener('click', (e) => {
        setActiveSubGroup(group.id);
    });

    return card;
}

function createTrekHeaderCard(group) {
    const card = document.createElement('div');
    card.className = 'trek-header-card';
    card.style.borderRight = `6px solid ${group.color}`;

    const parentGroup = group.parentId ? getGroupById(group.parentId) : null;
    const parentName = parentGroup ? parentGroup.name : 'המדינה';

    card.innerHTML = `
        <div class="trek-header-title-row">
            <button class="trek-back-btn" title="חזרה ל${escapeHtml(parentName)}">
                <i class="fas fa-arrow-right"></i>
            </button>
            <h2 class="trek-header-title">${escapeHtml(group.name)}</h2>
        </div>
        <div class="trek-header-desc-container">
            <p class="trek-header-desc">${escapeHtml(group.description || 'אין תיאור לטרק זה. לחץ על העיפרון להוספת תיאור כללי.')}</p>
            <textarea class="trek-header-desc-edit" style="display:none;" placeholder="כתוב כאן תיאור כללי של הטרק...">${escapeHtml(group.description || '')}</textarea>
            <button class="trek-desc-action-btn edit-desc-btn" title="ערוך תיאור">
                <i class="fas fa-pencil-alt"></i>
            </button>
            <button class="trek-desc-action-btn save-desc-btn" style="display:none;" title="שמור תיאור">
                <i class="fas fa-check"></i>
            </button>
        </div>
    `;

    // Back button click
    card.querySelector('.trek-back-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        setActiveSubGroup('all');
    });

    const descPara = card.querySelector('.trek-header-desc');
    const descEdit = card.querySelector('.trek-header-desc-edit');
    const editBtn = card.querySelector('.edit-desc-btn');
    const saveBtn = card.querySelector('.save-desc-btn');

    // Edit button click
    editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        descPara.style.display = 'none';
        descEdit.style.display = 'block';
        editBtn.style.display = 'none';
        saveBtn.style.display = 'flex';
        descEdit.focus();
    });

    // Save button click
    saveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newDesc = descEdit.value;
        updateGroupDescription(group.id, newDesc);
        showToast('תיאור הטרק עודכן בהצלחה!', 'success');
    });

    // Prevent propagation on textarea to avoid any clicks triggering card actions
    descEdit.addEventListener('click', (e) => e.stopPropagation());
    descEdit.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            descPara.style.display = 'block';
            descEdit.style.display = 'none';
            editBtn.style.display = 'flex';
            saveBtn.style.display = 'none';
        }
    });

    return card;
}

function getLinkIcon(type) {
    const icons = {
        'tiktok': 'fab fa-tiktok',
        'instagram': 'fab fa-instagram',
        'youtube': 'fab fa-youtube',
        'facebook': 'fab fa-facebook',
        'twitter': 'fab fa-twitter',
        'website': 'fas fa-globe',
        'other': 'fas fa-external-link-alt'
    };
    return icons[type] || icons.other;
}

// ============= Lightbox =============
function openLightbox(src) {
    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    overlay.innerHTML = `<img src="${src}" alt="תמונה מוגדלת">`;
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
}

// ============= Modal =============
function openModal(mode, place) {
    const overlay = document.getElementById('modal-overlay');
    const title = document.getElementById('modal-title');
    const form = {
        name: document.getElementById('place-name'),
        description: document.getElementById('place-description'),
        tags: document.getElementById('place-tags'),
        search: document.getElementById('place-search'),
        lat: document.getElementById('place-lat'),
        lng: document.getElementById('place-lng'),
        googleUrl: document.getElementById('place-google-url'),
        id: document.getElementById('place-id'),
        customLabel: document.getElementById('place-custom-label'),
        useCustomColor: document.getElementById('place-use-custom-color'),
        customColor: document.getElementById('place-custom-color')
    };

    // Reset
    form.name.value = '';
    form.description.value = '';
    if (form.tags) form.tags.value = '';
    form.search.value = '';
    form.lat.value = '';
    form.lng.value = '';
    form.googleUrl.value = '';
    form.id.value = '';
    if (form.customLabel) form.customLabel.value = '';
    if (form.useCustomColor) form.useCustomColor.checked = false;
    if (form.customColor) {
        form.customColor.value = '#E5B23A';
        form.customColor.style.display = 'none';
    }
    document.getElementById('image-previews').innerHTML = '';
    document.getElementById('links-container').innerHTML = '';
    document.getElementById('search-results').classList.remove('active');
    document.getElementById('mini-map-wrapper').style.display = 'none';
    pendingImages = [];
    pendingGpxData = null;
    document.getElementById('gpx-input').value = '';
    document.getElementById('gpx-status').textContent = 'לא נבחר מסלול';
    document.getElementById('btn-remove-gpx').style.display = 'none';
    editingPlaceId = null;

    // Populate group selector
    renderGroupSelect();
    const groupSelect = document.getElementById('place-group');
    // Default to active group if not 'all'
    if (activeGroupId !== 'all') {
        groupSelect.value = activeGroupId;
    } else {
        groupSelect.value = '';
    }

    if (miniMapMarker) {
        miniMapMarker.setMap(null);
        miniMapMarker = null;
    }

    if (mode === 'edit' && place) {
        title.innerHTML = '<i class="fas fa-pen"></i> עריכת מקום';
        editingPlaceId = place.id;
        form.name.value = place.name;
        form.description.value = place.description || '';
        form.lat.value = place.lat;
        form.lng.value = place.lng;
        form.id.value = place.id;

        // Set group
        groupSelect.value = place.groupId || '';

        // Set custom label & color
        if (form.customLabel) form.customLabel.value = place.customLabel || '';
        if (form.useCustomColor) {
            form.useCustomColor.checked = !!place.useCustomColor;
            if (form.customColor) {
                form.customColor.value = place.customColor || '#E5B23A';
                form.customColor.style.display = place.useCustomColor ? 'inline-block' : 'none';
            }
        }

        // Set tags
        if (form.tags) {
            form.tags.value = place.tags ? place.tags.join(', ') : '';
        }

        // Load existing images
        if (place.images && place.images.length > 0) {
            pendingImages = [...place.images];
            renderImagePreviews();
        }

        // Load existing links (non-google-maps)
        if (place.links) {
            place.links.filter(l => l.type !== 'google_maps').forEach(link => {
                addLinkInput(link.url, link.type);
            });
        }

        // Load existing GPX track data
        if (place.gpxData && place.gpxData.length > 0) {
            pendingGpxData = place.gpxData;
            document.getElementById('gpx-status').textContent = `מסלול קיים (${place.gpxData.length} נקודות)`;
            document.getElementById('btn-remove-gpx').style.display = 'block';
        }

        // Show mini map with location
        updateMiniMap(place.lat, place.lng);
    } else {
        title.innerHTML = '<i class="fas fa-map-pin"></i> הוסף מקום חדש';
        
        let centerLat = DEFAULT_CENTER[0];
        let centerLng = DEFAULT_CENTER[1];
        if (map) {
            const center = map.getCenter();
            centerLat = center.lat();
            centerLng = center.lng();
        }
        updateMiniMap(centerLat, centerLng);
        form.lat.value = centerLat;
        form.lng.value = centerLng;
    }

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Focus search on add mode
    if (mode !== 'edit') {
        setTimeout(() => form.search.focus(), 300);
    }
}

function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    editingPlaceId = null;
    pendingImages = [];
}

async function uploadPendingImages(placeId) {
    if (!window.IS_FIREBASE_CONFIGURED || !window.storage) return pendingImages;

    const uploadPromises = pendingImages.map(async (img, idx) => {
        if (img.startsWith('http')) return img;

        try {
            const ref = window.storage.ref().child(`places/${placeId}/img-${idx}-${Date.now()}.jpg`);
            const base64Data = img.split(',')[1];
            await ref.putString(base64Data, 'base64', { contentType: 'image/jpeg' });
            return await ref.getDownloadURL();
        } catch (err) {
            console.error("Error uploading image to Firebase Storage:", err);
            return img;
        }
    });

    return await Promise.all(uploadPromises);
}

function savePlace() {
    const name = document.getElementById('place-name').value.trim();
    const description = document.getElementById('place-description').value.trim();
    const lat = parseFloat(document.getElementById('place-lat').value);
    const lng = parseFloat(document.getElementById('place-lng').value);

    if (!name) {
        showToast('נא להזין שם מקום', 'error');
        document.getElementById('place-name').focus();
        return;
    }

    if (isNaN(lat) || isNaN(lng)) {
        showToast('נא לחפש ולבחור מקום מהרשימה', 'error');
        document.getElementById('place-search').focus();
        return;
    }

    // Collect links
    const links = [
        { url: `https://www.google.com/maps?q=${lat},${lng}`, label: 'Google Maps', type: 'google_maps' }
    ];

    document.querySelectorAll('.link-input-row').forEach(row => {
        const url = row.querySelector('.link-url')?.value.trim();
        const type = row.querySelector('.link-type')?.value;
        if (url) {
            links.push({ url, label: type, type });
        }
    });

    const groupId = document.getElementById('place-group').value;
    const customLabel = document.getElementById('place-custom-label')?.value.trim() || '';
    const useCustomColor = !!document.getElementById('place-use-custom-color')?.checked;
    const customColor = document.getElementById('place-custom-color')?.value || '#E5B23A';
    const tagsString = document.getElementById('place-tags')?.value.trim() || '';
    const tags = tagsString ? tagsString.split(',').map(t => t.trim()).filter(Boolean) : [];

    const placeId = editingPlaceId || generateId();
    
    showToast('שומר את השינויים...', 'info');

    uploadPendingImages(placeId).then(uploadedImages => {
        let placeObj = null;

        if (editingPlaceId) {
            const index = places.findIndex(p => p.id === editingPlaceId);
            if (index !== -1) {
                places[index] = {
                    ...places[index],
                    name,
                    description,
                    lat,
                    lng,
                    customLabel,
                    useCustomColor,
                    customColor,
                    images: uploadedImages,
                    gpxData: pendingGpxData,
                    links,
                    groupId,
                    tags,
                    updatedAt: Date.now()
                };
                placeObj = places[index];
            }
            showToast('המקום עודכן בהצלחה!', 'success');
        } else {
            const newPlace = {
                id: placeId,
                name,
                description,
                lat,
                lng,
                customLabel,
                useCustomColor,
                customColor,
                images: uploadedImages,
                gpxData: pendingGpxData,
                links,
                groupId,
                tags,
                createdAt: Date.now()
            };
            places.push(newPlace);
            placeObj = newPlace;
            showToast('המקום נוסף בהצלחה!', 'success');
        }

        // Sync to cloud
        if (window.IS_FIREBASE_CONFIGURED && window.db && placeObj) {
            window.db.collection('places').doc(placeId).set(placeObj)
                .catch(err => console.error("Error syncing place to Firebase:", err));
        }

        savePlaces();
        renderGroupTabs();
        renderPlaces();
        renderMarkers();
        fitMapBounds();
        drawAllGpxTracks();
        closeModal();
    }).catch(err => {
        console.error("Error during image upload/save:", err);
        showToast('שגיאה בשמירת המקום', 'error');
    });
}

// ============= Delete =============
function confirmDelete(placeId) {
    deleteTargetId = placeId;
    const overlay = document.getElementById('confirm-overlay');
    overlay.classList.add('active');
}

function executeDelete() {
    if (!deleteTargetId) return;
    
    if (activePolylines) {
        activePolylines.forEach(p => p.setMap(null));
        activePolylines = [];
    }

    // Sync to cloud
    if (window.IS_FIREBASE_CONFIGURED && window.db) {
        window.db.collection('places').doc(deleteTargetId).delete()
            .catch(err => console.error("Error deleting place from Firebase:", err));
    }

    places = places.filter(p => p.id !== deleteTargetId);
    savePlaces();
    renderGroupTabs();
    renderPlaces();
    renderMarkers();
    fitMapBounds();
    drawAllGpxTracks();

    const overlay = document.getElementById('confirm-overlay');
    overlay.classList.remove('active');
    deleteTargetId = null;

    showToast('המקום נמחק בהצלחה', 'success');
}

// ============= Search (Google Places Autocomplete) =============
let autocomplete = null;
let quickAutocomplete = null;

function initAutocomplete() {
    const input = document.getElementById('place-search');
    if (input) {
        autocomplete = new google.maps.places.Autocomplete(input, {
            fields: ['name', 'geometry', 'formatted_address', 'url'],
            types: ['geocode', 'establishment']
        });

        autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();
            if (!place.geometry || !place.geometry.location) {
                showToast('מקום לא נמצא, נסה לבחור מהרשימה', 'error');
                return;
            }

            const lat = place.geometry.location.lat();
            const lng = place.geometry.location.lng();

            // Extract clean name
            const name = place.name || input.value.split(',')[0].trim();

            document.getElementById('place-name').value = name;
            document.getElementById('place-lat').value = lat;
            document.getElementById('place-lng').value = lng;
            document.getElementById('place-google-url').value = place.url || `https://www.google.com/maps?q=${lat},${lng}`;

            updateMiniMap(lat, lng);
        });
    }

    // Quick Add Place Autocomplete inside day edit modal
    const quickInput = document.getElementById('day-edit-quick-search');
    if (quickInput) {
        quickAutocomplete = new google.maps.places.Autocomplete(quickInput, {
            fields: ['name', 'geometry', 'formatted_address', 'url'],
            types: ['geocode', 'establishment']
        });

        quickAutocomplete.addListener('place_changed', () => {
            const place = quickAutocomplete.getPlace();
            if (!place.geometry || !place.geometry.location) {
                showToast('מקום לא נמצא, נסה לבחור מהרשימה', 'error');
                return;
            }

            const lat = place.geometry.location.lat();
            const lng = place.geometry.location.lng();
            const name = place.name || quickInput.value.split(',')[0].trim();

            document.getElementById('day-edit-quick-name').value = name;
            document.getElementById('day-edit-quick-lat').value = lat;
            document.getElementById('day-edit-quick-lng').value = lng;
            document.getElementById('day-edit-quick-url').value = place.url || `https://www.google.com/maps?q=${lat},${lng}`;
        });
    }
}

// ============= Image Upload =============
function handleImageUpload(files) {
    Array.from(files).forEach(file => {
        if (!file.type.startsWith('image/')) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            // Compress image
            compressImage(e.target.result, (compressed) => {
                pendingImages.push(compressed);
                renderImagePreviews();
            });
        };
        reader.readAsDataURL(file);
    });
}

function compressImage(dataUrl, callback) {
    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_SIZE = 600;
        let width = img.width;
        let height = img.height;

        if (width > height) {
            if (width > MAX_SIZE) {
                height = height * (MAX_SIZE / width);
                width = MAX_SIZE;
            }
        } else {
            if (height > MAX_SIZE) {
                width = width * (MAX_SIZE / height);
                height = MAX_SIZE;
            }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        callback(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.src = dataUrl;
}

function renderImagePreviews() {
    const container = document.getElementById('image-previews');
    container.innerHTML = '';

    pendingImages.forEach((src, index) => {
        const item = document.createElement('div');
        item.className = 'preview-item';
        item.innerHTML = `
            <img src="${src}" alt="תמונה ${index + 1}">
            <button class="remove-preview" data-index="${index}">
                <i class="fas fa-times"></i>
            </button>
        `;
        item.querySelector('.remove-preview').addEventListener('click', (e) => {
            e.stopPropagation();
            pendingImages.splice(index, 1);
            renderImagePreviews();
        });
        container.appendChild(item);
    });
}

// ============= Link Inputs =============
function addLinkInput(url, type) {
    const container = document.getElementById('links-container');
    const row = document.createElement('div');
    row.className = 'link-input-row';
    row.innerHTML = `
        <select class="link-type">
            <option value="website" ${type === 'website' ? 'selected' : ''}>🌐 אתר</option>
            <option value="instagram" ${type === 'instagram' ? 'selected' : ''}>📷 Instagram</option>
            <option value="tiktok" ${type === 'tiktok' ? 'selected' : ''}>🎵 TikTok</option>
            <option value="youtube" ${type === 'youtube' ? 'selected' : ''}>▶️ YouTube</option>
            <option value="facebook" ${type === 'facebook' ? 'selected' : ''}>📘 Facebook</option>
            <option value="other" ${type === 'other' ? 'selected' : ''}>🔗 אחר</option>
        </select>
        <input type="text" class="link-url" placeholder="הדבק קישור..." value="${url || ''}">
        <button type="button" class="link-remove-btn"><i class="fas fa-times"></i></button>
    `;

    row.querySelector('.link-remove-btn').addEventListener('click', () => {
        row.remove();
    });

    container.appendChild(row);
}

// ============= Toast =============
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const icon = document.getElementById('toast-icon');
    const msg = document.getElementById('toast-message');

    toast.className = 'toast ' + type;
    msg.textContent = message;

    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-exclamation-circle',
        info: 'fas fa-info-circle'
    };
    icon.className = icons[type] || icons.info;

    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// ============= Utilities =============
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function logFirebaseError(message, err) {
    console.error(message, err);
    if (err && typeof err === 'object') {
        console.error("Firebase Error Details:", {
            code: err.code || 'unknown',
            message: err.message || 'no-message',
            name: err.name || 'FirebaseError',
            stack: err.stack || ''
        });
    }
}

function hexToHsl(hex) {
    let r = parseInt(hex.slice(1, 3), 16) / 255;
    let g = parseInt(hex.slice(3, 5), 16) / 255;
    let b = parseInt(hex.slice(5, 7), 16) / 255;

    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0;
    } else {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }

    return {
        h: Math.round(h * 360),
        s: Math.round(s * 100),
        l: Math.round(l * 100)
    };
}

function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    let c = (1 - Math.abs(2 * l - 1)) * s;
    let x = c * (1 - Math.abs((h / 60) % 2 - 1));
    let m = l - c / 2;
    let r = 0, g = 0, b = 0;

    if (0 <= h && h < 60) {
        r = c; g = x; b = 0;
    } else if (60 <= h && h < 120) {
        r = x; g = c; b = 0;
    } else if (120 <= h && h < 180) {
        r = 0; g = c; b = x;
    } else if (180 <= h && h < 240) {
        r = 0; g = x; b = c;
    } else if (240 <= h && h < 300) {
        r = x; g = 0; b = c;
    } else if (300 <= h && h < 360) {
        r = c; g = 0; b = x;
    }

    let rHex = Math.round((r + m) * 255).toString(16).padStart(2, '0');
    let gHex = Math.round((g + m) * 255).toString(16).padStart(2, '0');
    let bHex = Math.round((b + m) * 255).toString(16).padStart(2, '0');

    return `#${rHex}${gHex}${bHex}`;
}

function getPlaceColor(place) {
    if (place.useCustomColor && place.customColor) {
        return place.customColor;
    }
    
    const group = getGroupById(place.groupId);
    const baseColor = group ? group.color : '#2C4E72';
    
    if (!group) return baseColor;
    
    // Sort all places in the same group by creation date
    const groupPlaces = places
        .filter(p => p.groupId === place.groupId)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        
    const index = groupPlaces.findIndex(p => p.id === place.id);
    if (index <= 0) return baseColor;
    
    try {
        const hsl = hexToHsl(baseColor);
        // Vary the hue by 35 degrees per index to get distinct colors, maintaining saturation and lightness
        const shiftedHue = (hsl.h + index * 35) % 360;
        return hslToHex(shiftedHue, hsl.s, hsl.l);
    } catch (e) {
        console.error("Error generating place color:", e);
        return baseColor;
    }
}

// ============= Google Places Details Panel =============
function showGooglePlaceDetails(placeId) {
    const panel = document.getElementById('google-place-panel');
    const content = document.getElementById('google-place-content');
    
    // Slide panel in
    panel.classList.add('active');
    
    // Show loading state
    content.innerHTML = `
        <div style="padding: 60px 40px; text-align: center; color: var(--text-secondary);">
            <i class="fas fa-spinner fa-spin" style="font-size: 32px; color: var(--primary); margin-bottom: 16px;"></i>
            <p>טוען פרטים מ-Google Maps...</p>
        </div>
    `;
    
    if (!placesService) return;
    
    placesService.getDetails({
        placeId: placeId,
        fields: ['name', 'rating', 'formatted_address', 'photos', 'reviews', 'url', 'website', 'international_phone_number', 'geometry', 'types']
    }, (place, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK) {
            renderGooglePlaceDetails(place);
        } else {
            content.innerHTML = `
                <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                    <i class="fas fa-exclamation-circle" style="font-size: 32px; color: var(--accent-rose); margin-bottom: 12px;"></i>
                    <p>לא ניתן היה לטעון את פרטי המקום.</p>
                </div>
            `;
        }
    });
}

function renderGooglePlaceDetails(place) {
    const content = document.getElementById('google-place-content');
    
    // Get cover photo (use first photo from Google)
    let coverPhoto = '';
    if (place.photos && place.photos.length > 0) {
        coverPhoto = place.photos[0].getUrl({ maxWidth: 600, maxHeight: 400 });
    }
    
    // Rating HTML
    let ratingHtml = '';
    if (place.rating) {
        let stars = '';
        const fullStars = Math.round(place.rating);
        for (let i = 1; i <= 5; i++) {
            stars += `<i class="${i <= fullStars ? 'fas' : 'far'} fa-star"></i>`;
        }
        const reviewsCount = place.reviews ? place.reviews.length : 0;
        ratingHtml = `
            <div class="details-rating-row">
                <span class="details-stars">${stars}</span>
                <span><strong>${place.rating}</strong></span>
                <span>(${reviewsCount} ביקורות)</span>
            </div>
        `;
    } else {
        ratingHtml = `<div class="details-rating-row"><span>אין דירוג עדיין</span></div>`;
    }
    
    // Cover image container HTML
    const coverHtml = coverPhoto ? `
        <div class="details-cover-container">
            <img src="${coverPhoto}" alt="${place.name}" class="details-cover-img">
        </div>
    ` : `
        <div class="details-cover-container placeholder">
            <i class="fas fa-map-marked-alt"></i>
        </div>
    `;

    // Category
    const category = (place.types && place.types.length > 0) ? translatePlaceType(place.types[0]) : 'נקודת עניין';

    // Photos HTML
    let photosHtml = '';
    if (place.photos && place.photos.length > 1) {
        let thumbs = '';
        place.photos.slice(1, 10).forEach(photo => {
            const url = photo.getUrl({ maxWidth: 200, maxHeight: 150 });
            const fullUrl = photo.getUrl({ maxWidth: 1200, maxHeight: 800 });
            thumbs += `<img src="${url}" class="details-photo-thumb" onclick="openLightbox('${fullUrl}')" alt="תמונה">`;
        });
        photosHtml = `
            <div style="padding: 24px; border-bottom: 1.5px dashed var(--border-light);">
                <h3 class="details-section-title">תמונות מהמקום</h3>
                <div class="details-photos-scroll">
                    ${thumbs}
                </div>
            </div>
        `;
    }

    // Reviews HTML
    let reviewsHtml = '';
    if (place.reviews && place.reviews.length > 0) {
        let cards = '';
        place.reviews.forEach(rev => {
            let revStars = '';
            const ratingVal = Math.round(rev.rating || 5);
            for (let i = 1; i <= 5; i++) {
                revStars += `<i class="${i <= ratingVal ? 'fas' : 'far'} fa-star" style="color:var(--accent-star); font-size:11px;"></i>`;
            }
            cards += `
                <div class="details-review-card">
                    <div class="details-review-header">
                        <span class="details-review-author">${escapeHtml(rev.author_name)}</span>
                        <span class="details-review-stars">${revStars}</span>
                    </div>
                    <p class="details-review-text">${escapeHtml(rev.text)}</p>
                    <span class="details-review-time">${escapeHtml(rev.relative_time_description)}</span>
                </div>
            `;
        });
        reviewsHtml = `
            <div style="padding: 24px;">
                <h3 class="details-section-title">ביקורות מובילות</h3>
                <div class="details-reviews-list">
                    ${cards}
                </div>
            </div>
        `;
    }

    // Build the overall content
    content.innerHTML = `
        ${coverHtml}
        
        <div style="padding: 24px; border-bottom: 1.5px dashed var(--border-light);">
            <span class="details-category">${category}</span>
            <h2 class="details-title" style="margin-top: 8px;">${place.name}</h2>
            ${ratingHtml}
        </div>
        
        <div class="details-actions-row">
            <button class="btn-primary btn-sm" id="btn-details-add"><i class="fas fa-plus"></i> הוסף למסלול</button>
            <a href="${place.url}" target="_blank" class="btn-outline btn-sm" style="text-decoration:none;"><i class="fas fa-map-marked-alt"></i> גוגל מפות</a>
        </div>
        
        <div style="padding: 24px; border-bottom: 1.5px dashed var(--border-light); display: flex; flex-direction: column; gap: 16px;">
            <div class="details-item">
                <i class="fas fa-map-marker-alt"></i>
                <span>${place.formatted_address}</span>
            </div>
            ${place.international_phone_number ? `
                <div class="details-item">
                    <i class="fas fa-phone-alt"></i>
                    <span>${place.international_phone_number}</span>
                </div>
            ` : ''}
            ${place.website ? `
                <div class="details-item">
                    <i class="fas fa-globe"></i>
                    <a href="${place.website}" target="_blank" style="word-break: break-all;">אתר אינטרנט</a>
                </div>
            ` : ''}
        </div>
        
        ${photosHtml}
        ${reviewsHtml}
    `;

    // Hook up Add to Route button
    document.getElementById('btn-details-add').addEventListener('click', () => {
        openModalFromGooglePlace(place);
    });
}

function closeGooglePlacePanel() {
    document.getElementById('google-place-panel').classList.remove('active');
}

function openModalFromGooglePlace(place) {
    // Close the details panel
    closeGooglePlacePanel();

    // Open standard modal in 'add' mode (resets form & pendingImages)
    openModal('add');
    
    // Fill in Google Place details
    document.getElementById('place-name').value = place.name;
    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();
    document.getElementById('place-lat').value = lat;
    document.getElementById('place-lng').value = lng;
    document.getElementById('place-google-url').value = place.url || `https://www.google.com/maps?q=${lat},${lng}`;
    document.getElementById('place-search').value = place.formatted_address;
    
    // Populate group selector with active group (except if it is 'all')
    const groupSelect = document.getElementById('place-group');
    if (activeGroupId !== 'all') {
        groupSelect.value = activeGroupId;
    } else {
        groupSelect.value = '';
    }
    
    // Fetch Google Place photos and add them to pendingImages
    if (place.photos && place.photos.length > 0) {
        // Take top 3 photos from Google Places
        const urls = place.photos.slice(0, 3).map(p => p.getUrl({ maxWidth: 800, maxHeight: 600 }));
        pendingImages = [...urls];
        renderImagePreviews();
    }
    
    updateMiniMap(lat, lng);
}

function translatePlaceType(type) {
    const translations = {
        'natural_feature': 'אתר טבע',
        'tourist_attraction': 'אטרקציה תיירותית',
        'park': 'פארק',
        'point_of_interest': 'נקודת עניין',
        'establishment': 'עסק / מוסד',
        'restaurant': 'מסעדה',
        'cafe': 'בית קפה',
        'lodging': 'מקום לינה',
        'hotel': 'מלון',
        'museum': 'מוזיאון',
        'church': 'כנסייה',
        'mosque': 'מסגד',
        'synagogue': 'בית כנסת',
        'store': 'חנות',
        'locality': 'יישוב',
        'colloquial_area': 'אזור'
    };
    return translations[type] || 'נקודת עניין';
}

// ============= Event Listeners =============
function initEvents() {
    // Search input listener – debounced (300ms) to prevent re-rendering on every keystroke
    const searchInput = document.getElementById('search-places-input');
    if (searchInput) {
        const debouncedSearch = debounce((value) => {
            searchQuery = value;
            renderPlaces();
        }, 300);
        searchInput.addEventListener('input', (e) => {
            debouncedSearch(e.target.value);
        });
    }

    // Dark Mode Toggle
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    if (darkModeToggle) {
        darkModeToggle.addEventListener('click', () => {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            if (isDark) {
                document.documentElement.removeAttribute('data-theme');
                localStorage.setItem('theme', 'light');
                if (map) map.setOptions({ styles: customMapStyle });
            } else {
                document.documentElement.setAttribute('data-theme', 'dark');
                localStorage.setItem('theme', 'dark');
                if (map) map.setOptions({ styles: darkMapStyle });
            }
        });
    }

    // Toggle Places Panel
    const btnTogglePlaces = document.getElementById('btn-toggle-places');
    const btnClosePlaces = document.getElementById('btn-close-places-panel');
    const placesPanel = document.getElementById('places-panel');
    const placesItinDivider = document.getElementById('places-itin-divider');

    const togglePlacesPanel = () => {
        if (!placesPanel) return;
        const container = document.querySelector('.app-container');
        const isVisible = placesPanel.style.display !== 'none';
        if (isVisible) {
            placesPanel.style.display = 'none';
            if (placesItinDivider) placesItinDivider.style.display = 'none';
            btnTogglePlaces?.classList.remove('active');
            container?.classList.add('places-hidden');
            localStorage.setItem('places-panel-visible', 'false');
        } else {
            placesPanel.style.display = 'flex';
            if (placesItinDivider && window.innerWidth > 900) placesItinDivider.style.display = 'block';
            btnTogglePlaces?.classList.add('active');
            container?.classList.remove('places-hidden');
            localStorage.setItem('places-panel-visible', 'true');
        }
        if (typeof map !== 'undefined' && map) {
            setTimeout(() => {
                google.maps.event.trigger(map, 'resize');
            }, 50);
        }
    };

    btnTogglePlaces?.addEventListener('click', togglePlacesPanel);
    btnClosePlaces?.addEventListener('click', togglePlacesPanel);

    // Initial load state for places panel
    const placesVisible = localStorage.getItem('places-panel-visible') !== 'false';
    const appContainer = document.querySelector('.app-container');
    if (!placesVisible && placesPanel) {
        placesPanel.style.display = 'none';
        if (placesItinDivider) placesItinDivider.style.display = 'none';
        btnTogglePlaces?.classList.remove('active');
        appContainer?.classList.add('places-hidden');
    } else if (placesPanel) {
        placesPanel.style.display = 'flex';
        if (placesItinDivider && window.innerWidth > 900) placesItinDivider.style.display = 'block';
        btnTogglePlaces?.classList.add('active');
        appContainer?.classList.remove('places-hidden');
    }

    // Layout Selector Event Listeners
    const btnLayout = document.getElementById('btn-layout-selector');
    const layoutDropdown = document.getElementById('layout-dropdown');

    if (btnLayout && layoutDropdown) {
        btnLayout.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = layoutDropdown.style.display !== 'none';
            if (!isVisible) {
                // Position dynamically relative to button bounding rect (fixed placement)
                const rect = btnLayout.getBoundingClientRect();
                layoutDropdown.style.top = `${rect.bottom + 8}px`;
                layoutDropdown.style.right = `${window.innerWidth - rect.right}px`;
                layoutDropdown.style.left = 'auto'; // Reset left inline style
                layoutDropdown.style.display = 'flex';
            } else {
                layoutDropdown.style.display = 'none';
            }
        });

        document.addEventListener('click', () => {
            layoutDropdown.style.display = 'none';
        });

        layoutDropdown.querySelectorAll('.layout-dropdown-item').forEach(item => {
            item.addEventListener('click', () => {
                const layout = item.dataset.layout;
                setLayout(layout);
            });
        });
    }

    function setLayout(layout) {
        const container = document.querySelector('.app-container');
        if (!container) return;
        
        // Remove previous layout classes
        container.classList.remove('layout-cols', 'layout-map-left', 'layout-map-right');
        
        // Add selected layout class
        container.classList.add(`layout-${layout}`);
        localStorage.setItem('mytravel-app-layout', layout);

        // Update active dropdown item
        layoutDropdown?.querySelectorAll('.layout-dropdown-item').forEach(i => {
            if (i.dataset.layout === layout) {
                i.classList.add('active');
            } else {
                i.classList.remove('active');
            }
        });

        // Trigger maps resize
        if (typeof map !== 'undefined' && map) {
            setTimeout(() => {
                google.maps.event.trigger(map, 'resize');
            }, 100);
        }
    }

    // Load saved layout on init
    const savedLayout = localStorage.getItem('mytravel-app-layout') || 'cols';
    setLayout(savedLayout);

    // Add place button
    document.getElementById('btn-add-place').addEventListener('click', () => {
        openModal('add');
    });

    // Modal close
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('btn-cancel').addEventListener('click', closeModal);

    // Save place
    document.getElementById('btn-save').addEventListener('click', savePlace);

    // Toggle custom color input visibility
    const useCustomColorCheckbox = document.getElementById('place-use-custom-color');
    const customColorInput = document.getElementById('place-custom-color');
    if (useCustomColorCheckbox && customColorInput) {
        useCustomColorCheckbox.addEventListener('change', () => {
            customColorInput.style.display = useCustomColorCheckbox.checked ? 'inline-block' : 'none';
        });
    }

    // GPX Upload
    document.getElementById('btn-choose-gpx').addEventListener('click', () => {
        document.getElementById('gpx-input').click();
    });

    document.getElementById('gpx-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        parseGpxFile(file, (points, err) => {
            if (err) {
                showToast(err, 'error');
                return;
            }
            pendingGpxData = points;
            
            // Check if GPX points have elevation
            const hasEle = points && points.length > 0 && points.some(pt => pt.ele !== undefined && pt.ele !== null);
            const eleMsg = hasEle ? "מכיל נתוני גובה" : "ללא נתוני גובה";
            
            console.log(`[GPX Upload] File: ${file.name}, Points: ${points.length}, Elevation: ${hasEle}`);
            if (points.length > 0) {
                console.log(`[GPX Sample Point]`, points[0]);
            }
            
            document.getElementById('gpx-status').textContent = `טעון: ${file.name.substring(0, 15)}${file.name.length > 15 ? '...' : ''} (${points.length} נק', ${eleMsg})`;
            document.getElementById('btn-remove-gpx').style.display = 'block';
            
            if (hasEle) {
                showToast(`קובץ GPX נטען בהצלחה! (${eleMsg})`, 'success');
            } else {
                showToast(`קובץ GPX נטען בהצלחה, אך הוא אינו מכיל נתוני גובה.`, 'warning');
            }
        });
    });

    document.getElementById('btn-remove-gpx').addEventListener('click', () => {
        pendingGpxData = null;
        document.getElementById('gpx-input').value = '';
        document.getElementById('gpx-status').textContent = 'לא נבחר מסלול';
        document.getElementById('btn-remove-gpx').style.display = 'none';
        showToast('קובץ GPX הוסר', 'info');
    });



    // Image upload - click
    document.getElementById('upload-zone').addEventListener('click', () => {
        document.getElementById('image-input').click();
    });

    document.getElementById('btn-choose-files')?.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('image-input').click();
    });

    document.getElementById('image-input').addEventListener('change', (e) => {
        handleImageUpload(e.target.files);
        e.target.value = ''; // Reset for re-upload
    });

    // Image upload - drag & drop
    const uploadZone = document.getElementById('upload-zone');
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('drag-over');
    });
    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('drag-over');
    });
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('drag-over');
        handleImageUpload(e.dataTransfer.files);
    });

    // Add link button
    document.getElementById('btn-add-link').addEventListener('click', () => {
        addLinkInput('', 'website');
    });

    // Delete confirmation
    document.getElementById('confirm-cancel').addEventListener('click', () => {
        document.getElementById('confirm-overlay').classList.remove('active');
        deleteTargetId = null;
    });
    document.getElementById('confirm-delete').addEventListener('click', executeDelete);
    document.getElementById('confirm-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            e.currentTarget.classList.remove('active');
            deleteTargetId = null;
        }
    });

    // View toggle (desktop)
    document.getElementById('view-list').addEventListener('click', function() {
        document.getElementById('view-list').classList.add('active');
        document.getElementById('view-map').classList.remove('active');
        
        // Show places panel and divider
        const placesPanel = document.getElementById('places-panel');
        const divider = document.getElementById('resize-divider');
        const mapPanel = document.getElementById('map-panel');
        
        placesPanel.style.display = '';
        divider.style.display = '';
        
        // Restore map panel width
        mapPanel.style.width = mapPanel.dataset.prevWidth || '55%';
        
        if (typeof google !== 'undefined' && google.maps && map) {
            setTimeout(() => google.maps.event.trigger(map, 'resize'), 50);
        }
    });

    document.getElementById('view-map').addEventListener('click', function() {
        document.getElementById('view-map').classList.add('active');
        document.getElementById('view-list').classList.remove('active');
        
        // Hide places panel and divider
        const placesPanel = document.getElementById('places-panel');
        const divider = document.getElementById('resize-divider');
        const mapPanel = document.getElementById('map-panel');
        
        placesPanel.style.display = 'none';
        divider.style.display = 'none';
        
        // Save current width and force map to 100%
        mapPanel.dataset.prevWidth = mapPanel.style.width || '55%';
        mapPanel.style.width = '100%';
        
        if (typeof google !== 'undefined' && google.maps && map) {
            setTimeout(() => google.maps.event.trigger(map, 'resize'), 50);
        }
    });

    // Mobile Navigation Tabs switching
    const tabList = document.getElementById('mobile-tab-list');
    const tabMap = document.getElementById('mobile-tab-map');
    const tabItinerary = document.getElementById('mobile-tab-itinerary');

    function setMobileTab(activeTab) {
        // Remove all view classes
        document.body.classList.remove('mobile-view-list', 'mobile-view-map', 'mobile-view-itinerary');
        // Remove active from all tabs
        if (tabList) tabList.classList.remove('active');
        if (tabMap) tabMap.classList.remove('active');
        if (tabItinerary) tabItinerary.classList.remove('active');
        // Hide itinerary panel for non-itinerary tabs
        const itinPanel = document.getElementById('itinerary-panel');

        if (activeTab === 'list') {
            document.body.classList.add('mobile-view-list');
            if (tabList) tabList.classList.add('active');
            if (itinPanel) itinPanel.style.display = 'none';
        } else if (activeTab === 'map') {
            document.body.classList.add('mobile-view-map');
            if (tabMap) tabMap.classList.add('active');
            if (itinPanel) itinPanel.style.display = 'none';
            // Trigger Map resize
            if (typeof google !== 'undefined' && google.maps && map) {
                setTimeout(() => {
                    google.maps.event.trigger(map, 'resize');
                    const activePlace = places.find(p => p.isHighlighted);
                    if (activePlace && activePlace.lat && activePlace.lng) {
                        map.setCenter({ lat: activePlace.lat, lng: activePlace.lng });
                    } else if (places.length > 0 && places[0].lat && places[0].lng) {
                        map.setCenter({ lat: places[0].lat, lng: places[0].lng });
                    } else {
                        map.setCenter({ lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] });
                    }
                }, 100);
            }
        } else if (activeTab === 'itinerary') {
            document.body.classList.add('mobile-view-itinerary');
            if (tabItinerary) tabItinerary.classList.add('active');
            if (itinPanel) itinPanel.style.display = 'flex';
        }
    }

    if (tabList) {
        tabList.addEventListener('click', () => setMobileTab('list'));
    }
    if (tabMap) {
        tabMap.addEventListener('click', () => setMobileTab('map'));
    }
    if (tabItinerary) {
        tabItinerary.addEventListener('click', () => setMobileTab('itinerary'));
    }


    // Google Place Details Panel Close
    document.getElementById('google-place-close').addEventListener('click', closeGooglePlacePanel);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
            closeGroupsModal();
            closeGooglePlacePanel();
            document.getElementById('confirm-overlay').classList.remove('active');
            // Close lightbox
            const lightbox = document.querySelector('.lightbox-overlay');
            if (lightbox) lightbox.remove();
        }
    });

    // ===== Group Events =====
    // Manage groups button
    document.getElementById('btn-manage-groups').addEventListener('click', openGroupsModal);

    // Close groups modal
    document.getElementById('groups-modal-close').addEventListener('click', closeGroupsModal);
    document.getElementById('groups-modal-done').addEventListener('click', closeGroupsModal);
    document.getElementById('groups-modal-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeGroupsModal();
    });

    // Create group button
    document.getElementById('btn-create-group').addEventListener('click', () => {
        const nameInput = document.getElementById('new-group-name');
        const name = nameInput.value.trim();
        if (!name) {
            showToast('נא להזין שם קבוצה', 'error');
            nameInput.focus();
            return;
        }
        const descInput = document.getElementById('new-group-description');
        const description = descInput ? descInput.value.trim() : '';
        const selectedColor = document.querySelector('.color-option.selected')?.dataset.color || '#0D9488';
        const parentId = document.getElementById('new-group-parent')?.value || '';
        addGroup(name, selectedColor, parentId, description);
        nameInput.value = '';
        if (descInput) descInput.value = '';
        if (document.getElementById('new-group-parent')) document.getElementById('new-group-parent').value = '';
        renderGroupManageList();
        showToast(`הקבוצה "${name}" נוצרה!`, 'success');
    });

    // New group name enter key
    document.getElementById('new-group-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('btn-create-group').click();
        }
    });

    // Color picker
    document.getElementById('color-picker').addEventListener('click', (e) => {
        const option = e.target.closest('.color-option');
        if (!option) return;
        document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
    });

    // Inline new group from modal
    document.getElementById('btn-new-group-inline').addEventListener('click', () => {
        const name = prompt('שם קבוצה חדשה:');
        if (name && name.trim()) {
            const group = addGroup(name.trim(), '#2C4E72');
            document.getElementById('place-group').value = group.id;
            showToast(`הקבוצה "${name}" נוצרה!`, 'success');
        }
    });

    // Backup & Restore Events
    document.getElementById('btn-backup').addEventListener('click', openBackupModal);
    document.getElementById('btn-close-backup-modal').addEventListener('click', closeBackupModal);
    document.getElementById('btn-export-backup').addEventListener('click', exportBackup);
    document.getElementById('btn-trigger-import').addEventListener('click', () => {
        document.getElementById('import-file-input').click();
    });
    document.getElementById('import-file-input').addEventListener('change', importBackup);
    
    // Close backup modal on click outside content
    document.getElementById('backup-modal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('backup-modal')) {
            closeBackupModal();
        }
    });

    // Logo Double-Click Easter Egg
    const logoImg = document.querySelector('.logo-img');
    if (logoImg) {
        logoImg.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            logoImg.classList.toggle('zoomed');
        });
        
        // Clicking anywhere else shrinks the logo back to normal size
        document.addEventListener('click', () => {
            if (logoImg.classList.contains('zoomed')) {
                logoImg.classList.remove('zoomed');
            }
        });
    }

    // Splash Screen Start Button
    const startBtn = document.getElementById('btn-start-app');
    const splash = document.getElementById('splash-screen');
    if (startBtn && splash) {
        startBtn.addEventListener('click', () => {
            splash.classList.add('hide');
            setTimeout(() => {
                splash.remove(); // Remove from DOM after fade-out transition
            }, 800);
        });
    }

    // Google Maps Link Parser
    const loadGmapsLinkBtn = document.getElementById('btn-load-gmaps-link');
    if (loadGmapsLinkBtn) {
        loadGmapsLinkBtn.addEventListener('click', handleGmapsLinkImport);
    }

    // Roadbook Modal Event Bindings
    const roadbookModal = document.getElementById('roadbook-modal');
    if (roadbookModal) {
        document.getElementById('btn-close-roadbook-modal').addEventListener('click', closeRoadbookModal);
        document.getElementById('btn-print-roadbook').addEventListener('click', () => {
            window.print();
        });
        document.getElementById('btn-download-pdf').addEventListener('click', async () => {
            const body = document.getElementById('roadbook-modal-body');
            if (!body) return;
            const activeRoadbook = roadbookModal.$activeRoadbook;
            const name = activeRoadbook ? activeRoadbook.name : 'roadbook';
            
            showToast('מייצר קובץ PDF, אנא המתן...', 'info');
            
            try {
                // Temporary remove scrollbar / overflow restrictions for canvas snapshot
                const originalHeight = body.style.height;
                const originalOverflow = body.style.overflow;
                body.style.height = 'auto';
                body.style.overflow = 'visible';
                
                const canvas = await html2canvas(body, {
                    scale: 2,
                    useCORS: true,
                    backgroundColor: '#ffffff'
                });
                
                body.style.height = originalHeight;
                body.style.overflow = originalOverflow;
                
                const imgData = canvas.toDataURL('image/png');
                const { jsPDF } = window.jspdf;
                const pdf = new jsPDF('p', 'mm', 'a4');
                const pdfWidth = pdf.internal.pageSize.getWidth();
                const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
                
                let heightLeft = pdfHeight;
                let position = 0;
                
                pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
                heightLeft -= pdf.internal.pageSize.getHeight();
                
                while (heightLeft > 0) {
                    position = heightLeft - pdfHeight;
                    pdf.addPage();
                    pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
                    heightLeft -= pdf.internal.pageSize.getHeight();
                }
                
                pdf.save(`roadbook_${name}.pdf`);
                showToast('קובץ PDF הורד בהצלחה!', 'success');
            } catch (err) {
                console.error('PDF Generation Error:', err);
                showToast('שגיאה במהלך יצירת ה-PDF', 'error');
            }
        });
        document.getElementById('btn-export-roadbook-csv').addEventListener('click', () => {
            if (roadbookModal.$activeRoadbook && roadbookModal.$activePlace) {
                downloadRoadbookCsv(roadbookModal.$activeRoadbook, roadbookModal.$activePlace);
            }
        });
        
        // Close on click outside modal-content
        roadbookModal.addEventListener('click', (e) => {
            if (e.target === roadbookModal) {
                closeRoadbookModal();
            }
        });
    }
}

// ============= Backup & Restore =============
function openBackupModal() {
    document.getElementById('backup-modal').classList.add('show');
    document.getElementById('import-status').textContent = '';
    document.getElementById('import-file-input').value = '';
}

function closeBackupModal() {
    document.getElementById('backup-modal').classList.remove('show');
}

function exportBackup() {
    try {
        const backupData = {
            version: "1.1",
            exportedAt: new Date().toISOString(),
            places: places,
            groups: groups,
            itineraries: (typeof itineraries !== 'undefined') ? itineraries : []
        };

        const jsonString = JSON.stringify(backupData, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        
        const dateStr = new Date().toISOString().slice(0, 10);
        const filename = `travel_site_backup_${dateStr}.json`;
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast("הגיבוי יוצא בהצלחה!", "success");
    } catch (e) {
        console.error("Backup export failed:", e);
        showToast("ייצוא הגיבוי נכשל", "error");
    }
}

function importBackup(e) {
    const file = e.target.files[0];
    if (!file) return;

    const statusDiv = document.getElementById('import-status');
    statusDiv.style.color = '#3B82F6';
    statusDiv.textContent = 'טוען קובץ...';

    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const data = JSON.parse(evt.target.result);
            
            // Validation
            if (!data || !Array.isArray(data.places) || !Array.isArray(data.groups)) {
                throw new Error("קובץ גיבוי לא תקין. חסרים נתוני מיקומים או קבוצות.");
            }
            
            statusDiv.textContent = 'מייבא נתונים ומסנכרן לענן...';
            
            // Update local state
            places = data.places;
            groups = data.groups;
            
            // Import itineraries if present in backup
            if (Array.isArray(data.itineraries) && typeof itineraries !== 'undefined') {
                itineraries = data.itineraries;
                localStorage.setItem('mytravel-itineraries', JSON.stringify(itineraries));
            }
            
            // Save to LocalStorage
            localStorage.setItem(STORAGE_KEY, JSON.stringify(places));
            localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
            
            // Sync to Firebase Firestore if configured
            if (window.IS_FIREBASE_CONFIGURED && window.db) {
                const promises = [];
                
                groups.forEach(g => {
                    promises.push(window.db.collection('groups').doc(g.id).set(g));
                });
                
                places.forEach(p => {
                    promises.push(window.db.collection('places').doc(p.id).set(p));
                });
                
                // Sync itineraries to Firebase
                if (Array.isArray(data.itineraries)) {
                    data.itineraries.forEach(it => {
                        promises.push(window.db.collection('itineraries').doc(it.id).set(it));
                    });
                }
                
                Promise.all(promises).then(() => {
                    finalizeImport(statusDiv);
                }).catch(err => {
                    console.error("Sync failed during import:", err);
                    statusDiv.style.color = '#EF4444';
                    statusDiv.textContent = 'הייבוא הושלם מקומית אך הסנכרון לענן נכשל.';
                    finalizeImportLocal();
                });
            } else {
                finalizeImport(statusDiv);
            }
        } catch (err) {
            console.error("Backup import failed:", err);
            statusDiv.style.color = '#EF4444';
            statusDiv.textContent = err.message || "פענוח הקובץ נכשל.";
            showToast("ייבוא הגיבוי נכשל", "error");
        }
    };
    reader.readAsText(file);
}

function finalizeImport(statusDiv) {
    statusDiv.style.color = '#10B981';
    statusDiv.textContent = 'הגיבוי יובא וסונכרן בהצלחה!';
    
    // Refresh UI
    renderGroupTabs();
    renderGroupSelect();
    renderPlaces();
    renderMarkers();
    drawAllGpxTracks();
    
    showToast("הנתונים יובאו ושוחזרו בהצלחה!", "success");
    setTimeout(closeBackupModal, 1500);
}

function finalizeImportLocal() {
    renderGroupTabs();
    renderGroupSelect();
    renderPlaces();
    renderMarkers();
    drawAllGpxTracks();
    showToast("הנתונים שוחזרו מקומית בלבד", "warning");
}

// ============= Initialize =============
function init() {
    // Register Service Worker for PWA with Auto-Update Check
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => {
                    console.log('[Service Worker] Registered successfully:', reg.scope);
                    
                    // Check for updates periodically
                    reg.addEventListener('updatefound', () => {
                        const newWorker = reg.installing;
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                // New version is installed and waiting to be activated
                                showToast('גרסה חדשה של האפליקציה זמינה! מעדכן...', 'success');
                                setTimeout(() => {
                                    window.location.reload();
                                }, 1500);
                            }
                        });
                    });
                })
                .catch(err => console.log('[Service Worker] Registration failed:', err));
        });
    }

    // Add default mobile view class on startup
    document.body.classList.add('mobile-view-list');

    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
    loadGroups();
    loadPlaces();
    
    const hasGoogle = (typeof google !== 'undefined' && google.maps);
    if (hasGoogle) {
        initMap();
        initAutocomplete();
    } else {
        console.warn("Google Maps is not loaded. Switching to offline map mode.");
        isOfflineMode = true;
        document.body.classList.add('offline-map-active');
        const toggleOffline = document.getElementById('toggle-simulate-offline');
        if (toggleOffline) toggleOffline.checked = true;
    }
    
    renderGroupTabs();
    renderGroupSelect();
    renderPlaces();
    
    if (hasGoogle) {
        renderMarkers();
        drawAllGpxTracks();
    } else {
        // Wait a bit for Leaflet initialization
        setTimeout(() => {
            syncLeafletView();
        }, 200);
    }
    
    initEvents();
    initResizablePanels();
    
    // Adjust layout for mobile screen sizes
    if (typeof adjustLayoutForMobile === 'function') {
        adjustLayoutForMobile();
    }

    const groupsScroll = document.querySelector('.groups-scroll');
    const subGroupsScroll = document.getElementById('sub-groups-scroll');
    initHorizontalDragScroll(groupsScroll);
    initHorizontalDragScroll(subGroupsScroll);

    // Show firebase status
    if (typeof window.IS_FIREBASE_CONFIGURED !== 'undefined' && !window.IS_FIREBASE_CONFIGURED) {
        console.log('%c🌍 Bialik\'s Travels: משתמש ב-localStorage. לגיבוי בענן, הגדר Firebase ב-firebase-config.js', 'color: #2C4E72; font-size: 14px; font-weight: bold;');
    }

    // Handle URL parameters for shared places
    const urlParams = new URLSearchParams(window.location.search);
    const sharedPlaceId = urlParams.get('placeId');
    if (sharedPlaceId) {
        setTimeout(() => {
            const place = places.find(p => p.id === sharedPlaceId);
            if (place) {
                const grp = getGroupById(place.groupId);
                if (grp) {
                    if (grp.parentId) {
                        setActiveGroup(grp.parentId);
                        setActiveSubGroup(grp.id);
                    } else {
                        setActiveGroup(grp.id);
                    }
                }
                scrollToCard(sharedPlaceId);
                setActiveMarker(sharedPlaceId, true);
                
                const marker = markers.find(m => m.placeId === sharedPlaceId);
                if (marker) {
                    google.maps.event.trigger(marker, 'click');
                }
            }
        }, 800);
    }

    // Check if admin is already logged in
    if (typeof checkAdminMode === 'function') {
        checkAdminMode();
    }
}

// Start app
document.addEventListener('DOMContentLoaded', init);

// ============= GPX Walk Animation & Recording Engine =============
let animPlayState = 'idle'; // 'idle', 'playing', 'paused'
let animCurrentIndex = 0;
let animPoints = [];
let animWalkerMarker = null;
let animAnimationFrameId = null;
let animSpeed = 10;
let animDirection = 'forward'; // 'forward', 'reverse'
let animActivePlace = null;

let recordStream = null;
let recordMediaRecorder = null;
let recordChunks = [];
let isRecordingActive = false;
let isCinematicModeActive = false;

function openRecordingControlBar(place) {
    // If a bar is already open, close it first
    closeRecordingControlBar();
    
    animActivePlace = place;
    animPoints = place.isReversed ? [...(place.gpxData || [])].reverse() : (place.gpxData || []);
    if (animPoints.length === 0) {
        showToast('אין נקודות מסלול להנפשה', 'error');
        return;
    }
    
    animCurrentIndex = 0;
    animPlayState = 'idle';
    animSpeed = 10;
    animDirection = 'forward';
    
    const placeColor = getPlaceColor(place);
    
    // Create the control bar element
    const bar = document.createElement('div');
    bar.className = 'recording-control-bar';
    bar.id = 'recording-control-bar';
    
    bar.innerHTML = `
        <!-- Title and Stats -->
        <div class="control-section">
            <span class="control-title">
                <i class="fas fa-route" style="color: ${placeColor}; animation: recordPulse 2s infinite;"></i>
                <span>${escapeHtml(place.name)}</span>
            </span>
        </div>
        
        <!-- Speed Selector -->
        <div class="control-section">
            <label for="anim-speed" style="font-size:12px; font-weight:bold; color:var(--text-secondary);">מהירות:</label>
            <select id="anim-speed">
                <option value="1">1x (איטי)</option>
                <option value="5">5x</option>
                <option value="10" selected>10x</option>
                <option value="25">25x</option>
                <option value="50">50x (מהיר)</option>
            </select>
        </div>
        
        <!-- Direction Selector -->
        <div class="control-section">
            <label for="anim-dir" style="font-size:12px; font-weight:bold; color:var(--text-secondary);">כיוון:</label>
            <select id="anim-dir">
                <option value="forward" selected>קדימה ➔</option>
                <option value="reverse">הפוך 🚶‍♂️ ➔ 🏃‍♂️</option>
            </select>
        </div>
        
        <!-- Play / Pause Button -->
        <button class="control-btn control-btn-play" id="btn-anim-play">
            <i class="fas fa-play"></i> <span>הפעל</span>
        </button>
        
        <!-- Record Button -->
        <button class="control-btn control-btn-record" id="btn-anim-record">
            <i class="fas fa-circle"></i> <span>הקלט מסך</span>
        </button>
        
        <!-- Cinematic Toggle -->
        <div class="control-section" style="margin-right: 8px;">
            <label style="display:flex; align-items:center; gap:6px; font-size:12.5px; font-weight:bold; color:var(--text-secondary); cursor:pointer;">
                <input type="checkbox" id="chk-cinematic" style="cursor:pointer;">
                <span>מצב קולנועי (נקי)</span>
            </label>
        </div>
        
        <!-- Close Button -->
        <button class="control-btn control-btn-close" id="btn-anim-close">
            <i class="fas fa-times"></i> <span>סגור</span>
        </button>
        
        <!-- Progress Bar -->
        <div class="recording-progress-container">
            <div class="recording-progress-fill" id="anim-progress-fill"></div>
        </div>
    `;
    
    document.getElementById('map-panel').appendChild(bar);
    
    // Bind Event Listeners
    bar.querySelector('#anim-speed').addEventListener('change', (e) => {
        animSpeed = parseInt(e.target.value) || 10;
    });
    
    bar.querySelector('#anim-dir').addEventListener('change', (e) => {
        animDirection = e.target.value;
        if (animPlayState === 'idle') {
            animCurrentIndex = (animDirection === 'forward') ? 0 : animPoints.length - 1;
            updateWalkerPosition();
        }
    });
    
    bar.querySelector('#btn-anim-play').addEventListener('click', toggleAnimPlay);
    bar.querySelector('#btn-anim-record').addEventListener('click', toggleScreenRecording);
    bar.querySelector('#chk-cinematic').addEventListener('change', (e) => {
        toggleCinematicMode(e.target.checked);
    });
    
    bar.querySelector('#btn-anim-close').addEventListener('click', () => {
        closeRecordingControlBar();
    });
    
    // Create walker marker
    const startPoint = animPoints[0];
    animCurrentIndex = 0;
    
    animWalkerMarker = new google.maps.Marker({
        position: { lat: startPoint.lat, lng: startPoint.lng },
        map: map,
        zIndex: 100000,
        icon: {
            url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                <svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" fill="${placeColor}" fill-opacity="0.25"/>
                    <circle cx="12" cy="12" r="5" fill="${placeColor}" stroke="#ffffff" stroke-width="2"/>
                    <text x="12" y="14" font-size="11" font-weight="bold" text-anchor="middle" fill="#ffffff" font-family="sans-serif">🚶</text>
                </svg>
            `),
            anchor: new google.maps.Point(19, 19)
        }
    });
    
    // Pan map to start point
    panToPlace(startPoint.lat, startPoint.lng);
    map.setZoom(15);
}

function closeRecordingControlBar() {
    // Stop animation
    if (animAnimationFrameId) {
        cancelAnimationFrame(animAnimationFrameId);
        animAnimationFrameId = null;
    }
    
    // Stop recording if active
    if (isRecordingActive) {
        stopScreenRecording();
    }
    
    // Restore cinematic mode if active
    if (isCinematicModeActive) {
        toggleCinematicMode(false);
    }
    
    // Remove walker marker
    if (animWalkerMarker) {
        animWalkerMarker.setMap(null);
        animWalkerMarker = null;
    }
    
    // Remove control bar from DOM
    const bar = document.getElementById('recording-control-bar');
    if (bar) {
        bar.remove();
    }
    
    animActivePlace = null;
    animPoints = [];
    animPlayState = 'idle';
}

function updateWalkerPosition() {
    if (!animWalkerMarker || animPoints.length === 0) return;
    const pt = animPoints[animCurrentIndex];
    if (pt) {
        const pos = { lat: pt.lat, lng: pt.lng };
        animWalkerMarker.setPosition(pos);
        
        // Dynamic icon flip/change based on direction
        const emoji = animDirection === 'forward' ? '🚶' : '🏃';
        const placeColor = getPlaceColor(animActivePlace);
        animWalkerMarker.setIcon({
            url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                <svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" fill="${placeColor}" fill-opacity="0.25"/>
                    <circle cx="12" cy="12" r="5" fill="${placeColor}" stroke="#ffffff" stroke-width="2"/>
                    <text x="12" y="14" font-size="11" font-weight="bold" text-anchor="middle" fill="#ffffff" font-family="sans-serif">${emoji}</text>
                </svg>
            `),
            anchor: new google.maps.Point(19, 19)
        });
        
        // Update progress bar
        const progressFill = document.getElementById('anim-progress-fill');
        if (progressFill) {
            const total = animPoints.length - 1;
            const current = animDirection === 'forward' ? animCurrentIndex : (total - animCurrentIndex);
            const percentage = total > 0 ? (current / total) * 100 : 0;
            progressFill.style.width = `${percentage}%`;
        }
    }
}

function toggleAnimPlay() {
    const playBtn = document.getElementById('btn-anim-play');
    if (!playBtn) return;
    
    if (animPlayState === 'playing') {
        // Pause
        animPlayState = 'paused';
        playBtn.innerHTML = `<i class="fas fa-play"></i> <span>הפעל</span>`;
        if (animAnimationFrameId) {
            cancelAnimationFrame(animAnimationFrameId);
            animAnimationFrameId = null;
        }
        showToast('ההנפשה מושהית', 'info');
    } else {
        // Play
        if (animPlayState === 'idle') {
            animCurrentIndex = (animDirection === 'forward') ? 0 : animPoints.length - 1;
        }
        
        animPlayState = 'playing';
        playBtn.innerHTML = `<i class="fas fa-pause"></i> <span>השהה</span>`;
        showToast('ההנפשה מופעלת', 'success');
        
        animAnimationFrameId = requestAnimationFrame(animateStep);
    }
}

function animateStep() {
    if (animPlayState !== 'playing' || animPoints.length === 0) return;
    
    if (animDirection === 'forward') {
        animCurrentIndex += animSpeed;
        if (animCurrentIndex >= animPoints.length - 1) {
            animCurrentIndex = animPoints.length - 1;
            animPlayState = 'idle';
            finishAnimation();
            return;
        }
    } else {
        animCurrentIndex -= animSpeed;
        if (animCurrentIndex <= 0) {
            animCurrentIndex = 0;
            animPlayState = 'idle';
            finishAnimation();
            return;
        }
    }
    
    updateWalkerPosition();
    
    const pt = animPoints[animCurrentIndex];
    if (pt && map) {
        map.panTo({ lat: pt.lat, lng: pt.lng });
    }
    
    animAnimationFrameId = requestAnimationFrame(animateStep);
}

function finishAnimation() {
    updateWalkerPosition();
    
    if (isRecordingActive) {
        stopScreenRecording();
    }
    
    const playBtn = document.getElementById('btn-anim-play');
    if (playBtn) {
        playBtn.innerHTML = `<i class="fas fa-redo"></i> <span>הפעל שוב</span>`;
    }
    
    showToast('ההנפשה הושלמה בהצלחה!', 'success');
    if (animAnimationFrameId) {
        cancelAnimationFrame(animAnimationFrameId);
        animAnimationFrameId = null;
    }
}

// ============= Screen Recording =============
function toggleScreenRecording() {
    if (isRecordingActive) {
        stopScreenRecording();
    } else {
        startScreenRecording();
    }
}

function startScreenRecording() {
    const recordBtn = document.getElementById('btn-anim-record');
    if (!recordBtn) return;
    
    recordChunks = [];
    
    navigator.mediaDevices.getDisplayMedia({
        video: {
            displaySurface: "browser",
            logicalSurface: true
        },
        audio: false
    }).then(stream => {
        recordStream = stream;
        isRecordingActive = true;
        
        recordBtn.className = 'control-btn control-btn-record recording';
        recordBtn.innerHTML = `<i class="fas fa-square" style="animation: none;"></i> <span>עצור הקלטה</span>`;
        showToast('ההקלטה התחילה! הפעל את האנימציה כעת.', 'success');
        
        if (animPlayState === 'idle' || animPlayState === 'paused') {
            toggleAnimPlay();
        }
        
        stream.getVideoTracks()[0].onended = () => {
            if (isRecordingActive) {
                stopScreenRecording();
            }
        };
        
        let options = { mimeType: 'video/webm;codecs=vp9' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options = { mimeType: 'video/webm;codecs=vp8' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options = { mimeType: 'video/webm' };
            }
        }
        
        recordMediaRecorder = new MediaRecorder(stream, options);
        recordMediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                recordChunks.push(e.data);
            }
        };
        
        recordMediaRecorder.onstop = () => {
            const blob = new Blob(recordChunks, { type: 'video/webm' });
                        const url = URL.createObjectURL(blob);
            
            const cleanTrekName = animActivePlace ? animActivePlace.name.replace(/[^a-zA-Z0-9א-ת\s]/g, '').replace(/\s+/g, '_') : 'route';
            const filename = `מסלול_${cleanTrekName}_${new Date().toISOString().slice(0, 10)}.webm`;
            
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);
            
            showToast('הסרטון נשמר והורד למחשב!', 'success');
        };
        
        recordMediaRecorder.start();
    }).catch(err => {
        console.error("Screen capture failed:", err);
        showToast('הקלטת מסך בוטלה או לא נתמכת בדפדפן זה', 'error');
    });
}

function stopScreenRecording() {
    const recordBtn = document.getElementById('btn-anim-record');
    if (recordBtn) {
        recordBtn.className = 'control-btn control-btn-record';
        recordBtn.innerHTML = `<i class="fas fa-circle"></i> <span>הקלט מסך</span>`;
    }
    
    isRecordingActive = false;
    
    if (recordMediaRecorder && recordMediaRecorder.state !== 'inactive') {
        recordMediaRecorder.stop();
    }
    
    if (recordStream) {
        recordStream.getTracks().forEach(track => track.stop());
        recordStream = null;
    }
    
    showToast('הקלטת הווידאו נעצרה', 'info');
}

// ============= Cinematic Mode (Hide UI) =============
function toggleCinematicMode(enable) {
    isCinematicModeActive = enable;
    const body = document.body;
    const chk = document.getElementById('chk-cinematic');
    
    if (chk) chk.checked = enable;
    
    if (enable) {
        body.classList.add('cinematic-active');
        showToast('מצב קולנועי מופעל! לוח הבקרה זמין בתחתית.', 'info');
        
        setTimeout(() => {
            if (typeof google !== 'undefined' && google.maps) {
                if (map) google.maps.event.trigger(map, 'resize');
            }
        }, 500);
    } else {
        body.classList.remove('cinematic-active');
        showToast('מצב קולנועי כבוי', 'info');
        
        setTimeout(() => {
            if (typeof google !== 'undefined' && google.maps) {
                if (map) google.maps.event.trigger(map, 'resize');
            }
        }, 500);
    }
}// ============= GPX Segment & Roadbook Measurement System =============
let measureActivePlace = null;
let measurePoints = []; // [{ lat, lng, index, label }]
let measureMarkers = []; // Marker instances
let measurePreviewPolylines = []; // Polyline instances
let measureResections = []; // [{ fromPointIndex, landmarkName, lat, lng, azimuth, distanceMeters }]
let measureResectionMarkers = []; // Resection landmark markers
let measureResectionLines = []; // Resection dotted lines
let measureLegsData = []; // [{ description, notes }]
let isResectionActive = false;
let activeResectionFromIndex = -1;
let measureMapClickListener = null;
let editingRoadbookId = null;

function getDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function calculateAzimuth(lat1, lng1, lat2, lng2) {
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    
    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
              
    let brng = Math.atan2(y, x);
    brng = (brng * 180 / Math.PI + 360) % 360;
    return Math.round(brng);
}

function getDirectionString(azimuth) {
    const directions = [
        'צפון', 'צפון-צפון-מזרח', 'צפון-מזרח', 'מזרח-צפון-מזרח',
        'מזרח', 'מזרח-דרום-מזרח', 'דרום-מזרח', 'דרום-דרום-מזרח',
        'דרום', 'דרום-דרום-מערב', 'דרום-מערב', 'מערב-דרום-מערב',
        'מערב', 'מערב-צפון-מערב', 'צפון-מערב', 'צפון-צפון-מערב'
    ];
    const index = Math.round(azimuth / 22.5) % 16;
    return directions[index];
}

function getPoiEmoji(type) {
    if (type === 'water') return '💧';
    if (type === 'camp') return '🏕️';
    if (type === 'view') return '🌅';
    if (type === 'danger') return '⚠️';
    return '📍';
}

function getPoiLabel(type) {
    if (type === 'water') return 'נקודת מים / מילוי';
    if (type === 'camp') return 'חניון לילה';
    if (type === 'view') return 'נקודת תצפית / מנוחה';
    if (type === 'danger') return 'סכנה / מעבר קשה';
    return 'נקודת עניין';
}

function getMeasureMarkerIcon(pt, place) {
    const hasPoi = pt.poi && pt.poi.type;
    const textToShow = hasPoi ? getPoiEmoji(pt.poi.type) : pt.label;
    const fillCol = hasPoi ? '#F59E0B' : getPlaceColor(place);
    return {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" fill="${fillCol}" fill-opacity="0.35"/>
                <circle cx="12" cy="12" r="7" fill="${fillCol}" stroke="#ffffff" stroke-width="1.5"/>
                <text x="12" y="${hasPoi ? 16.5 : 15.5}" font-size="${hasPoi ? 11.5 : 9.5}" font-weight="bold" text-anchor="middle" fill="#ffffff" font-family="sans-serif">${textToShow}</text>
            </svg>
        `),
        anchor: new google.maps.Point(18, 18)
    };
}

function updateMeasureMarkers(place) {
    measureMarkers.forEach((marker, idx) => {
        const pt = measurePoints[idx];
        if (pt) {
            marker.setIcon(getMeasureMarkerIcon(pt, place));
        }
    });
}

function openMeasurementControlBar(place, skipReset = false) {
    if (!skipReset) {
        closeMeasurementControlBar();
        closeRecordingControlBar();
        
        measureActivePlace = place;
        editingRoadbookId = null;
        
        measurePoints = [];
        measureMarkers = [];
        measurePreviewPolylines = [];
        measureResections = [];
        measureResectionMarkers = [];
        measureResectionLines = [];
        measureLegsData = [];
        isResectionActive = false;
        activeResectionFromIndex = -1;
    }
    
    const gpxPoints = place.gpxData || [];
    if (gpxPoints.length === 0) {
        showToast('אין נקודות מסלול למדידה', 'error');
        return;
    }
    
    const placeColor = getPlaceColor(place);
    
    const bar = document.createElement('div');
    bar.className = 'recording-control-bar measurement-control-bar';
    bar.id = 'measurement-control-bar';
    bar.style.borderRight = `4px solid ${placeColor}`;
    bar.style.maxHeight = '80vh';
    bar.style.overflowY = 'auto';
    bar.style.width = '420px';
    bar.style.flexDirection = 'column';
    bar.style.alignItems = 'stretch';
    bar.style.gap = '12px';
    bar.style.padding = '16px';
    
    bar.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="control-title" style="font-size:15px; font-weight:bold; color:var(--primary-dark); display:flex; align-items:center; gap:8px;">
                <i class="fas fa-ruler-combined" style="color: ${placeColor};"></i>
                <span>בניית סיפור דרך: ${escapeHtml(place.name)}</span>
            </span>
            <button class="icon-btn" id="btn-measure-close-x" style="color:var(--text-tertiary); font-size:16px; border:none; background:transparent; cursor:pointer;"><i class="fas fa-times"></i></button>
        </div>
        
        <div id="measure-instructions" style="font-size:12px; font-weight:bold; color:var(--text-secondary); background:var(--primary-bg); padding:8px 12px; border-radius:var(--radius-sm); border-right:3px solid ${placeColor}; transition: all 0.2s ease;">
            לחץ על המפה סמוך למסלול ה-GPX להוספת נקודות ציון רציפות לסיפור הדרך.
        </div>
        
        <div id="measure-legs-list" style="max-height: 250px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 4px;">
            <div style="text-align:center; color:var(--text-tertiary); font-size:12.5px; padding:20px 0;">אין נקודות מדידה עדיין. לחץ על המפה כדי להוסיף.</div>
        </div>
        
        <div id="measure-save-form" style="display:none; flex-direction:column; gap:10px; border-top:1.5px dashed var(--border-light); padding-top:12px;">
            <input type="text" id="measure-roadbook-name" placeholder="שם סיפור הדרך (למשל: סיפור דרך יום 1)" style="width:100%; height:36px; padding:6px 10px; font-size:13px; border:1.5px solid var(--border); border-radius:var(--radius-sm); font-family:inherit;">
            <div style="display:flex; gap:8px; justify-content:flex-end; width:100%;">
                <button class="control-btn btn-outline" id="btn-measure-reset" style="height:36px; padding:0 14px; font-size:12.5px; border-color:var(--border); cursor:pointer;">נקה הכל</button>
                <button class="control-btn" id="btn-measure-save" style="background:#10B981; border:2px solid #10B981; color:white; height:36px; padding:0 18px; font-size:12.5px; font-weight:bold; cursor:pointer; border-radius:var(--radius-sm); transition: all 0.2s;">
                    <i class="fas fa-save" style="margin-left:4px;"></i>שמור סיפור דרך
                </button>
            </div>
        </div>
    `;
    
    document.getElementById('map-panel').appendChild(bar);
    
    // Bind buttons
    bar.querySelector('#btn-measure-close-x').addEventListener('click', closeMeasurementControlBar);
    bar.querySelector('#btn-measure-reset').addEventListener('click', resetMeasurementSelection);
    
    // Bind map click
    measureMapClickListener = map.addListener('click', (e) => {
        // 1. Resection Mode Click Handler
        if (isResectionActive && activeResectionFromIndex !== -1) {
            const landmarkName = prompt("הזן את שם האלמנט הבולט בשטח (למשל: אנטנה ראשית, מגדל מים, פסגה):");
            if (!landmarkName) {
                isResectionActive = false;
                activeResectionFromIndex = -1;
                updateMeasureLegsList(place);
                return;
            }
            
            const ptFrom = measurePoints[activeResectionFromIndex];
            const ptTo = { lat: e.latLng.lat(), lng: e.latLng.lng() };
            
            const azimuth = calculateAzimuth(ptFrom.lat, ptFrom.lng, ptTo.lat, ptTo.lng);
            const distMeters = Math.round(getDistance(ptFrom.lat, ptFrom.lng, ptTo.lat, ptTo.lng) * 1000);
            
            const resectionItem = {
                fromPointIndex: activeResectionFromIndex,
                landmarkName: landmarkName,
                lat: ptTo.lat,
                lng: ptTo.lng,
                azimuth: azimuth,
                distanceMeters: distMeters
            };
            
            measureResections.push(resectionItem);
            drawResectionOnMap(ptFrom, ptTo, resectionItem);
            
            isResectionActive = false;
            activeResectionFromIndex = -1;
            
            updateMeasureLegsList(place);
            showToast('נקודת הזדטרות נדגמה בהצלחה!', 'success');
            return;
        }
        
        // 2. Normal Point Addition Click Handler
        const nearestIndex = findNearestGpxPoint(e.latLng, gpxPoints);
        if (nearestIndex === -1) return;
        
        const pt = gpxPoints[nearestIndex];
        const newPointIdx = measurePoints.length;
        
        const newPoint = {
            lat: pt.lat,
            lng: pt.lng,
            index: nearestIndex,
            label: String(newPointIdx + 1)
        };
        
        measurePoints.push(newPoint);
        
        // Draw Marker
        const marker = new google.maps.Marker({
            position: { lat: pt.lat, lng: pt.lng },
            map: map,
            zIndex: 3000,
            draggable: true,
            icon: getMeasureMarkerIcon(newPoint, place)
        });
        
        measureMarkers.push(marker);
        
        // Bind dragging
        google.maps.event.addListener(marker, 'drag', (evt) => {
            const idx = findNearestGpxPoint(evt.latLng, gpxPoints);
            if (idx !== -1) {
                newPoint.lat = gpxPoints[idx].lat;
                newPoint.lng = gpxPoints[idx].lng;
                newPoint.index = idx;
                updateMeasurePreviewLines(gpxPoints);
                updateMeasureLegsList(place);
            }
        });
        
        google.maps.event.addListener(marker, 'dragend', (evt) => {
            const idx = findNearestGpxPoint(evt.latLng, gpxPoints);
            if (idx !== -1) {
                const snapPt = gpxPoints[idx];
                newPoint.lat = snapPt.lat;
                newPoint.lng = snapPt.lng;
                newPoint.index = idx;
                marker.setPosition({ lat: snapPt.lat, lng: snapPt.lng });
                updateMeasurePreviewLines(gpxPoints);
                redrawAllResections();
                updateMeasureLegsList(place);
            }
        });
        
        if (newPointIdx > 0) {
            measureLegsData.push({
                description: `מקטע מנקודה ${newPointIdx} לנקודה ${newPointIdx + 1}`,
                notes: ''
            });
        }
        
        updateMeasurePreviewLines(gpxPoints);
        updateMeasureLegsList(place);
    });
    
    // Zoom and focus map on place track
    const bounds = new google.maps.LatLngBounds();
    gpxPoints.forEach(pt => bounds.extend(pt));
    map.fitBounds(bounds);
    showToast('כלי המדידה וסיפור הדרך פעיל! בחר נקודות על המפה לאורך המסלול.', 'info');
}

function updateMeasurePreviewLines(gpxPoints) {
    measurePreviewPolylines.forEach(p => p.setMap(null));
    measurePreviewPolylines = [];
    
    if (measurePoints.length < 2) return;
    
    for (let k = 0; k < measurePoints.length - 1; k++) {
        const ptStart = measurePoints[k];
        const ptEnd = measurePoints[k + 1];
        
        const startIdx = Math.min(ptStart.index, ptEnd.index);
        const endIdx = Math.max(ptStart.index, ptEnd.index);
        
        const pathPoints = gpxPoints.slice(startIdx, endIdx + 1);
        
        const poly = new google.maps.Polyline({
            path: pathPoints,
            geodesic: true,
            strokeColor: '#E5B23A',
            strokeOpacity: 0.9,
            strokeWeight: 6,
            map: map,
            zIndex: 2500
        });
        
        measurePreviewPolylines.push(poly);
    }
}

function startResectionLandmarkSelection(pointIdx) {
    isResectionActive = true;
    activeResectionFromIndex = pointIdx;
    
    const inst = document.getElementById('measure-instructions');
    if (inst) {
        inst.innerHTML = `<i class="fas fa-crosshairs fa-spin" style="color:var(--accent-rose);"></i> <strong>מצב הזדטרות פעיל:</strong> לחץ על המפה לסימון אלמנט בולט בשטח מהסיכה ה-${pointIdx + 1}.`;
        inst.style.background = 'rgba(244, 63, 94, 0.08)';
        inst.style.borderRightColor = 'var(--accent-rose)';
    }
    showToast('בחר אלמנט בולט במפה (בית, מגדל, אנטנה וכו\')', 'info');
}

function drawResectionOnMap(ptFrom, ptTo, resectionItem) {
    const line = new google.maps.Polyline({
        path: [ptFrom, ptTo],
        geodesic: true,
        strokeColor: '#0ea5e9',
        strokeOpacity: 0.8,
        strokeWeight: 2,
        icons: [{
            icon: {
                path: 'M 0,-1 0,1',
                strokeOpacity: 1,
                scale: 3
            },
            offset: '0',
            repeat: '20px'
        }],
        map: map,
        zIndex: 2800
    });
    
    const marker = new google.maps.Marker({
        position: ptTo,
        map: map,
        zIndex: 2900,
        icon: {
            url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24">
                    <polygon points="12,2 2,22 22,22" fill="#0ea5e9" stroke="#ffffff" stroke-width="1.5"/>
                    <circle cx="12" cy="14" r="3" fill="#ffffff"/>
                </svg>
            `),
            anchor: new google.maps.Point(14, 14)
        },
        title: resectionItem.landmarkName
    });
    
    measureResectionLines.push(line);
    measureResectionMarkers.push(marker);
}

function redrawAllResections() {
    measureResectionLines.forEach(l => l.setMap(null));
    measureResectionMarkers.forEach(m => m.setMap(null));
    measureResectionLines = [];
    measureResectionMarkers = [];
    
    measureResections.forEach(res => {
        const ptFrom = measurePoints[res.fromPointIndex];
        const ptTo = { lat: res.lat, lng: res.lng };
        if (ptFrom) {
            drawResectionOnMap(ptFrom, ptTo, res);
        }
    });
}

function deleteResectionLandmark(pointIdx, resIdx) {
    const target = measureResections.filter(r => r.fromPointIndex === pointIdx)[resIdx];
    if (target) {
        const index = measureResections.indexOf(target);
        if (index > -1) {
            measureResections.splice(index, 1);
            redrawAllResections();
            updateMeasureLegsList(measureActivePlace);
            showToast('נקודת הזדטרות נמחקה', 'info');
        }
    }
}

function updateMeasureLegsList(place) {
    const listDiv = document.getElementById('measure-legs-list');
    if (!listDiv) return;
    
    listDiv.innerHTML = '';
    
    if (measurePoints.length === 0) {
        listDiv.innerHTML = `<div style="text-align:center; color:var(--text-tertiary); font-size:12.5px; padding:20px 0;">אין נקודות מדידה עדיין. לחץ על המפה כדי להוסיף.</div>`;
        document.getElementById('measure-save-form').style.display = 'none';
        return;
    }
    
    document.getElementById('measure-save-form').style.display = 'flex';
    
    const placeColor = getPlaceColor(place);
    
    const nameInput = document.getElementById('measure-roadbook-name');
    if (nameInput && !nameInput.value.trim()) {
        nameInput.value = `סיפור דרך ${place.roadbooks ? place.roadbooks.length + 1 : 1}`;
    }
    
    measurePoints.forEach((pt, idx) => {
        const ptDiv = document.createElement('div');
        ptDiv.className = 'measure-point-item';
        ptDiv.style = `border:1.5px solid var(--border-light); border-radius:var(--radius-sm); padding:10px; background:var(--surface); margin-bottom:8px; display:flex; flex-direction:column; gap:6px;`;
        
        const header = document.createElement('div');
        header.style = `display:flex; justify-content:space-between; align-items:center;`;
        header.innerHTML = `
            <span style="font-weight:bold; font-size:13px; color:var(--primary-dark);">
                <span style="display:inline-block; width:22px; height:22px; border-radius:50%; background:${placeColor}; color:white; text-align:center; line-height:22px; font-size:11.5px; margin-left:6px; font-family:sans-serif;">${idx + 1}</span>
                נקודת ציון
            </span>
            <button type="button" class="btn-add-resection icon-btn-text" data-point-idx="${idx}" style="font-size:11px; color:var(--primary); border:1px solid var(--border); padding:3px 8px; border-radius:4px; background:var(--primary-bg); cursor:pointer; font-family:inherit;">
                <i class="fas fa-crosshairs"></i> הזדטרות בשטח
            </button>
        `;
        ptDiv.appendChild(header);

        const poiWrapper = document.createElement('div');
        poiWrapper.style = `display:flex; flex-direction:column; margin-top:2px;`;
        poiWrapper.innerHTML = pt.poi && pt.poi.type ? `
            <div class="measure-poi-badge" style="display:flex; flex-direction:column; gap:4px; background:#fef3c7; border:1px solid #f59e0b; padding:6px 8px; border-radius:4px; font-size:11.5px; margin-top:4px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="color:#b45309; font-weight:bold;">${getPoiEmoji(pt.poi.type)} ${getPoiLabel(pt.poi.type)}: ${escapeHtml(pt.poi.name)}</span>
                    <div style="display:flex; gap:6px;">
                        <button type="button" class="btn-upload-poi-image" data-point-idx="${idx}" style="border:none; background:transparent; color:#b45309; cursor:pointer; font-size:11px; padding:0 4px;" title="הוסף תמונה"><i class="fas fa-camera"></i></button>
                        <button type="button" class="btn-delete-poi" data-point-idx="${idx}" style="border:none; background:transparent; color:var(--accent-rose); cursor:pointer; font-size:11px; padding:0 4px;" title="מחק נקודת עניין"><i class="fas fa-trash-alt"></i></button>
                    </div>
                </div>
                ${pt.poi.image ? `
                    <div style="position:relative; width:60px; height:45px; margin-top:4px; border-radius:4px; overflow:hidden; border:1px solid #d97706;">
                        <img src="${pt.poi.image}" style="width:100%; height:100%; object-fit:cover;">
                        <button type="button" class="btn-delete-poi-image" data-point-idx="${idx}" style="position:absolute; top:2px; left:2px; background:rgba(0,0,0,0.6); color:white; border:none; border-radius:2px; width:14px; height:14px; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:8px;"><i class="fas fa-times"></i></button>
                    </div>
                ` : ''}
            </div>
        ` : `
            <button type="button" class="btn-add-poi icon-btn-text" data-point-idx="${idx}" style="font-size:11px; color:#b45309; border:1px solid #f59e0b; padding:3.5px 8px; border-radius:4px; background:#fef3c7; cursor:pointer; font-family:inherit; margin-top:4px; align-self:flex-start; font-weight:500;">
                <i class="fas fa-map-marker-alt"></i> הוסף נקודת עניין (POI)
            </button>
        `;
        ptDiv.appendChild(poiWrapper);
        
        const ptResections = measureResections.filter(r => r.fromPointIndex === idx);
        if (ptResections.length > 0) {
            const resectionsList = document.createElement('div');
            resectionsList.style = `display:flex; flex-direction:column; gap:4px; background:var(--primary-bg); padding:6px; border-radius:4px; font-size:11.5px; border-right:2px solid #0ea5e9; margin-top:4px;`;
            ptResections.forEach((res, resIdx) => {
                resectionsList.innerHTML += `
                    <div style="display:flex; justify-content:space-between; align-items:center; direction:rtl;">
                        <span>🎯 אזימוט <strong>${res.azimuth}° (${getDirectionString(res.azimuth)})</strong> ל-<strong>${escapeHtml(res.landmarkName)}</strong> (${res.distanceMeters} מ')</span>
                        <button type="button" class="btn-delete-resection" data-point-idx="${idx}" data-res-idx="${resIdx}" style="border:none; background:transparent; color:var(--accent-rose); cursor:pointer; font-size:11px; padding:0 4px;"><i class="fas fa-trash-alt"></i></button>
                    </div>
                `;
            });
            ptDiv.appendChild(resectionsList);
        }
        
        if (idx > 0) {
            const prevPt = measurePoints[idx - 1];
            const dist = getDistance(prevPt.lat, prevPt.lng, pt.lat, pt.lng);
            const azimuth = calculateAzimuth(prevPt.lat, prevPt.lng, pt.lat, pt.lng);
            
            const legDiv = document.createElement('div');
            legDiv.style = `border-top:1.5px dashed var(--border-light); margin-top:6px; padding-top:8px; display:flex; flex-direction:column; gap:6px;`;
            
            legDiv.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:bold; color:var(--text-secondary);">
                    <span>מקטע ${idx} (${idx} ➔ ${idx + 1})</span>
                    <span>אזימוט: ${azimuth}° (${getDirectionString(azimuth)}) | מרחק: ${dist.toFixed(2)} ק"מ</span>
                </div>
                <textarea class="leg-desc-input auto-expand-textarea" data-leg-idx="${idx - 1}" placeholder="תיאור המקטע (למשל: מהבית הקטן עד למעבר הנחל)" style="width:100%; min-height:36px; max-height:120px; padding:6px 10px; font-size:12.5px; border:1px solid var(--border); border-radius:var(--radius-sm); font-family:inherit; resize:none; overflow-y:hidden; line-height:1.4;">${escapeHtml(measureLegsData[idx - 1]?.description || '')}</textarea>
                <textarea class="leg-notes-input auto-expand-textarea" data-leg-idx="${idx - 1}" placeholder="הנחיות ניווט והערות (למשל: ההתקדמות מבוססת נחל)" style="width:100%; min-height:48px; max-height:150px; padding:6px 10px; font-size:12.5px; border:1px solid var(--border); border-radius:var(--radius-sm); font-family:inherit; resize:none; overflow-y:hidden; line-height:1.4;">${escapeHtml(measureLegsData[idx - 1]?.notes || '')}</textarea>
            `;
            
            ptDiv.appendChild(legDiv);
        }
        
        listDiv.appendChild(ptDiv);
    });

    // Bind POI addition buttons
    listDiv.querySelectorAll('.btn-add-poi').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const ptIdx = parseInt(btn.dataset.pointIdx);
            const pt = measurePoints[ptIdx];
            if (!pt) return;
            
            const choice = prompt("בחר סוג נקודת עניין:\n1 - 💧 נקודת מים / מילוי\n2 - 🏕️ חניון לילה\n3 - 🌅 נקודת תצפית / מנוחה\n4 - ⚠️ סכנה / מעבר קשה");
            if (!choice) return;
            
            const typeMap = { '1': 'water', '2': 'camp', '3': 'view', '4': 'danger' };
            const selectedType = typeMap[choice.trim()];
            if (!selectedType) {
                showToast("בחירה לא תקינה", "error");
                return;
            }
            
            const name = prompt("הזן תיאור קצר לנקודת העניין (למשל: עין עקב):");
            if (!name || !name.trim()) return;
            
            pt.poi = {
                type: selectedType,
                name: name.trim()
            };
            
            updateMeasureMarkers(place);
            updateMeasureLegsList(place);
            showToast("נקודת העניין נוספה בהצלחה!", "success");
        };
    });

    // Bind POI deletion buttons
    listDiv.querySelectorAll('.btn-delete-poi').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const ptIdx = parseInt(btn.dataset.pointIdx);
            const pt = measurePoints[ptIdx];
            if (pt && pt.poi) {
                delete pt.poi;
                updateMeasureMarkers(place);
                updateMeasureLegsList(place);
                showToast("נקודת העניין הוסרה", "info");
            }
        };
    });

    // Bind POI image upload buttons
    listDiv.querySelectorAll('.btn-upload-poi-image').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const ptIdx = parseInt(btn.dataset.pointIdx);
            const pt = measurePoints[ptIdx];
            if (!pt || !pt.poi) return;
            
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/*';
            fileInput.style.display = 'none';
            document.body.appendChild(fileInput);
            
            fileInput.onchange = (evt) => {
                const file = evt.target.files[0];
                if (!file) {
                    document.body.removeChild(fileInput);
                    return;
                }
                
                const reader = new FileReader();
                reader.onload = (re) => {
                    compressImage(re.target.result, (compressed) => {
                        pt.poi.image = compressed;
                        updateMeasureLegsList(place);
                        showToast("תמונת נקודת העניין נוספה בהצלחה!", "success");
                    });
                };
                reader.readAsDataURL(file);
                document.body.removeChild(fileInput);
            };
            
            fileInput.click();
        };
    });

    // Bind POI image deletion buttons
    listDiv.querySelectorAll('.btn-delete-poi-image').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const ptIdx = parseInt(btn.dataset.pointIdx);
            const pt = measurePoints[ptIdx];
            if (pt && pt.poi) {
                delete pt.poi.image;
                updateMeasureLegsList(place);
                showToast("תמונת נקודת העניין הוסרה", "info");
            }
        };
    });

    // Bind resection addition buttons
    listDiv.querySelectorAll('.btn-add-resection').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const ptIdx = parseInt(btn.dataset.pointIdx);
            startResectionLandmarkSelection(ptIdx);
        };
    });

    // Bind resection deletion buttons
    listDiv.querySelectorAll('.btn-delete-resection').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const ptIdx = parseInt(btn.dataset.pointIdx);
            const resIdx = parseInt(btn.dataset.resIdx);
            
            const ptResections = measureResections.filter(r => r.fromPointIndex === ptIdx);
            const targetRes = ptResections[resIdx];
            if (targetRes) {
                if (targetRes.line) targetRes.line.setMap(null);
                if (targetRes.marker) targetRes.marker.setMap(null);
                
                measureResections = measureResections.filter(r => r !== targetRes);
                updateMeasureLegsList(place);
            }
        };
    });

    // Bind leg description and notes inputs
    listDiv.querySelectorAll('.leg-desc-input').forEach(input => {
        input.addEventListener('input', () => {
            const legIdx = parseInt(input.dataset.legIdx);
            if (!measureLegsData[legIdx]) measureLegsData[legIdx] = {};
            measureLegsData[legIdx].description = input.value;
        });
    });

    listDiv.querySelectorAll('.leg-notes-input').forEach(input => {
        input.addEventListener('input', () => {
            const legIdx = parseInt(input.dataset.legIdx);
            if (!measureLegsData[legIdx]) measureLegsData[legIdx] = {};
            measureLegsData[legIdx].notes = input.value;
        });
    });

    // Auto-expand textareas height adjustment logic
    const adjustTextareaHeight = (ta) => {
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 'px';
    };

    listDiv.querySelectorAll('.auto-expand-textarea').forEach(textarea => {
        adjustTextareaHeight(textarea);
        textarea.addEventListener('input', () => {
            adjustTextareaHeight(textarea);
        });
    });
    
    const saveBtn = document.getElementById('btn-measure-save');
    if (saveBtn) {
        saveBtn.onclick = () => {
            const name = document.getElementById('measure-roadbook-name').value.trim();
            if (!name) {
                showToast('אנא הזן שם לסיפור הדרך', 'error');
                return;
            }
            
            if (measurePoints.length < 2) {
                showToast('יש לדגום לפחות 2 נקודות ציון כדי לייצר סיפור דרך', 'error');
                return;
            }
            
            if (!place.roadbooks) place.roadbooks = [];
            
            if (editingRoadbookId) {
                const idx = place.roadbooks.findIndex(r => r.id === editingRoadbookId);
                if (idx > -1) {
                    place.roadbooks[idx].name = name;
                    place.roadbooks[idx].points = measurePoints;
                    place.roadbooks[idx].resections = measureResections;
                    place.roadbooks[idx].legs = measureLegsData;
                    place.roadbooks[idx].updatedAt = Date.now();
                }
                editingRoadbookId = null;
                showToast(`סיפור הדרך "${name}" עודכן בהצלחה!`, 'success');
            } else {
                const newRoadbook = {
                    id: 'rb-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
                    name: name,
                    points: measurePoints,
                    resections: measureResections,
                    legs: measureLegsData,
                    createdAt: Date.now()
                };
                place.roadbooks.push(newRoadbook);
                showToast(`סיפור הדרך "${name}" נשמר בהצלחה!`, 'success');
            }
            
            savePlaces();
            syncPlaceToFirebase(place);
            closeMeasurementControlBar();
            renderPlaces();
        };
    }
}

function resetMeasurementSelection() {
    measureMarkers.forEach(m => m.setMap(null));
    measureMarkers = [];
    measurePreviewPolylines.forEach(p => p.setMap(null));
    measurePreviewPolylines = [];
    measureResectionLines.forEach(l => l.setMap(null));
    measureResectionLines = [];
    measureResectionMarkers.forEach(m => m.setMap(null));
    measureResectionMarkers = [];
    
    measurePoints = [];
    measureResections = [];
    measureLegsData = [];
    isResectionActive = false;
    activeResectionFromIndex = -1;
    
    const inst = document.getElementById('measure-instructions');
    if (inst) {
        inst.style.background = 'var(--primary-bg)';
        inst.style.borderRightColor = 'var(--primary)';
        inst.innerHTML = '<i class="fas fa-mouse-pointer" style="margin-left:5px;"></i> לחץ על המפה סמוך למסלול לקביעת נקודת התחלה';
    }
    
    updateMeasureLegsList(measureActivePlace);
}

function closeMeasurementControlBar() {
    resetMeasurementSelection();
    
    if (measureMapClickListener) {
        google.maps.event.removeListener(measureMapClickListener);
        measureMapClickListener = null;
    }
    
    const bar = document.getElementById('measurement-control-bar');
    if (bar) bar.remove();
    
    measureActivePlace = null;
    showToast('מצב מדידה וסיפור דרך בוטל', 'info');
}

function findNearestGpxPoint(latLng, gpxPoints) {
    if (!gpxPoints || gpxPoints.length === 0) return -1;
    let minDist = Infinity;
    let nearestIndex = -1;
    for (let i = 0; i < gpxPoints.length; i++) {
        const pt = gpxPoints[i];
        const d = Math.pow(pt.lat - latLng.lat(), 2) + Math.pow(pt.lng - latLng.lng(), 2);
        if (d < minDist) {
            minDist = d;
            nearestIndex = i;
        }
    }
    return nearestIndex;
}

function toggleSegmentVisibility(placeId, segId, isVisible) {
    const place = places.find(p => p.id === placeId);
    if (!place || !place.gpxSegments) return;
    
    const seg = place.gpxSegments.find(s => s.id === segId);
    if (seg) {
        seg.visible = isVisible;
        savePlaces();
        syncPlaceToFirebase(place);
        drawAllGpxTracks();
        renderPlaces();
        showToast(isVisible ? 'המקטע מוצג כעת על המפה' : 'המקטע מוסתר מהמפה', 'info');
    }
}

function deleteSegment(placeId, segId) {
    const place = places.find(p => p.id === placeId);
    if (!place || !place.gpxSegments) return;
    
    place.gpxSegments = place.gpxSegments.filter(s => s.id !== segId);
    savePlaces();
    syncPlaceToFirebase(place);
    drawAllGpxTracks();
    renderPlaces();
    showToast('המקטע נמחק בהצלחה', 'success');
}

function focusMapOnSegment(place, seg) {
    const start = Math.min(seg.startIndex, seg.endIndex);
    const end = Math.max(seg.startIndex, seg.endIndex);
    const segmentPath = place.gpxData.slice(start, end + 1);
    if (segmentPath.length === 0) return;
    
    if (!seg.visible) {
        seg.visible = true;
        savePlaces();
        syncPlaceToFirebase(place);
        drawAllGpxTracks();
        renderPlaces();
    }
    
    const bounds = new google.maps.LatLngBounds();
    segmentPath.forEach(pt => bounds.extend(pt));
    map.fitBounds(bounds);
    
    showToast(`מתמקד במקטע: ${seg.name} (${seg.distanceKm.toFixed(2)} ק"מ)`, 'info');
}

// ============= Printable Roadbooks & GPX Exporter Systems =============
function getSegmentStats(place, startIndex, endIndex) {
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    const path = place.gpxData.slice(start, end + 1);
    
    let gain = 0;
    let loss = 0;
    
    for (let i = 0; i < path.length - 1; i++) {
        const pt1 = path[i];
        const pt2 = path[i+1];
        if (pt1.ele !== undefined && pt2.ele !== undefined) {
            const diff = pt2.ele - pt1.ele;
            if (diff > 0) gain += diff;
            else loss += Math.abs(diff);
        }
    }
    
    return { gain: Math.round(gain), loss: Math.round(loss) };
}

function estimateDuration(distanceKm, elevationGainM, flatSpeed = 4.0, climbDelayMin = 10.0) {
    if (distanceKm <= 0) return 0;
    const flatTimeMin = (distanceKm / flatSpeed) * 60;
    const climbTimeMin = (elevationGainM / 100) * climbDelayMin;
    return flatTimeMin + climbTimeMin;
}

function formatDuration(minutes) {
    if (minutes <= 0) return '0 דק\'';
    const hrs = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, '0')} שעות`;
    }
    return `${mins} דק\'`;
}

function openRoadbookModal(place, roadbook) {
    const modal = document.getElementById('roadbook-modal');
    const body = document.getElementById('roadbook-modal-body');
    if (!modal || !body) return;
    
    modal.$activeRoadbook = roadbook;
    modal.$activePlace = place;
    
    let totalDist = 0;
    let totalGain = 0;
    let totalLoss = 0;
    
    for (let k = 0; k < roadbook.points.length - 1; k++) {
        const p1 = roadbook.points[k];
        const p2 = roadbook.points[k+1];
        totalDist += getDistance(p1.lat, p1.lng, p2.lat, p2.lng);
        const stats = getSegmentStats(place, p1.index, p2.index);
        totalGain += stats.gain;
        totalLoss += stats.loss;
    }
    
    let html = `
        <div style="text-align: center; margin-bottom: 20px;">
            <h1 style="font-size: 24px; color: var(--primary-dark); margin-bottom: 4px;">סיפור דרך: ${escapeHtml(roadbook.name)}</h1>
            <h3 style="font-size: 14.5px; color: var(--text-secondary); margin-bottom: 12px;">מפת הטיולים והחלומות - ${escapeHtml(place.name)}</h3>
        </div>
        
        <div class="roadbook-header-card">
            <div class="roadbook-header-stat">
                <span class="stat-label"><i class="fas fa-route"></i> מרחק כולל</span>
                <span class="stat-value">${totalDist.toFixed(2)} ק"מ</span>
            </div>
            <div class="roadbook-header-stat">
                <span class="stat-label"><i class="fas fa-chevron-circle-up"></i> טיפוס מצטבר (Gain)</span>
                <span class="stat-value">${totalGain} מטרים</span>
            </div>
            <div class="roadbook-header-stat">
                <span class="stat-label"><i class="fas fa-chevron-circle-down"></i> ירידה מצטברת (Loss)</span>
                <span class="stat-value">${totalLoss} מטרים</span>
            </div>
        </div>
        
        <table class="roadbook-table">
            <thead>
                <tr>
                    <th style="width: 80px;">מקטע</th>
                    <th style="width: 250px;">תיאור ומסלול</th>
                    <th style="width: 140px;">מרחק ואזימוט</th>
                    <th style="width: 240px;">נקודות הזדטרות בשטח (Landmarks)</th>
                    <th>הנחיות ניווט והערות נוספות</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    roadbook.points.forEach((pt, idx) => {
        const ptResections = roadbook.resections.filter(r => r.fromPointIndex === idx);
        let resectionText = '<em>אין נקודות תצפית</em>';
        if (ptResections.length > 0) {
            resectionText = `<ul style="margin: 0; padding-right: 18px; line-height: 1.5;">` + 
                ptResections.map(res => `<li>אזימוט <strong>${res.azimuth}° (${getDirectionString(res.azimuth)})</strong> ל-${escapeHtml(res.landmarkName)} (${res.distanceMeters} מ')</li>`).join('') + 
                `</ul>`;
        }
        
        let poiHtml = '';
        if (pt.poi && pt.poi.type) {
            poiHtml = `<div style="margin-top: 6px; display: inline-flex; flex-direction: column; gap: 4px; background: #fef3c7; border: 1.5px solid #f59e0b; padding: 6px 8px; border-radius: var(--radius-sm); font-size: 11px; font-weight: bold; color: #b45309;">
                <div style="display:flex; align-items:center; gap:6px;"><i class="fas fa-map-marker-alt"></i> ${getPoiEmoji(pt.poi.type)} ${getPoiLabel(pt.poi.type)}: ${escapeHtml(pt.poi.name)}</div>
                ${pt.poi.image ? `<div style="margin-top: 4px; width: 120px; height: 90px; border-radius: 4px; overflow: hidden; border: 1px solid #d97706;"><img src="${pt.poi.image}" style="width: 100%; height: 100%; object-fit: cover;"></div>` : ''}
            </div>`;
        }

        if (idx === 0) {
            html += `
                <tr style="background: rgba(16, 185, 129, 0.05);">
                    <td><strong>התחלה (1)</strong></td>
                    <td>נקודת היציאה לדרך${poiHtml ? '<br>' + poiHtml : ''}</td>
                    <td>-</td>
                    <td>${resectionText}</td>
                    <td>נקודת תחילת הניווט.</td>
                </tr>
            `;
        } else {
            const prevPt = roadbook.points[idx - 1];
            const dist = getDistance(prevPt.lat, prevPt.lng, pt.lat, pt.lng);
            const azimuth = calculateAzimuth(prevPt.lat, prevPt.lng, pt.lat, pt.lng);
            const legData = roadbook.legs[idx - 1] || {};
            
            html += `
                <tr>
                    <td><strong>מקטע ${idx}</strong> (${idx} ➔ ${idx + 1})</td>
                    <td>${escapeHtml(legData.description || 'ללא תיאור')}${poiHtml ? '<br>' + poiHtml : ''}</td>
                    <td>
                        <strong>${dist.toFixed(2)} ק"מ</strong><br>
                        <span style="font-size: 11px; color: var(--text-secondary);"><i class="fas fa-compass"></i> אזימוט: ${azimuth}° (${getDirectionString(azimuth)})</span>
                    </td>
                    <td>${resectionText}</td>
                    <td>${escapeHtml(legData.notes || 'אין הערות מיוחדות')}</td>
                </tr>
            `;
        }
    });
    
    html += `
            </tbody>
        </table>
        
        <div style="margin-top: 30px; text-align: center; font-size: 11px; color: var(--text-tertiary);" class="no-print">
            סיפור הדרך מיועד להדפסה ישירה (Ctrl + P). הממשק יתאים את הטבלה לפורמט A4 שחור-לבן נקי.
        </div>
    `;
    
    body.innerHTML = html;
    modal.classList.add('active');
}

function closeRoadbookModal() {
    const modal = document.getElementById('roadbook-modal');
    if (modal) modal.classList.remove('active');
}

function deleteRoadbook(placeId, rbId) {
    const place = places.find(p => p.id === placeId);
    if (!place || !place.roadbooks) return;
    
    place.roadbooks = place.roadbooks.filter(r => r.id !== rbId);
    savePlaces();
    syncPlaceToFirebase(place);
    renderPlaces();
    showToast('סיפור הדרך נמחק בהצלחה', 'success');
}

function loadRoadbookToEditor(place, roadbook) {
    // 1. Clear any active tools first
    closeMeasurementControlBar();
    closeRecordingControlBar();
    
    measureActivePlace = place;
    editingRoadbookId = roadbook.id;
    
    // 2. Clone points, resections and legs to prevent live mutating the original until saved
    measurePoints = JSON.parse(JSON.stringify(roadbook.points || []));
    measureResections = JSON.parse(JSON.stringify(roadbook.resections || []));
    measureLegsData = JSON.parse(JSON.stringify(roadbook.legs || []));
    
    // 3. Open the control panel UI (skipping resets)
    openMeasurementControlBar(place, true);
    
    // 4. Overwrite roadbook name field
    const nameInput = document.getElementById('measure-roadbook-name');
    if (nameInput) {
        nameInput.value = roadbook.name;
    }
    
    // 5. Draw markers on map with drag listeners
    const gpxPoints = place.gpxData || [];
    measurePoints.forEach((pt) => {
        const marker = new google.maps.Marker({
            position: { lat: pt.lat, lng: pt.lng },
            map: map,
            zIndex: 3000,
            draggable: true,
            icon: getMeasureMarkerIcon(pt, place)
        });
        measureMarkers.push(marker);
        
        google.maps.event.addListener(marker, 'drag', (evt) => {
            const idx = findNearestGpxPoint(evt.latLng, gpxPoints);
            if (idx !== -1) {
                pt.lat = gpxPoints[idx].lat;
                pt.lng = gpxPoints[idx].lng;
                pt.index = idx;
                updateMeasurePreviewLines(gpxPoints);
                updateMeasureLegsList(place);
            }
        });
        
        google.maps.event.addListener(marker, 'dragend', (evt) => {
            const idx = findNearestGpxPoint(evt.latLng, gpxPoints);
            if (idx !== -1) {
                const snapPt = gpxPoints[idx];
                pt.lat = snapPt.lat;
                pt.lng = snapPt.lng;
                pt.index = idx;
                marker.setPosition({ lat: snapPt.lat, lng: snapPt.lng });
                updateMeasurePreviewLines(gpxPoints);
                redrawAllResections();
                updateMeasureLegsList(place);
            }
        });
    });
    
    // 6. Draw path segment preview lines
    updateMeasurePreviewLines(gpxPoints);
    
    // 7. Draw all resection lines/markers
    redrawAllResections();
    
    // 8. Render control panel list
    updateMeasureLegsList(place);
    showToast(`טוען את סיפור הדרך "${roadbook.name}" לעריכה!`, 'info');
}

function downloadRoadbookCsv(roadbook, place) {
    let csvContent = "\uFEFF"; // UTF-8 BOM for Excel Hebrew support
    csvContent += "מספר מקטע,תיאור,מרחק (ק\"מ),אזימוט התקדמות,נקודות הזדטרות בשטח,הערות ניווט ופרטים נוספים\n";
    
    roadbook.points.forEach((pt, idx) => {
        const ptResections = roadbook.resections.filter(r => r.fromPointIndex === idx);
        const resectionStr = ptResections.map(res => 'אזימוט ' + res.azimuth + ' ל-' + res.landmarkName + ' (' + res.distanceMeters + ' מ\')').join(' | ');
        
        let poiStr = '';
        if (pt.poi && pt.poi.type) {
            poiStr = ` [${getPoiEmoji(pt.poi.type)} ${getPoiLabel(pt.poi.type)}: ${pt.poi.name}]`;
        }

        if (idx === 0) {
            csvContent += '"התחלה","נקודת התחלה' + poiStr.replace(/"/g, '""') + '","-","-","' + resectionStr.replace(/"/g, '""') + '","-"\n';
        } else {
            const prevPt = roadbook.points[idx - 1];
            const dist = getDistance(prevPt.lat, prevPt.lng, pt.lat, pt.lng);
            const azimuth = calculateAzimuth(prevPt.lat, prevPt.lng, pt.lat, pt.lng);
            const legData = roadbook.legs[idx - 1] || {};
            
            csvContent += '"' + idx + '","' + (legData.description || '').replace(/"/g, '""') + poiStr.replace(/"/g, '""') + '","' + dist.toFixed(2) + '","' + azimuth + '° (' + getDirectionString(azimuth) + ')","' + resectionStr.replace(/"/g, '""') + '","' + (legData.notes || '').replace(/"/g, '""') + '"\n';
        }
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const cleanName = roadbook.name.replace(/[^a-zA-Z0-9א-ת\s]/g, '').replace(/\s+/g, '_');
    const a = document.createElement('a');
    a.href = url;
    a.download = `סיפור_דרך_${cleanName}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
    showToast('קובץ CSV יוצא בהצלחה!', 'success');
}

function exportPlaceToGpx(place) {
    if (!place.gpxData || place.gpxData.length === 0) {
        showToast('אין מסלול GPX לייצוא', 'error');
        return;
    }
    
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Bialik Travels Map" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <metadata>
    <name>${escapeHtml(place.name)}</name>
    <desc>קובץ מסלול משודרג שיוצר במפת החלומות</desc>
    <time>${new Date().toISOString()}</time>
  </metadata>
`;

    if (place.roadbooks && place.roadbooks.length > 0) {
        place.roadbooks.forEach(rb => {
            if (rb.resections && rb.resections.length > 0) {
                rb.resections.forEach(res => {
                    xml += `  <wpt lat="${res.lat}" lon="${res.lng}">
    <name>${escapeHtml(res.landmarkName)}</name>
    <desc>נקודת תצפית/הזדטרות מסיפור דרך: ${escapeHtml(rb.name)}</desc>
    <sym>Target</sym>
  </wpt>
`;
                });
            }
            if (rb.points && rb.points.length > 0) {
                rb.points.forEach((pt, pIdx) => {
                    if (pt.poi && pt.poi.type) {
                        xml += `  <wpt lat="${pt.lat}" lon="${pt.lng}">
    <name>${getPoiEmoji(pt.poi.type)} ${escapeHtml(pt.poi.name)}</name>
    <desc>${getPoiLabel(pt.poi.type)} (סיכה ${pIdx + 1} בסיפור דרך: ${escapeHtml(rb.name)})</desc>
    <sym>Waypoint</sym>
  </wpt>
`;
                    }
                });
            }
        });
    }

    xml += `  <trk>
    <name>${escapeHtml(place.name)}</name>
    <desc>מסלול ראשי</desc>
    <trkseg>
`;
    place.gpxData.forEach(pt => {
        const eleTag = pt.ele !== undefined ? `\n        <ele>${pt.ele}</ele>` : '';
        xml += `      <trkpt lat="${pt.lat}" lon="${pt.lng}">${eleTag}
      </trkpt>
`;
    });
    xml += `    </trkseg>
  </trk>
`;

    if (place.gpxSegments && place.gpxSegments.length > 0) {
        place.gpxSegments.forEach(seg => {
            const start = Math.min(seg.startIndex, seg.endIndex);
            const end = Math.max(seg.startIndex, seg.endIndex);
            const path = place.gpxData.slice(start, end + 1);
            if (path.length > 0) {
                xml += `  <trk>
    <name>${escapeHtml(seg.name)}</name>
    <desc>מקטע ניווט: ${escapeHtml(seg.description || '')}</desc>
    <trkseg>
`;
                path.forEach(pt => {
                    const eleTag = pt.ele !== undefined ? `\n            <ele>${pt.ele}</ele>` : '';
                    xml += `          <trkpt lat="${pt.lat}" lon="${pt.lng}">${eleTag}
          </trkpt>
`;
                });
                xml += `    </trkseg>
  </trk>
`;
            }
        });
    }

    xml += `</gpx>`;
    
    const blob = new Blob([xml], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const cleanName = place.name.replace(/[^a-zA-Z0-9א-ת\s]/g, '').replace(/\s+/g, '_');
    const a = document.createElement('a');
    a.href = url;
    a.download = `מסלול_${cleanName}_משודרג.gpx`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
    showToast('קובץ GPX משודרג הורד בהצלחה!', 'success');
}

// ============= Resizable Split Pane (Map / Places List) =============
function initResizablePanels() {
    const placesPanel = document.getElementById('places-panel');
    const itineraryPanel = document.getElementById('itinerary-panel');
    const mapPanel = document.getElementById('map-panel');
    const divPlacesItin = document.getElementById('places-itin-divider');
    const divItinMap = document.getElementById('itin-map-divider');
    const container = document.querySelector('.app-container');
    
    if (!placesPanel || !itineraryPanel || !mapPanel || !divPlacesItin || !divItinMap || !container) return;

    // Load saved widths/heights or use defaults
    let placesWidth = parseInt(localStorage.getItem('placesPanelWidth')) || 350;
    let itinWidth = parseInt(localStorage.getItem('itineraryPanelWidth')) || 380;
    let sideWidth = parseInt(localStorage.getItem('sidePanelsWidth')) || 380;
    let placesHeight = parseInt(localStorage.getItem('placesPanelHeight')) || 350;

    // Apply saved widths/heights on load
    container.style.setProperty('--places-width', `${placesWidth}px`);
    container.style.setProperty('--itin-width', `${itinWidth}px`);
    container.style.setProperty('--side-width', `${sideWidth}px`);
    container.style.setProperty('--places-height', `${placesHeight}px`);

    const setupDrag = (divider, onDrag, onStop) => {
        let isDragging = false;
        
        divider.addEventListener('mousedown', (e) => {
            isDragging = true;
            const currentLayout = localStorage.getItem('mytravel-app-layout') || 'cols';
            const isHorizontal = (divider.id === 'places-itin-divider' && currentLayout !== 'cols');
            
            document.body.style.cursor = isHorizontal ? 'row-resize' : 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            onDrag(e.clientX, e.clientY);
        });
        
        const stopDrag = () => {
            if (isDragging) {
                isDragging = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                if (onStop) onStop();
            }
        };

        document.addEventListener('mouseup', stopDrag);

        // Touch events
        divider.addEventListener('touchstart', (e) => {
            isDragging = true;
            e.preventDefault();
        });
        document.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            const touch = e.touches[0];
            onDrag(touch.clientX, touch.clientY);
        });
        document.addEventListener('touchend', stopDrag);
    };

    // places-itin divider
    setupDrag(divPlacesItin, (clientX, clientY) => {
        const currentLayout = localStorage.getItem('mytravel-app-layout') || 'cols';
        
        if (currentLayout === 'cols') {
            // Columns view: resizes placesPanel width (RTL)
            const containerRect = container.getBoundingClientRect();
            let width = containerRect.right - clientX;
            if (width < 250) width = 250;
            if (width > 600) width = 600;
            placesWidth = width;
            container.style.setProperty('--places-width', `${width}px`);
        } else {
            // Split view: resizes placesPanel height (Horizontal divider)
            const containerRect = container.getBoundingClientRect();
            let height = clientY - containerRect.top;
            if (height < 150) height = 150;
            if (height > containerRect.height - 150) height = containerRect.height - 150;
            placesHeight = height;
            container.style.setProperty('--places-height', `${height}px`);
        }
        
        if (typeof google !== 'undefined' && google.maps && map) {
            google.maps.event.trigger(map, 'resize');
        }
    }, () => {
        const currentLayout = localStorage.getItem('mytravel-app-layout') || 'cols';
        if (currentLayout === 'cols') {
            localStorage.setItem('placesPanelWidth', placesWidth);
        } else {
            localStorage.setItem('placesPanelHeight', placesHeight);
        }
    });

    // itin-map divider
    setupDrag(divItinMap, (clientX, clientY) => {
        const currentLayout = localStorage.getItem('mytravel-app-layout') || 'cols';
        const containerRect = container.getBoundingClientRect();
        
        if (currentLayout === 'cols') {
            // Columns view: resizes itineraryPanel width
            const placesRect = placesPanel.getBoundingClientRect();
            const startX = placesPanel.style.display !== 'none' ? placesRect.left : containerRect.right;
            let width = startX - clientX;
            if (width < 280) width = 280;
            if (width > 700) width = 700;
            itinWidth = width;
            container.style.setProperty('--itin-width', `${width}px`);
        } else if (currentLayout === 'map-left') {
            // Map Left view: itin-map divider separates side panels (right) and map (left)
            let width = containerRect.right - clientX;
            if (width < 280) width = 280;
            if (width > containerRect.width - 250) width = containerRect.width - 250;
            sideWidth = width;
            container.style.setProperty('--side-width', `${width}px`);
        } else if (currentLayout === 'map-right') {
            // Map Right view: itin-map divider separates map (right) and side panels (left)
            let width = clientX - containerRect.left;
            if (width < 280) width = 280;
            if (width > containerRect.width - 250) width = containerRect.width - 250;
            sideWidth = width;
            container.style.setProperty('--side-width', `${width}px`);
        }
        
        if (typeof google !== 'undefined' && google.maps && map) {
            google.maps.event.trigger(map, 'resize');
        }
    }, () => {
        const currentLayout = localStorage.getItem('mytravel-app-layout') || 'cols';
        if (currentLayout === 'cols') {
            localStorage.setItem('itineraryPanelWidth', itinWidth);
        } else {
            localStorage.setItem('sidePanelsWidth', sideWidth);
        }
    });
}

// ============= Horizontal Drag and Wheel Scroll for Groups & Subgroups =============
function initHorizontalDragScroll(container) {
    if (!container) return;

    // Mouse wheel translation (vertical wheel scroll -> horizontal scroll)
    container.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0) {
            e.preventDefault();
            container.scrollLeft += e.deltaY * 0.8;
        }
    }, { passive: false });

    // Mouse click and drag to scroll
    let isDown = false;
    let startX;
    let scrollLeftVal;

    container.addEventListener('mousedown', (e) => {
        // Guard: אל תתחיל drag-scroll כאשר המשתמש גורר ידית של Sortable
        if (
            e.target.closest('.group-drag-handle') ||
            e.target.closest('.sub-group-drag-handle') ||
            e.target.closest('.drag-handle')
        ) {
            return;
        }
        isDown = true;
        container.classList.add('dragging-active');
        startX = e.pageX - container.offsetLeft;
        scrollLeftVal = container.scrollLeft;
    });

    container.addEventListener('mouseleave', () => {
        isDown = false;
        container.classList.remove('dragging-active');
    });

    container.addEventListener('mouseup', () => {
        isDown = false;
        container.classList.remove('dragging-active');
    });

    // Throttled mousemove (≈60fps) – prevents excessive scroll recalculations
    const throttledMove = throttle((e) => {
        if (!isDown) return;
        const x = e.pageX - container.offsetLeft;
        const walk = (x - startX) * 1.5;
        container.scrollLeft = scrollLeftVal - walk;
    }, 16);

    container.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        throttledMove(e);
    });
}

// ============= Google Maps Link Parser =============
async function handleGmapsLinkImport() {
    const linkInput = document.getElementById('place-gmaps-link');
    const statusDiv = document.getElementById('gmaps-link-status');
    if (!linkInput || !statusDiv) return;
    
    const urlText = linkInput.value.trim();
    if (!urlText) {
        statusDiv.style.color = 'var(--accent-rose)';
        statusDiv.textContent = 'אנא הדבק קישור תקין של Google Maps';
        return;
    }
    
    if (!urlText.startsWith('http://') && !urlText.startsWith('https://')) {
        statusDiv.style.color = 'var(--accent-rose)';
        statusDiv.textContent = 'קישור לא תקין, חייב להתחיל ב-http:// או https://';
        return;
    }
    
    statusDiv.style.color = 'var(--text-secondary)';
    statusDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> מפענח את הקישור ומחלץ מידע...';
    
    try {
        let longUrl = urlText;
        
        // If it's a short URL, resolve it via backend redirect-resolver API
        if (urlText.includes('maps.app.goo.gl') || urlText.includes('goo.gl/maps')) {
            const apiEndpoint = `${window.location.origin}/api/resolve-link?url=${encodeURIComponent(urlText)}`;
            const res = await fetch(apiEndpoint);
            const data = await res.json();
            
            if (data.success && data.resolvedUrl) {
                longUrl = data.resolvedUrl;
            } else {
                throw new Error(data.error || 'נכשל בפענוח הקישור המקוצר');
            }
        }
        
        // Parse coordinates and query from long URL
        let lat = null;
        let lng = null;
        let queryName = null;
        
        // 1. Extract @latitude,longitude
        const atCoordsMatch = longUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (atCoordsMatch) {
            lat = parseFloat(atCoordsMatch[1]);
            lng = parseFloat(atCoordsMatch[2]);
        }
        
        // 2. Extract query name from /place/NAME
        const placeSegmentMatch = longUrl.match(/\/place\/([^/]+)/);
        if (placeSegmentMatch) {
            try {
                const rawSegment = placeSegmentMatch[1];
                queryName = decodeURIComponent(rawSegment.replace(/\+/g, ' '));
                
                // If it's coordinate format, parse it directly
                if (queryName.match(/^-?\d+\.\d+,\s*-?\d+\.\d+$/)) {
                    const parts = queryName.split(',');
                    lat = parseFloat(parts[0]);
                    lng = parseFloat(parts[1]);
                    queryName = null;
                }
            } catch (err) {
                console.error("Failed to decode place segment:", err);
            }
        }
        
        // 3. Fallback coordinate extraction from anywhere in path
        if (!lat || !lng) {
            const pathCoordsMatch = longUrl.match(/\/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
            if (pathCoordsMatch) {
                lat = parseFloat(pathCoordsMatch[1]);
                lng = parseFloat(pathCoordsMatch[2]);
            }
        }
        
        if (!lat && !lng && !queryName) {
            throw new Error('לא נמצאו קואורדינטות או שם מיקום בקישור המפוענח');
        }
        
        // Pre-fill the Google Maps URL field
        const googleUrlInput = document.getElementById('place-google-url');
        if (googleUrlInput) {
            googleUrlInput.value = urlText;
        }
        
        // Resolve place details
        if (queryName) {
            statusDiv.innerHTML = `<i class="fas fa-spinner fa-spin"></i> מחפש את "${queryName}" ב-Google Places...`;
            
            const service = new google.maps.places.PlacesService(document.createElement('div'));
            service.findPlaceFromQuery({
                query: queryName,
                fields: ['name', 'geometry', 'formatted_address', 'place_id']
            }, (results, status) => {
                if (status === 'OK' && results[0]) {
                    const place = results[0];
                    const placeLat = place.geometry.location.lat();
                    const placeLng = place.geometry.location.lng();
                    
                    document.getElementById('place-name').value = place.name;
                    document.getElementById('place-lat').value = placeLat.toFixed(6);
                    document.getElementById('place-lng').value = placeLng.toFixed(6);
                    document.getElementById('place-search').value = place.formatted_address || place.name;
                    
                    if (document.getElementById('place-id')) {
                        document.getElementById('place-id').value = place.place_id || '';
                    }
                    
                    updateMiniMap(placeLat, placeLng);
                    
                    statusDiv.style.color = 'var(--accent-emerald)';
                    statusDiv.innerHTML = '<i class="fas fa-check-circle"></i> המיקום נטען בהצלחה!';
                    linkInput.value = '';
                } else {
                    // Fallback to coordinates
                    if (lat && lng) {
                        reverseGeocodeCoords(lat, lng, queryName);
                    } else {
                        statusDiv.style.color = 'var(--accent-rose)';
                        statusDiv.textContent = `לא נמצאו תוצאות בגוגל עבור "${queryName}"`;
                    }
                }
            });
        } else if (lat && lng) {
            reverseGeocodeCoords(lat, lng, null);
        }
        
    } catch (error) {
        console.error("Link import failed:", error);
        statusDiv.style.color = 'var(--accent-rose)';
        statusDiv.textContent = `שגיאה בטעינת הקישור: ${error.message || error}`;
    }
}

function reverseGeocodeCoords(lat, lng, fallbackName) {
    const statusDiv = document.getElementById('gmaps-link-status');
    const linkInput = document.getElementById('place-gmaps-link');
    
    statusDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> מבצע פענוח גיאוגרפי של הקואורדינטות...';
    
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
        if (status === 'OK' && results[0]) {
            const address = results[0].formatted_address;
            document.getElementById('place-name').value = fallbackName || results[0].address_components[0].long_name || address;
            document.getElementById('place-lat').value = lat.toFixed(6);
            document.getElementById('place-lng').value = lng.toFixed(6);
            document.getElementById('place-search').value = address;
            
            updateMiniMap(lat, lng);
            
            statusDiv.style.color = 'var(--accent-emerald)';
            statusDiv.innerHTML = '<i class="fas fa-check-circle"></i> המיקום נטען בהצלחה!';
            if (linkInput) linkInput.value = '';
        } else {
            document.getElementById('place-name').value = fallbackName || `נקודה בציון דרך ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            document.getElementById('place-lat').value = lat.toFixed(6);
            document.getElementById('place-lng').value = lng.toFixed(6);
            
            updateMiniMap(lat, lng);
            
            statusDiv.style.color = 'var(--accent-emerald)';
            statusDiv.innerHTML = '<i class="fas fa-check-circle"></i> המיקום נטען לפי קואורדינטות (ללא כתובת)';
            if (linkInput) linkInput.value = '';
        }
    });
}

// ============= Debug Helper for Console Errors =============
(function() {
    const debugDiv = document.createElement('div');
    debugDiv.style.position = 'fixed';
    debugDiv.style.bottom = '20px';
    debugDiv.style.left = '20px';
    debugDiv.style.background = 'rgba(224, 107, 107, 0.98)';
    debugDiv.style.color = '#FDFBF7';
    debugDiv.style.padding = '14px 20px';
    debugDiv.style.borderRadius = '12px';
    debugDiv.style.zIndex = '99999';
    debugDiv.style.fontFamily = 'monospace';
    debugDiv.style.fontSize = '12px';
    debugDiv.style.maxWidth = '360px';
    debugDiv.style.boxShadow = '0 10px 30px rgba(0,0,0,0.3)';
    debugDiv.style.display = 'none';
    debugDiv.style.direction = 'ltr';
    debugDiv.style.textAlign = 'left';
    debugDiv.id = 'debug-error-console';
    debugDiv.innerHTML = '<strong style="display:block;margin-bottom:8px;font-size:13px;border-bottom:1px solid rgba(255,255,255,0.3);padding-bottom:4px;">💻 Debug Console Errors:</strong><div id="debug-text" style="white-space:pre-wrap;max-height:150px;overflow-y:auto;"></div>';
    document.body.appendChild(debugDiv);

    function showDebug(msg) {
        debugDiv.style.display = 'block';
        const txt = document.getElementById('debug-text');
        txt.textContent += msg + '\n\n';
    }

    window.addEventListener('error', (e) => {
        const fileName = e.filename ? String(e.filename).split('/').pop() : 'Unknown';
        showDebug(`Global Error: ${e.message}\nFile: ${fileName}\nLine: ${e.lineno}`);
    });

    window.addEventListener('unhandledrejection', (e) => {
        showDebug(`Promise Rejected: ${e.reason}`);
    });

    const oldError = console.error;
    console.error = function(...args) {
        oldError.apply(console, args);
        // Clean up common long traces
        const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
        
        // Ignore expected offline Firebase/Firestore connection warnings
        if (msg.includes('code=unavailable') || msg.includes('Could not reach Cloud Firestore') || msg.includes('Firestore (10.8.0)') || msg.includes('Firestore backend')) {
            return;
        }
        
        if (msg.includes('Google Maps') || msg.includes('Autocomplete') || msg.includes('places') || msg.includes('Error')) {
            showDebug(`Console Error: ${msg}`);
        }
    };

    window.gm_authFailure = function() {
        showDebug("Google Maps Auth Failure! Check Billing and Key Restrictions.");
    };

    // ============= Admin Mode =============
    const adminModePasswordHash = "1509442"; // default password: "1234"

    function hashPassword(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash;
        }
        return String(hash);
    }

    window.checkAdminMode = function() {
        if (sessionStorage.getItem('isAdmin') === 'true') {
            document.body.classList.add('admin-mode');
            const lockBtn = document.getElementById('btn-admin-lock');
            if (lockBtn) {
                lockBtn.innerHTML = '<i class="fas fa-lock-open"></i><span class="admin-btn-text">מנהל</span>';
                lockBtn.title = 'יציאה ממצב מנהל';
            }
        }
    };

    // Admin Mode Event Listeners
    const adminLockBtn = document.getElementById('btn-admin-lock');
    const adminModal = document.getElementById('admin-modal-overlay');
    const adminCloseBtn = document.getElementById('admin-modal-close');
    const adminCancelBtn = document.getElementById('btn-admin-cancel');
    const adminSubmitBtn = document.getElementById('btn-admin-submit');
    const adminPasswordInput = document.getElementById('admin-password');

    if (adminLockBtn && adminModal) {
        adminLockBtn.addEventListener('click', () => {
            const isAdmin = document.body.classList.contains('admin-mode');
            if (isAdmin) {
                if (confirm('האם ברצונך לצאת ממצב מנהל?')) {
                    document.body.classList.remove('admin-mode');
                    sessionStorage.removeItem('isAdmin');
                    adminLockBtn.innerHTML = '<i class="fas fa-lock"></i><span class="admin-btn-text">עריכה</span>';
                    adminLockBtn.title = 'כניסת מנהל';
                    showToast('יצאת ממצב מנהל בהצלחה', 'info');
                    renderPlaces();
                    renderGroupTabs();
                }
            } else {
                adminPasswordInput.value = '';
                adminModal.classList.add('active');
                adminPasswordInput.focus();
            }
        });

        const closeAdminModal = () => {
            adminModal.classList.remove('active');
        };

        if (adminCloseBtn) adminCloseBtn.addEventListener('click', closeAdminModal);
        if (adminCancelBtn) adminCancelBtn.addEventListener('click', closeAdminModal);

        const submitAdminLogin = () => {
            const password = adminPasswordInput.value;
            const hash = hashPassword(password);
            if (hash === adminModePasswordHash) {
                document.body.classList.add('admin-mode');
                sessionStorage.setItem('isAdmin', 'true');
                adminLockBtn.innerHTML = '<i class="fas fa-lock-open"></i><span class="admin-btn-text">מנהל</span>';
                adminLockBtn.title = 'יציאה ממצב מנהל';
                showToast('ברוך הבא! נכנסת למצב מנהל', 'success');
                closeAdminModal();
                renderPlaces();
                renderGroupTabs();
            } else {
                showToast('סיסמה שגויה!', 'error');
            }
        };

        if (adminSubmitBtn) adminSubmitBtn.addEventListener('click', submitAdminLogin);
        if (adminPasswordInput) {
            adminPasswordInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    submitAdminLogin();
                }
            });
        }
    }

    // Mobile FAB for adding place
    const mobileAddFab = document.getElementById('mobile-add-fab');
    if (mobileAddFab) {
        mobileAddFab.addEventListener('click', () => {
            const addBtn = document.getElementById('btn-add-place');
            if (addBtn) addBtn.click();
        });
    }

    // Dynamic Groups Bar Reparenting for Mobile
    window.adjustLayoutForMobile = function() {
        const isMobile = window.innerWidth <= 900;
        const groupsBar = document.getElementById('groups-bar');
        const appContainer = document.querySelector('.app-container');
        const placesPanel = document.getElementById('places-panel');
        
        if (groupsBar && appContainer && placesPanel) {
            if (isMobile) {
                if (groupsBar.parentElement !== appContainer) {
                    appContainer.insertBefore(groupsBar, appContainer.firstChild);
                }
            } else {
                if (groupsBar.parentElement !== placesPanel) {
                    const searchWrapper = document.querySelector('.search-places-wrapper');
                    if (searchWrapper) {
                        placesPanel.insertBefore(groupsBar, searchWrapper.nextSibling);
                    } else {
                        placesPanel.insertBefore(groupsBar, placesPanel.firstChild);
                    }
                }
            }
        }
    };

    window.addEventListener('resize', window.adjustLayoutForMobile);

    // Geolocation Tracking (GPS)
    const gpsBtn = document.getElementById('btn-map-gps');
    
    const blueDotSVG = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">
            <circle cx="15" cy="15" r="12" fill="#3b82f6" fill-opacity="0.15"/>
            <circle cx="15" cy="15" r="8" fill="white" stroke="#3b82f6" stroke-width="1.5"/>
            <circle cx="15" cy="15" r="5" fill="#3b82f6"/>
        </svg>
    `);

    if (gpsBtn) {
        gpsBtn.addEventListener('click', () => {
            if (isTrackingUser) {
                // Turn off GPS tracking
                if (watchId !== null) {
                    navigator.geolocation.clearWatch(watchId);
                    watchId = null;
                }
                if (userLocationMarker) {
                    userLocationMarker.setMap(null);
                    userLocationMarker = null;
                }
                if (leafletUserMarker) {
                    if (leafletMap) leafletMap.removeLayer(leafletUserMarker);
                    leafletUserMarker = null;
                }
                gpsBtn.classList.remove('tracking');
                isTrackingUser = false;
                showToast('מעקב GPS הופסק', 'info');
            } else {
                // Turn on GPS tracking
                if (!navigator.geolocation) {
                    showToast('דפדפן זה אינו תומך במיקום GPS', 'error');
                    return;
                }
                
                showToast('מפעיל GPS ומאתר מיקום...', 'info');
                gpsBtn.classList.add('tracking');
                isTrackingUser = true;

                watchId = navigator.geolocation.watchPosition(
                    (position) => {
                        const lat = position.coords.latitude;
                        const lng = position.coords.longitude;
                        
                        if (isOfflineMode) {
                            if (typeof L !== 'undefined' && leafletMap) {
                                const pos = [lat, lng];
                                if (!leafletUserMarker) {
                                    const userIcon = L.icon({
                                        iconUrl: blueDotSVG,
                                        iconSize: [30, 30],
                                        iconAnchor: [15, 15]
                                    });
                                    leafletUserMarker = L.marker(pos, { icon: userIcon, zIndexOffset: 9999 }).addTo(leafletMap);
                                } else {
                                    leafletUserMarker.setLatLng(pos);
                                }
                                leafletMap.panTo(pos);
                                if (leafletMap.getZoom() < 15) {
                                    leafletMap.setZoom(16);
                                }
                            }
                        } else if (typeof google !== 'undefined' && google.maps && map) {
                            const pos = { lat, lng };
                            
                            if (!userLocationMarker) {
                                userLocationMarker = new google.maps.Marker({
                                    position: pos,
                                    map: map,
                                    icon: {
                                        url: blueDotSVG,
                                        scaledSize: new google.maps.Size(30, 30),
                                        anchor: new google.maps.Point(15, 15)
                                    },
                                    title: 'המיקום שלי',
                                    zIndex: 9999
                                });
                            } else {
                                userLocationMarker.setPosition(pos);
                            }
                            
                            // Center map on user location
                            map.panTo(pos);
                            
                            // Zoom in if map is zoomed out
                            if (map.getZoom() < 15) {
                                map.setZoom(16);
                            }
                        }
                    },
                    (err) => {
                        console.error('Geolocation error:', err);
                        showToast('שגיאה בקבלת מיקום GPS. ודא שהרשאות המיקום פעילות במכשיר.', 'error');
                        
                        // Reset tracking button state
                        if (watchId !== null) {
                            navigator.geolocation.clearWatch(watchId);
                            watchId = null;
                        }
                        if (userLocationMarker) {
                            userLocationMarker.setMap(null);
                            userLocationMarker = null;
                        }
                        if (leafletUserMarker) {
                            if (leafletMap) leafletMap.removeLayer(leafletUserMarker);
                            leafletUserMarker = null;
                        }
                        gpsBtn.classList.remove('tracking');
                        isTrackingUser = false;
                    },
                    {
                        enableHighAccuracy: true,
                        timeout: 10000,
                        maximumAge: 0
                    }
                );
            }
        });
    }

    // ============= Offline Maps Management (Leaflet & Corridor Caching) =============
    
    // Initialize Leaflet Map
    function initLeafletMap() {
        if (leafletMap || typeof L === 'undefined') return;
        
        leafletMap = L.map('leaflet-map', {
            zoomControl: false,
            attributionControl: false
        }).setView([31.5, 34.8], 9);
        
        const isMobile = window.innerWidth <= 900;
        if (!isMobile) {
            L.control.zoom({
                position: 'bottomleft'
            }).addTo(leafletMap);
        }
        
        // Define base tile layers for Leaflet (Offline Map)
        const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 20,
            maxNativeZoom: 17
        });
        
        const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            maxZoom: 20,
            maxNativeZoom: 17
        });
        
        // Add default layer
        osmLayer.addTo(leafletMap);
        
        // Add standard Leaflet Layer switcher control
        L.control.layers({
            "מפת כבישים (OSM)": osmLayer,
            "מפת שטח (OpenTopo)": topoLayer
        }, null, {
            position: 'topleft'
        }).addTo(leafletMap);
    }

    // Redraw all elements on Leaflet Map
    window.syncLeafletView = function() {
        if (typeof L === 'undefined') return;
        if (!leafletMap) {
            initLeafletMap();
        }
        
        // Clear existing polylines
        leafletPolylines.forEach(p => leafletMap.removeLayer(p));
        leafletPolylines = [];
        
        // Clear existing markers
        leafletMarkers.forEach(m => leafletMap.removeLayer(m));
        leafletMarkers = [];
        
        const visiblePlaces = getFilteredPlaces();
        if (visiblePlaces.length === 0) return;
        
        const bounds = L.latLngBounds();
        
        // 1. Draw GPX tracks
        visiblePlaces.forEach(place => {
            if (place.gpxData && place.gpxData.length > 0) {
                const latlngs = place.gpxData.map(pt => [pt.lat, pt.lng]);
                const isHighlighted = (place.id === activeMarkerId);
                const color = isHighlighted ? '#E5B23A' : '#2C4E72';
                const weight = isHighlighted ? 5 : 3.5;
                
                const poly = L.polyline(latlngs, {
                    color: color,
                    weight: weight,
                    opacity: 0.85
                }).addTo(leafletMap);
                
                leafletPolylines.push(poly);
                
                // Draw active itinerary day specific GPX segments in Leaflet
                let activeItinerary = null;
                if (typeof activeItineraryId !== 'undefined' && activeItineraryId && typeof itineraries !== 'undefined') {
                    activeItinerary = itineraries.find(itin => itin.id === activeItineraryId);
                }

                if (activeItinerary) {
                    activeItinerary.days.forEach((day, dayIdx) => {
                        if (day.gpxPlaceId === place.id && (day.gpxStartKm !== null || day.gpxEndKm !== null)) {
                            const startKm = day.gpxStartKm !== null ? day.gpxStartKm : 0;
                            const endKm = day.gpxEndKm !== null ? day.gpxEndKm : 99999;
                            
                            // Extract points within range
                            const segmentPoints = place.gpxData.filter(pt => pt.dist >= startKm && pt.dist <= endKm);
                            
                            if (segmentPoints.length > 1) {
                                const dayColor = day.color || activeItinerary.color || '#E5B23A';
                                const leafLatLngs = segmentPoints.map(pt => [pt.lat, pt.lng]);
                                
                                const dayPoly = L.polyline(leafLatLngs, {
                                    color: dayColor,
                                    weight: 7, // Thicker segment
                                    opacity: 0.95
                                }).addTo(leafletMap);
                                
                                const dayNum = dayIdx + 1;
                                dayPoly.bindPopup(`
                                    <div style="direction: rtl; text-align: right; font-family: 'Varela Round', sans-serif; padding: 2px;">
                                        <strong>יום ${dayNum}: ${escapeHtml(day.title || 'יום טיול')}</strong><br>
                                        <span style="font-size:11px; color:#555;">مקטע מסלול: ק"מ ${startKm.toFixed(1)} עד ק"מ ${endKm.toFixed(1)}</span>
                                    </div>
                                `);
                                
                                leafletPolylines.push(dayPoly);
                            }
                        }
                    });
                }
                
                latlngs.forEach(ll => bounds.extend(ll));
            }
        });
        
        // 2. Draw Places Markers
        visiblePlaces.forEach(place => {
            if (!place.lat || !place.lng) return;
            
            const isHighlighted = (place.id === activeMarkerId);
            const group = groups.find(g => g.id === place.groupId);
            const badgeColor = group ? group.color : '#2C4E72';
            const labelText = String(place.sortOrder ?? '');
            
            const markerHtml = `
                <div class="custom-leaflet-marker ${isHighlighted ? 'highlighted' : ''}" style="position:relative; display:flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:50%; background:white; border:2.5px solid ${badgeColor}; box-shadow: 0 2px 6px rgba(0,0,0,0.25);">
                    <span style="font-size:11px; font-weight:bold; color:#333;">${labelText}</span>
                </div>
            `;
            
            const customIcon = L.divIcon({
                html: markerHtml,
                className: 'leaflet-custom-marker-wrapper',
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            });
            
            const marker = L.marker([place.lat, place.lng], { icon: customIcon })
                .addTo(leafletMap)
                .on('click', () => {
                    activeMarkerId = place.id;
                    syncLeafletView();
                    renderPlaces();
                    // Scroll to the card
                    const card = document.querySelector(`.place-card[data-place-id="${place.id}"]`);
                    if (card) {
                        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        card.classList.add('pulse-highlight');
                        setTimeout(() => card.classList.remove('pulse-highlight'), 1500);
                    }
                });
            marker.placeId = place.id;
            leafletMarkers.push(marker);
            bounds.extend([place.lat, place.lng]);
        });
        
        // 3. Keep user location marker
        if (isTrackingUser && leafletUserMarker) {
            leafletUserMarker.addTo(leafletMap);
        }
        
        // Fit bounds
        if (bounds.isValid()) {
            leafletMap.fitBounds(bounds, { padding: [40, 40] });
        }
    };

    // Convert lat/lng to tile coordinate x/y
    function getTileXY(lat, lon, zoom) {
        const x = Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
        const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
        return { x, y, z: zoom };
    }

    // Generate unique tile URLs along track coordinates for zooms 12-17 for high precision offline use
    function getTilesForTrack(gpxData, layerType) {
        const tiles = new Set();
        const zooms = [12, 13, 14, 15, 16, 17];
        
        gpxData.forEach(pt => {
            zooms.forEach(z => {
                const tile = getTileXY(pt.lat, pt.lng, z);
                let url = '';
                if (layerType === 'osm') {
                    url = `https://tile.openstreetmap.org/${z}/${tile.x}/${tile.y}.png`;
                } else if (layerType === 'opentopo') {
                    url = `https://a.tile.opentopomap.org/${z}/${tile.x}/${tile.y}.png`;
                }
                tiles.add(url);
            });
        });
        
        return Array.from(tiles);
    }

    // Toggle Offline map mode
    window.toggleOfflineMode = function(enable) {
        isOfflineMode = enable;
        if (enable) {
            document.body.classList.add('offline-map-active');
            syncLeafletView();
        } else {
            document.body.classList.remove('offline-map-active');
            if (map) {
                google.maps.event.trigger(map, 'resize');
            }
        }
    };

    // Download tiles and save to Cache API
    async function downloadOfflineTiles(urls, mapKey, mapName, layerType) {
        const progressContainer = document.getElementById('offline-progress-container');
        const progressBar = document.getElementById('offline-progress-bar');
        const progressText = document.getElementById('offline-progress-text');
        const progressPercent = document.getElementById('offline-progress-percent');
        const downloadBtn = document.getElementById('btn-download-offline-map');
        
        if (progressContainer) progressContainer.style.display = 'block';
        if (downloadBtn) downloadBtn.disabled = true;
        
        try {
            const cache = await caches.open('offline-tiles-cache');
            const total = urls.length;
            let downloaded = 0;
            
            // Download in small chunks of 8 to avoid overloading requests
            const chunkSize = 8;
            for (let i = 0; i < urls.length; i += chunkSize) {
                const chunk = urls.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async (url) => {
                    try {
                        const response = await fetch(url, { mode: 'cors' });
                        if (response.ok) {
                            await cache.put(url, response);
                        }
                    } catch (err) {
                        console.warn('Failed to download offline tile:', url, err);
                    }
                    downloaded++;
                    const pct = Math.min(100, Math.round((downloaded / total) * 100));
                    if (progressBar) progressBar.style.width = `${pct}%`;
                    if (progressPercent) progressPercent.innerText = `${pct}%`;
                    if (progressText) progressText.innerText = `מוריד אריחים... (${downloaded}/${total})`;
                }));
            }
            
            // Save registry to localStorage
            const savedList = JSON.parse(localStorage.getItem('savedOfflineMaps') || '[]');
            const existingIndex = savedList.findIndex(item => item.id === mapKey);
            
            const newMapItem = {
                id: mapKey,
                name: mapName,
                count: total,
                layer: layerType,
                timestamp: Date.now()
            };
            
            if (existingIndex > -1) {
                savedList[existingIndex] = newMapItem;
            } else {
                savedList.push(newMapItem);
            }
            
            localStorage.setItem('savedOfflineMaps', JSON.stringify(savedList));
            showToast('המפה הורדה למכשיר בהצלחה!', 'success');
            
        } catch (err) {
            console.error('Offline download failed:', err);
            showToast('שגיאה במהלך ההורדה', 'error');
        } finally {
            if (downloadBtn) downloadBtn.disabled = false;
            setTimeout(() => {
                if (progressContainer) progressContainer.style.display = 'none';
            }, 2500);
            updateSavedMapsList();
        }
    }

    // Render list of saved offline maps
    function updateSavedMapsList() {
        const container = document.getElementById('offline-saved-list');
        if (!container) return;
        
        const savedList = JSON.parse(localStorage.getItem('savedOfflineMaps') || '[]');
        if (savedList.length === 0) {
            container.innerHTML = `<div style="text-align: center; padding: 8px; font-style: italic;">אין מפות שמורות עדיין</div>`;
            return;
        }
        
        container.innerHTML = savedList.map(item => {
            const layerLabel = item.layer === 'osm' ? 'דרכים' : 'טופוגרפי';
            return `
                <div class="offline-saved-item">
                    <div>
                        <strong style="color: var(--text-primary);">${item.name}</strong>
                        <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                            שכבה: ${layerLabel} | אריחים: ${item.count}
                        </div>
                    </div>
                    <button class="delete-map-btn" data-map-id="${item.id}" title="מחק מפה">
                        <i class="fas fa-trash-alt"></i> מחק
                    </button>
                </div>
            `;
        }).join('');
        
        // Bind delete buttons
        container.querySelectorAll('.delete-map-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const mapId = e.currentTarget.dataset.mapId;
                if (confirm('האם ברצונך למחוק מפה שמורה זו מהמכשיר?')) {
                    await deleteSavedMap(mapId);
                }
            });
        });
    }

    // Delete saved map cache
    async function deleteSavedMap(mapKey) {
        const savedList = JSON.parse(localStorage.getItem('savedOfflineMaps') || '[]');
        const mapItem = savedList.find(item => item.id === mapKey);
        if (!mapItem) return;
        
        // Remove from registry
        const updatedList = savedList.filter(item => item.id !== mapKey);
        localStorage.setItem('savedOfflineMaps', JSON.stringify(updatedList));
        
        // Delete corresponding URLs from cache
        try {
            const cache = await caches.open('offline-tiles-cache');
            
            // To delete URLs, we recalculate which ones they were
            let urlsToDelete = [];
            if (mapItem.id.startsWith('all')) {
                // All treks
                const allPoints = [];
                places.forEach(p => {
                    if (p.gpxData) allPoints.push(...p.gpxData);
                });
                urlsToDelete = getTilesForTrack(allPoints, mapItem.layer);
            } else {
                // Specific trek
                const place = places.find(p => p.id === mapItem.id.split('_')[0]);
                if (place && place.gpxData) {
                    urlsToDelete = getTilesForTrack(place.gpxData, mapItem.layer);
                }
            }
            
            await Promise.all(urlsToDelete.map(url => cache.delete(url)));
            showToast('המפה נמחקה מהמכשיר בהצלחה', 'info');
        } catch (err) {
            console.error('Failed to delete map cache:', err);
        } finally {
            updateSavedMapsList();
        }
    }

    // Offline Modal UI Event Listeners
    const offlineManagerBtn = document.getElementById('btn-offline-manager');
    const offlineModal = document.getElementById('offline-modal-overlay');
    const offlineCloseBtn = document.getElementById('offline-modal-close');
    const downloadOfflineBtn = document.getElementById('btn-download-offline-map');
    const simulateOfflineCheckbox = document.getElementById('toggle-simulate-offline');
    const offlineTrekSelect = document.getElementById('offline-trek-select');
    
    if (offlineManagerBtn && offlineModal) {
        offlineManagerBtn.addEventListener('click', () => {
            // Populate trek select
            if (offlineTrekSelect) {
                offlineTrekSelect.innerHTML = `<option value="all">כל המסלולים השמורים</option>` + 
                    places.filter(p => p.gpxData && p.gpxData.length > 0)
                        .map(p => `<option value="${p.id}">${p.name}</option>`)
                        .join('');
            }
            updateSavedMapsList();
            offlineModal.classList.add('active');
        });
        
        if (offlineCloseBtn) {
            offlineCloseBtn.addEventListener('click', () => {
                offlineModal.classList.remove('active');
            });
        }
        
        const offlineCloseBottomBtn = document.getElementById('btn-offline-close-bottom');
        if (offlineCloseBottomBtn) {
            offlineCloseBottomBtn.addEventListener('click', () => {
                offlineModal.classList.remove('active');
            });
        }
        
        // Start tile downloading
        if (downloadOfflineBtn) {
            downloadOfflineBtn.addEventListener('click', async () => {
                const layerType = document.getElementById('offline-layer-select').value;
                const trekId = offlineTrekSelect.value;
                
                let points = [];
                let mapName = '';
                let mapKey = '';
                
                if (trekId === 'all') {
                    places.forEach(p => {
                        if (p.gpxData) points.push(...p.gpxData);
                    });
                    mapName = 'כל המסלולים';
                    mapKey = `all_${layerType}`;
                } else {
                    const place = places.find(p => p.id === trekId);
                    if (place && place.gpxData) {
                        points = place.gpxData;
                        mapName = place.name;
                        mapKey = `${place.id}_${layerType}`;
                    }
                }
                
                if (points.length === 0) {
                    showToast('לא נמצאו קואורדינטות מסלול GPX להורדה', 'warning');
                    return;
                }
                
                showToast('מחשב אריחי מפה להורדה...', 'info');
                const urls = getTilesForTrack(points, layerType);
                
                if (urls.length === 0) {
                    showToast('שגיאה בחישוב אריחי מפה', 'error');
                    return;
                }
                
                if (urls.length > 2000) {
                    if (!confirm(`שים לב: המפה שבחרת דורשת ${urls.length} אריחים. ההורדה עשויה לקחת דקה. להמשיך?`)) {
                        return;
                    }
                }
                
                await downloadOfflineTiles(urls, mapKey, mapName, layerType);
            });
        }
        
        // Simulation Toggle
        if (simulateOfflineCheckbox) {
            simulateOfflineCheckbox.addEventListener('change', (e) => {
                toggleOfflineMode(e.target.checked);
                if (e.target.checked) {
                    showToast('מצב לא מקוון מדומה מופעל', 'info');
                } else {
                    showToast('חזרת למצב מקוון (מפות גוגל)', 'info');
                }
            });
        }
    }

    // Auto-detection of offline/online state
    window.addEventListener('offline', () => {
        showToast('החיבור לאינטרנט אבד! עובר אוטומטית למפות שטח אוף-ליין', 'warning');
        toggleOfflineMode(true);
        if (simulateOfflineCheckbox) simulateOfflineCheckbox.checked = true;
    });
    
    window.addEventListener('online', () => {
        // Only turn off if not explicitly simulated by user
        if (simulateOfflineCheckbox && !simulateOfflineCheckbox.checked) {
            showToast('החיבור לאינטרנט חזר! טוען מפות גוגל מקוונות', 'success');
            toggleOfflineMode(false);
        }
    });

    // Handle startup state
    setTimeout(() => {
        if (!navigator.onLine) {
            toggleOfflineMode(true);
            if (simulateOfflineCheckbox) simulateOfflineCheckbox.checked = true;
        }
    }, 1000);

    window.switchToMobileMapTab = function() {
        const tabList = document.getElementById('mobile-tab-list');
        const tabMap = document.getElementById('mobile-tab-map');
        if (tabList && tabMap) {
            document.body.classList.remove('mobile-view-list');
            document.body.classList.add('mobile-view-map');
            tabList.classList.remove('active');
            tabMap.classList.add('active');
            
            // Trigger Map resize or Leaflet view synchronization
            if (isOfflineMode) {
                if (leafletMap) {
                    setTimeout(() => leafletMap.invalidateSize(), 50);
                }
            } else if (typeof google !== 'undefined' && google.maps && map) {
                setTimeout(() => google.maps.event.trigger(map, 'resize'), 50);
            }
        }
    };

    // Prevent pinch-to-zoom on mobile except inside the maps
    document.addEventListener('touchstart', (e) => {
        if (e.touches.length > 1) {
            const isMap = e.target.closest('#map') || e.target.closest('#leaflet-map');
            if (!isMap) {
                e.preventDefault();
            }
        }
    }, { passive: false });

    // Prevent double-tap to zoom on UI elements
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (e) => {
        const now = (new Date()).getTime();
        if (now - lastTouchEnd <= 300) {
            const isMap = e.target.closest('#map') || e.target.closest('#leaflet-map');
            if (!isMap) {
                e.preventDefault();
            }
        }
        lastTouchEnd = now;
    }, { passive: false });
})();

// Global function to center and highlight a place from the Itinerary timeline/calendar views
window.focusPlaceOnMap = function(placeId) {
    if (typeof places === 'undefined') return;
    const place = places.find(p => p.id === placeId);
    if (!place) return;

    // Center and pan map to place coordinates or fit GPX bounds
    panToPlace(place);

    if (isOfflineMode) {
        // Offline Leaflet Mode
        if (typeof L !== 'undefined' && leafletMap && typeof leafletMarkers !== 'undefined') {
            const marker = leafletMarkers.find(m => m.placeId === placeId);
            if (marker) {
                marker.fire('click');
            }
        }
    } else {
        // Online Google Maps Mode
        if (typeof google !== 'undefined' && google.maps && map && typeof markers !== 'undefined') {
            const marker = markers.find(m => m.placeId === placeId);
            if (marker) {
                google.maps.event.trigger(marker, 'click');
            }
        }
    }

    // Switch to map tab if on mobile screen
    if (window.innerWidth <= 900) {
        if (typeof switchToMobileMapTab === 'function') {
            switchToMobileMapTab();
        } else {
            const tabMap = document.getElementById('mobile-tab-map');
            if (tabMap) tabMap.click();
        }
    }
};
