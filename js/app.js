import {
    places, setPlaces,
    groups, setGroups,
    activeGroupId, setActiveGroupId,
    activeSubGroupId, setActiveSubGroupId,
    deleteTargetId, setDeleteTargetId,
    pendingGpxData, setPendingGpxData,
    searchQuery, setSearchQuery,
    savePlaces, saveGroups,
    getGroupById,
    STORAGE_KEY, GROUPS_KEY,
    DEFAULT_CENTER,
    generateId,
    isOfflineMode, setIsOfflineMode,
    debounce,
    itineraries,
    map, markers,
    miniMap, setMiniMap,
    miniMapMarker, setMiniMapMarker,
    pendingImages, setPendingImages
} from './state.js';

import {
    loadPlaces,
    loadGroups
} from './db.js';

import {
    initMap,
    renderMarkers,
    drawAllGpxTracks,
    fitMapBounds,
    syncLeafletView,
    parseGpxFile
} from './map.js';

import {
    renderGroupTabs,
    renderGroupSelect,
    renderGroupParentSelect,
    renderPlaces,
    openModal,
    closeModal,
    savePlace,
    confirmDelete,
    executeDelete,
    addLinkInput,
    showToast,
    closeGooglePlacePanel,
    escapeHtml,
    setActiveMarker,
    renderImagePreviews,
    checkAdminMode,
    initAdminEvents,
    initOfflineEvents
} from './ui.js';

import {
    initItinerary
} from './itinerary.js';

import {
    closeRoadbookModal,
    downloadRoadbookCsv,
    deleteRoadbook
} from './roadbook.js';

import {
    openRecordingControlBar,
    closeRecordingControlBar
} from './animation.js';

import {
    customMapStyle,
    darkMapStyle
} from './map-styles.js';

// ============= Helper: Scroll to Card =============
function scrollToCard(placeId) {
    const card = document.querySelector(`.place-card[data-id="${placeId}"]`);
    if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('highlighted');
        setTimeout(() => card.classList.remove('highlighted'), 2000);
    }
}
window.scrollToCard = scrollToCard;

// ============= Helper: Geocode Coordinates =============
function reverseGeocodeCoords(lat, lng, callback) {
    if (typeof google === 'undefined' || !google.maps) {
        callback(`נקודה בציון דרך ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        return;
    }
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
        if (status === 'OK' && results[0]) {
            callback(results[0].formatted_address);
        } else {
            callback(`נקודה בציון דרך ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        }
    });
}

// ============= Add Group / CRUD =============
function addGroup(name, color, parentId = '', description = '') {
    const id = 'group-' + Date.now();
    const group = { id, name, color, parentId, description };
    groups.push(group);
    saveGroups();

    // Sync to cloud
    if (window.IS_FIREBASE_CONFIGURED && window.db) {
        window.db.collection('groups').doc(id).set(group)
            .catch(err => console.error("Error syncing group to Firebase:", err));
    }

    renderGroupTabs();
    renderGroupSelect();
    renderGroupParentSelect();
    return group;
}
window.addGroup = addGroup;

function deleteGroup(groupId) {
    // Check if group has subgroups or places
    const hasSubgroups = groups.some(g => g.parentId === groupId);
    const hasPlaces = places.some(p => p.groupId === groupId);

    if (hasSubgroups || hasPlaces) {
        showToast('לא ניתן למחוק קבוצה המכילה תתי-קבוצות או מיקומים שמורים', 'error');
        return;
    }

    setGroups(groups.filter(g => g.id !== groupId));
    saveGroups();

    // Sync to cloud
    if (window.IS_FIREBASE_CONFIGURED && window.db) {
        window.db.collection('groups').doc(groupId).delete()
            .catch(err => console.error("Error deleting group from Firebase:", err));
    }

    renderGroupTabs();
    renderGroupSelect();
    renderGroupParentSelect();
    renderGroupManageList();
    showToast('הקבוצה נמחקה בהצלחה', 'success');
}
window.deleteGroup = deleteGroup;

// ============= Render Groups Manage List =============
function renderGroupManageList() {
    const container = document.getElementById('groups-list-manage');
    if (!container) return;

    if (groups.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--text-muted); font-size:13px; padding:10px 0;">אין קבוצות מוגדרות עדיין.</p>';
        return;
    }

    // Sort: Parent groups first, then their children
    const parents = groups.filter(g => !g.parentId);
    let html = '';

    parents.forEach(p => {
        const count = places.filter(pl => pl.groupId === p.id).length;
        html += `
            <div class="group-manage-item parent-group" style="border-right: 3px solid ${p.color}; padding:8px 10px; margin-bottom:6px; background:var(--primary-bg); border-radius:4px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <strong style="color:var(--text-primary); font-size:13px;">${escapeHtml(p.name)}</strong>
                    <span style="font-size:11px; color:var(--text-muted); margin-right:6px;">(${count} מקומות)</span>
                </div>
                <button type="button" onclick="deleteGroup('${p.id}')" style="border:none; background:transparent; color:var(--accent-rose); cursor:pointer; font-size:13px;" title="מחק קבוצה"><i class="fas fa-trash-alt"></i></button>
            </div>
        `;

        const children = groups.filter(g => g.parentId === p.id);
        children.forEach(c => {
            const subCount = places.filter(pl => pl.groupId === c.id).length;
            html += `
                <div class="group-manage-item sub-group" style="border-right: 3px solid ${p.color}; padding:6px 10px 6px 10px; margin-right:15px; margin-bottom:6px; background:var(--primary-bg); opacity:0.9; border-radius:4px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <span style="font-size:11px; color:var(--text-muted); margin-left:4px;">➔</span>
                        <strong style="color:var(--text-secondary); font-size:12.5px;">${escapeHtml(c.name)}</strong>
                        <span style="font-size:10.5px; color:var(--text-muted); margin-right:6px;">(${subCount} מקומות)</span>
                    </div>
                    <button type="button" onclick="deleteGroup('${c.id}')" style="border:none; background:transparent; color:var(--accent-rose); cursor:pointer; font-size:12px;" title="מחק תת-קבוצה"><i class="fas fa-trash-alt"></i></button>
                </div>
            `;
        });
    });

    container.innerHTML = html;
}
window.renderGroupManageList = renderGroupManageList;

function openGroupsModal() {
    document.getElementById('groups-modal-overlay').classList.add('active');
    renderGroupParentSelect();
    renderGroupManageList();
}
window.openGroupsModal = openGroupsModal;

function closeGroupsModal() {
    document.getElementById('groups-modal-overlay').classList.remove('active');
}
window.closeGroupsModal = closeGroupsModal;

// ============= Images Upload Handler (Local Previews) =============
function handleImageUpload(files) {
    if (!files || files.length === 0) return;

    showToast('מעבד תמונות...', 'info');

    Array.from(files).forEach(file => {
        // Validation
        if (!file.type.startsWith('image/')) {
            showToast('ניתן להעלות קבצי תמונה בלבד', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            // Compress image using canvas before storing (max width/height 1000px)
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const maxDim = 1000;

                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Get compressed base64 data URL
                const compressedBase64 = canvas.toDataURL('image/jpeg', 0.75); // 75% quality

                setPendingImages([...pendingImages, compressedBase64]);
                renderImagePreviews();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}
window.handleImageUpload = handleImageUpload;

// ============= Import Google Maps link coordinates =============
async function handleGmapsLinkImport() {
    const linkInput = document.getElementById('place-search');
    if (!linkInput) return;

    const urlText = linkInput.value.trim();
    if (!urlText.startsWith('http://') && !urlText.startsWith('https://')) {
        showToast('אנא הזן קישור תקין של Google Maps', 'error');
        return;
    }

    showToast('מפענח את הקישור...', 'info');

    try {
        let longUrl = urlText;

        // Resolve short url
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

        let lat = null;
        let lng = null;
        let queryName = null;

        // Extract Coordinates
        const atCoordsMatch = longUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (atCoordsMatch) {
            lat = parseFloat(atCoordsMatch[1]);
            lng = parseFloat(atCoordsMatch[2]);
        }

        const placeSegmentMatch = longUrl.match(/\/place\/([^/]+)/);
        if (placeSegmentMatch) {
            try {
                const rawSegment = placeSegmentMatch[1];
                queryName = decodeURIComponent(rawSegment.replace(/\+/g, ' '));
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

        document.getElementById('place-google-url').value = urlText;

        if (queryName) {
            const service = new google.maps.places.PlacesService(document.createElement('div'));
            service.findPlaceFromQuery({
                query: queryName,
                fields: ['name', 'geometry', 'formatted_address']
            }, (results, status) => {
                if (status === 'OK' && results[0]) {
                    const place = results[0];
                    const placeLat = place.geometry.location.lat();
                    const placeLng = place.geometry.location.lng();

                    document.getElementById('place-name').value = place.name;
                    document.getElementById('place-description').value = place.formatted_address || '';
                    document.getElementById('place-lat').value = placeLat.toFixed(6);
                    document.getElementById('place-lng').value = placeLng.toFixed(6);

                    if (window.miniMap) {
                        window.miniMap.setCenter({ lat: placeLat, lng: placeLng });
                        if (window.miniMapMarker) {
                            window.miniMapMarker.setPosition({ lat: placeLat, lng: placeLng });
                        }
                    }

                    showToast('המיקום נטען בהצלחה!', 'success');
                    linkInput.value = '';
                } else {
                    if (lat && lng) {
                        reverseGeocodeCoords(lat, lng, (address) => {
                            document.getElementById('place-name').value = queryName;
                            document.getElementById('place-description').value = address;
                            document.getElementById('place-lat').value = lat.toFixed(6);
                            document.getElementById('place-lng').value = lng.toFixed(6);
                            showToast('המיקום נטען לפי קואורדינטות', 'success');
                            linkInput.value = '';
                        });
                    } else {
                        showToast(`לא נמצאו תוצאות בגוגל עבור "${queryName}"`, 'error');
                    }
                }
            });
        } else if (lat && lng) {
            reverseGeocodeCoords(lat, lng, (address) => {
                document.getElementById('place-name').value = address;
                document.getElementById('place-lat').value = lat.toFixed(6);
                document.getElementById('place-lng').value = lng.toFixed(6);
                showToast('המיקום נטען בהצלחה!', 'success');
                linkInput.value = '';
            });
        }
    } catch (error) {
        showToast(`שגיאה בפענוח הקישור: ${error.message}`, 'error');
    }
}

// ============= Backup Modal Operations =============
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
            itineraries: itineraries || []
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

            if (!data || !Array.isArray(data.places) || !Array.isArray(data.groups)) {
                throw new Error("קובץ גיבוי לא תקין. חסרים נתוני מיקומים או קבוצות.");
            }

            statusDiv.textContent = 'מייבא נתונים ומסנכרן לענן...';

            setPlaces(data.places);
            setGroups(data.groups);

            if (Array.isArray(data.itineraries)) {
                localStorage.setItem('mytravel-itineraries', JSON.stringify(data.itineraries));
            }

            localStorage.setItem(STORAGE_KEY, JSON.stringify(places));
            localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));

            if (window.IS_FIREBASE_CONFIGURED && window.db) {
                const promises = [];

                groups.forEach(g => {
                    promises.push(window.db.collection('groups').doc(g.id).set(g));
                });

                places.forEach(p => {
                    promises.push(window.db.collection('places').doc(p.id).set(p));
                });

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

// ============= Init Autocomplete (Google Maps Search) =============
function initAutocomplete() {
    const input = document.getElementById('place-search');
    if (!input) return;

    const autocomplete = new google.maps.places.Autocomplete(input, {
        fields: ['name', 'geometry', 'formatted_address', 'photos', 'rating', 'user_ratings_total', 'website', 'url']
    });

    autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (!place.geometry || !place.geometry.location) {
            // Check if user entered a raw Google Maps URL
            const val = input.value.trim();
            if (val.startsWith('http://') || val.startsWith('https://')) {
                handleGmapsLinkImport();
            } else {
                showToast('נא לבחור מקום מהרשימה', 'error');
            }
            return;
        }

        const latVal = place.geometry.location.lat();
        const lngVal = place.geometry.location.lng();

        document.getElementById('place-name').value = place.name || '';
        document.getElementById('place-description').value = place.formatted_address || '';
        document.getElementById('place-lat').value = latVal.toFixed(6);
        document.getElementById('place-lng').value = lngVal.toFixed(6);
        document.getElementById('place-google-url').value = place.url || '';

        // Add Google Place Photo if exists
        if (place.photos && place.photos.length > 0) {
            const photoUrl = place.photos[0].getUrl({ maxWidth: 600, maxHeight: 400 });
            setPendingImages([photoUrl]);
            renderImagePreviews();
        }

        if (window.miniMap) {
            window.miniMap.setCenter({ lat: latVal, lng: lngVal });
            if (window.miniMapMarker) {
                window.miniMapMarker.setPosition({ lat: latVal, lng: lngVal });
            }
        }
    });
}

// ============= Panels Resize (Split view resizing handles) =============
function initResizablePanels() {
    const placesPanel = document.getElementById('places-panel');
    const itineraryPanel = document.getElementById('itinerary-panel');
    const divider = document.getElementById('resize-divider');
    const mapPanel = document.getElementById('map-panel');
    const itinMapDivider = document.getElementById('itin-map-divider');

    if (!divider || !placesPanel || !mapPanel) return;

    let isResizing = false;

    divider.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const containerWidth = document.querySelector('.app-container').getBoundingClientRect().width;
        let percentage = (e.clientX / containerWidth) * 100;

        // Boundaries
        if (percentage < 15) percentage = 15;
        if (percentage > 70) percentage = 70;

        placesPanel.style.width = `${percentage}%`;

        // If itinerary panel is visible, share remaining space
        const itinVisible = itineraryPanel && itineraryPanel.style.display !== 'none';
        if (itinVisible) {
            const remaining = 100 - percentage;
            mapPanel.style.width = `${remaining / 2}%`;
            itineraryPanel.style.width = `${remaining / 2}%`;
        } else {
            mapPanel.style.width = `${100 - percentage}%`;
        }

        if (typeof google !== 'undefined' && google.maps && map) {
            google.maps.event.trigger(map, 'resize');
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });

    // Divider for Itinerary <-> Map panel resize
    if (itinMapDivider && itineraryPanel) {
        let isItinResizing = false;
        itinMapDivider.addEventListener('mousedown', () => {
            isItinResizing = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isItinResizing) return;
            const containerWidth = document.querySelector('.app-container').getBoundingClientRect().width;

            // Calculate width of places panel (fixed)
            const placesWidthPx = placesPanel.getBoundingClientRect().width;
            const remainingWidthPx = containerWidth - placesWidthPx;

            const mouseOffsetFromLeft = e.clientX - placesWidthPx;
            let mapPercentageOfRemaining = (mouseOffsetFromLeft / remainingWidthPx) * 100;

            if (mapPercentageOfRemaining < 20) mapPercentageOfRemaining = 20;
            if (mapPercentageOfRemaining > 80) mapPercentageOfRemaining = 80;

            mapPanel.style.width = `${(mapPercentageOfRemaining / 100) * (remainingWidthPx / containerWidth) * 100}%`;
            itineraryPanel.style.width = `${((100 - mapPercentageOfRemaining) / 100) * (remainingWidthPx / containerWidth) * 100}%`;

            if (typeof google !== 'undefined' && google.maps && map) {
                google.maps.event.trigger(map, 'resize');
            }
        });

        document.addEventListener('mouseup', () => {
            if (isItinResizing) {
                isItinResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    }
}

// ============= Horizontal Drag Scroll =============
function initHorizontalDragScroll(container) {
    if (!container) return;

    let isDown = false;
    let startX;
    let scrollLeft;

    container.addEventListener('mousedown', (e) => {
        isDown = true;
        startX = e.pageX - container.offsetLeft;
        scrollLeft = container.scrollLeft;
    });
    container.addEventListener('mouseleave', () => {
        isDown = false;
    });
    container.addEventListener('mouseup', () => {
        isDown = false;
    });
    container.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - container.offsetLeft;
        const walk = (x - startX) * 2; // scroll-fast
        container.scrollLeft = scrollLeft - walk;
    });
}

// ============= Init Events =============
function initEvents() {
    initAdminEvents();
    initOfflineEvents();
    const searchInput = document.getElementById('search-places-input');
    if (searchInput) {
        const debouncedSearch = debounce((value) => {
            setSearchQuery(value);
            renderPlaces();
        }, 300);
        searchInput.addEventListener('input', (e) => {
            debouncedSearch(e.target.value);
        });
    }

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

    const btnOpenGuide = document.getElementById('btn-open-guide');
    const btnCloseGuide = document.getElementById('user-guide-modal-close');
    const guideModalOverlay = document.getElementById('user-guide-modal-overlay');

    if (btnOpenGuide && guideModalOverlay) {
        btnOpenGuide.addEventListener('click', () => {
            guideModalOverlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        });
    }

    if (btnCloseGuide && guideModalOverlay) {
        btnCloseGuide.addEventListener('click', () => {
            guideModalOverlay.classList.remove('active');
            document.body.style.overflow = '';
        });
    }

    if (guideModalOverlay) {
        guideModalOverlay.addEventListener('click', (e) => {
            if (e.target === guideModalOverlay) {
                guideModalOverlay.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    }

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
        if (map) {
            setTimeout(() => {
                google.maps.event.trigger(map, 'resize');
            }, 50);
        }
    };

    btnTogglePlaces?.addEventListener('click', togglePlacesPanel);
    btnClosePlaces?.addEventListener('click', togglePlacesPanel);

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

    const btnLayout = document.getElementById('btn-layout-selector');
    const layoutDropdown = document.getElementById('layout-dropdown');

    if (btnLayout && layoutDropdown) {
        btnLayout.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = layoutDropdown.style.display === 'flex';
            if (!isVisible) {
                layoutDropdown.style.display = 'flex';
                const rect = btnLayout.getBoundingClientRect();
                const dropdownWidth = layoutDropdown.offsetWidth || 260;
                const screenWidth = window.innerWidth;

                layoutDropdown.style.top = `${rect.bottom + 8}px`;

                // Calculate smart positioning for RTL & LTR boundaries
                if (rect.right - dropdownWidth < 10) {
                    // Overflowing left side of screen: align to left
                    layoutDropdown.style.left = `${Math.max(10, rect.left)}px`;
                    layoutDropdown.style.right = 'auto';
                } else if (screenWidth - rect.right < 10) {
                    // Overflowing right side of screen: align to 10px from right edge
                    layoutDropdown.style.right = '10px';
                    layoutDropdown.style.left = 'auto';
                } else {
                    // Standard alignment to button right edge
                    layoutDropdown.style.right = `${screenWidth - rect.right}px`;
                    layoutDropdown.style.left = 'auto';
                }
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

        container.classList.remove('layout-cols', 'layout-map-left', 'layout-map-right');
        container.classList.add(`layout-${layout}`);
        localStorage.setItem('mytravel-app-layout', layout);

        layoutDropdown?.querySelectorAll('.layout-dropdown-item').forEach(i => {
            if (i.dataset.layout === layout) {
                i.classList.add('active');
            } else {
                i.classList.remove('active');
            }
        });

        if (map) {
            setTimeout(() => {
                google.maps.event.trigger(map, 'resize');
            }, 100);
        }
    }

    const savedLayout = localStorage.getItem('mytravel-app-layout') || 'cols';
    setLayout(savedLayout);

    document.getElementById('btn-add-place').addEventListener('click', () => {
        openModal('add');
    });

    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('btn-cancel').addEventListener('click', closeModal);
    document.getElementById('btn-save').addEventListener('click', savePlace);

    const useCustomColorCheckbox = document.getElementById('place-use-custom-color');
    const customColorInput = document.getElementById('place-custom-color');
    if (useCustomColorCheckbox && customColorInput) {
        useCustomColorCheckbox.addEventListener('change', () => {
            customColorInput.style.display = useCustomColorCheckbox.checked ? 'inline-block' : 'none';
        });
    }

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
            setPendingGpxData(points);

            const hasEle = points && points.length > 0 && points.some(pt => pt.ele !== undefined && pt.ele !== null);
            const eleMsg = hasEle ? "מכיל נתוני גובה" : "ללא נתוני גובה";

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
        setPendingGpxData(null);
        document.getElementById('gpx-input').value = '';
        document.getElementById('gpx-status').textContent = 'לא נבחר מסלול';
        document.getElementById('btn-remove-gpx').style.display = 'none';
        showToast('קובץ GPX הוסר', 'info');
    });

    document.getElementById('upload-zone').addEventListener('click', () => {
        document.getElementById('image-input').click();
    });

    document.getElementById('btn-choose-files')?.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('image-input').click();
    });

    document.getElementById('image-input').addEventListener('change', (e) => {
        handleImageUpload(e.target.files);
        e.target.value = '';
    });

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

    document.getElementById('btn-add-link').addEventListener('click', () => {
        addLinkInput('', 'wikipedia');
    });

    document.getElementById('confirm-cancel').addEventListener('click', () => {
        document.getElementById('confirm-overlay').classList.remove('active');
        setDeleteTargetId(null);
    });
    document.getElementById('confirm-delete').addEventListener('click', executeDelete);
    document.getElementById('confirm-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            e.currentTarget.classList.remove('active');
            setDeleteTargetId(null);
        }
    });

    document.getElementById('view-list').addEventListener('click', function() {
        document.getElementById('view-list').classList.add('active');
        document.getElementById('view-map').classList.remove('active');

        const pPanel = document.getElementById('places-panel');
        const d = document.getElementById('resize-divider');
        const mPanel = document.getElementById('map-panel');

        pPanel.style.display = '';
        d.style.display = '';
        mPanel.style.width = mPanel.dataset.prevWidth || '55%';

        if (typeof google !== 'undefined' && google.maps && map) {
            setTimeout(() => google.maps.event.trigger(map, 'resize'), 50);
        }
    });

    document.getElementById('view-map').addEventListener('click', function() {
        document.getElementById('view-map').classList.add('active');
        document.getElementById('view-list').classList.remove('active');

        const pPanel = document.getElementById('places-panel');
        const d = document.getElementById('resize-divider');
        const mPanel = document.getElementById('map-panel');

        pPanel.style.display = 'none';
        d.style.display = 'none';
        mPanel.dataset.prevWidth = mPanel.style.width || '55%';
        mPanel.style.width = '100%';

        if (typeof google !== 'undefined' && google.maps && map) {
            setTimeout(() => google.maps.event.trigger(map, 'resize'), 50);
        }
    });

    const tabList = document.getElementById('mobile-tab-list');
    const tabMap = document.getElementById('mobile-tab-map');
    const tabItinerary = document.getElementById('mobile-tab-itinerary');

    function setMobileTab(activeTab) {
        document.body.classList.remove('mobile-view-list', 'mobile-view-map', 'mobile-view-itinerary');
        if (tabList) tabList.classList.remove('active');
        if (tabMap) tabMap.classList.remove('active');
        if (tabItinerary) tabItinerary.classList.remove('active');

        const itinPanel = document.getElementById('itinerary-panel');

        if (activeTab === 'list') {
            document.body.classList.add('mobile-view-list');
            if (tabList) tabList.add('active');
            if (itinPanel) itinPanel.style.display = 'none';
        } else if (activeTab === 'map') {
            document.body.classList.add('mobile-view-map');
            if (tabMap) tabMap.classList.add('active');
            if (itinPanel) itinPanel.style.display = 'none';
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
    window.switchToMobileMapTab = () => setMobileTab('map');

    if (tabList) {
        tabList.addEventListener('click', () => setMobileTab('list'));
    }
    if (tabMap) {
        tabMap.addEventListener('click', () => setMobileTab('map'));
    }
    if (tabItinerary) {
        tabItinerary.addEventListener('click', () => setMobileTab('itinerary'));
    }

    document.getElementById('google-place-close').addEventListener('click', closeGooglePlacePanel);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
            closeGroupsModal();
            closeGooglePlacePanel();
            document.getElementById('confirm-overlay').classList.remove('active');
            const lightbox = document.getElementById('lightbox-overlay');
            if (lightbox) lightbox.classList.remove('active');
        }
    });

    document.getElementById('btn-manage-groups').addEventListener('click', openGroupsModal);
    document.getElementById('groups-modal-close').addEventListener('click', closeGroupsModal);
    document.getElementById('groups-modal-done').addEventListener('click', closeGroupsModal);
    document.getElementById('groups-modal-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeGroupsModal();
    });

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

    document.getElementById('new-group-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('btn-create-group').click();
        }
    });

    document.getElementById('color-picker').addEventListener('click', (e) => {
        const option = e.target.closest('.color-option');
        if (!option) return;
        document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
    });

    document.getElementById('btn-new-group-inline').addEventListener('click', () => {
        const name = prompt('שם קבוצה חדשה:');
        if (name && name.trim()) {
            const group = addGroup(name.trim(), '#2C4E72');
            document.getElementById('place-group').value = group.id;
            showToast(`הקבוצה "${name}" נוצרה!`, 'success');
        }
    });

    document.getElementById('btn-backup').addEventListener('click', openBackupModal);
    document.getElementById('btn-close-backup-modal').addEventListener('click', closeBackupModal);
    document.getElementById('btn-export-backup').addEventListener('click', exportBackup);
    document.getElementById('btn-trigger-import').addEventListener('click', () => {
        document.getElementById('import-file-input').click();
    });
    document.getElementById('import-file-input').addEventListener('change', importBackup);

    document.getElementById('backup-modal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('backup-modal')) {
            closeBackupModal();
        }
    });

    const logoImg = document.querySelector('.logo-img');
    if (logoImg) {
        logoImg.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            logoImg.classList.toggle('zoomed');
        });

        document.addEventListener('click', () => {
            if (logoImg.classList.contains('zoomed')) {
                logoImg.classList.remove('zoomed');
            }
        });
    }

    const startBtn = document.getElementById('btn-start-app');
    const splash = document.getElementById('splash-screen');
    if (startBtn && splash) {
        startBtn.addEventListener('click', () => {
            splash.classList.add('hide');
            setTimeout(() => splash.remove(), 800);
        });
    }

    const loadGmapsLinkBtn = document.getElementById('btn-load-gmaps-link');
    if (loadGmapsLinkBtn) {
        loadGmapsLinkBtn.addEventListener('click', handleGmapsLinkImport);
    }

    const roadbookModal = document.getElementById('roadbook-modal');
    if (roadbookModal) {
        document.getElementById('btn-close-roadbook-modal').addEventListener('click', () => {
            if (typeof closeRoadbookModal === 'function') closeRoadbookModal();
        });
        document.getElementById('btn-print-roadbook').addEventListener('click', () => {
            window.print();
        });

        document.getElementById('btn-export-roadbook-csv').addEventListener('click', () => {
            const activeRoadbook = roadbookModal.$activeRoadbook;
            const activePlace = roadbookModal.$activePlace;
            if (activeRoadbook && activePlace) {
                downloadRoadbookCsv(activeRoadbook, activePlace);
            }
        });

        roadbookModal.addEventListener('click', (e) => {
            if (e.target === roadbookModal) {
                if (typeof closeRoadbookModal === 'function') closeRoadbookModal();
            }
        });
    }

    // Lightbox Modal Close event
    const lightboxOverlay = document.getElementById('lightbox-overlay');
    if (lightboxOverlay) {
        lightboxOverlay.addEventListener('click', () => {
            lightboxOverlay.classList.remove('active');
            document.body.style.overflow = '';
        });
    }
}

// ============= Initialize Application =============
function init() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => {
                    console.log('[Service Worker] Registered successfully:', reg.scope);

                    reg.addEventListener('updatefound', () => {
                        const newWorker = reg.installing;
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
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

    document.body.classList.add('mobile-view-list');

    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
    loadGroups(renderGroupTabs, renderGroupSelect, renderGroupParentSelect);
    loadPlaces(renderPlaces, renderMarkers, drawAllGpxTracks);

    const hasGoogle = (typeof google !== 'undefined' && google.maps);
    if (hasGoogle) {
        initMap();
        initAutocomplete();
    } else {
        console.warn("Google Maps is not loaded. Switching to offline map mode.");
        setIsOfflineMode(true);
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
        setTimeout(() => {
            syncLeafletView();
        }, 200);
    }

    initEvents();
    initResizablePanels();
    initItinerary();

    const groupsScroll = document.querySelector('.groups-scroll');
    const subGroupsScroll = document.getElementById('sub-groups-scroll');
    initHorizontalDragScroll(groupsScroll);
    initHorizontalDragScroll(subGroupsScroll);

    if (typeof window.IS_FIREBASE_CONFIGURED !== 'undefined' && !window.IS_FIREBASE_CONFIGURED) {
        console.log('%c🌍 Bialik\'s Travels: משתמש ב-localStorage. לגיבוי בענן, הגדר Firebase ב-firebase-config.js', 'color: #2C4E72; font-size: 14px; font-weight: bold;');
    }

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

                if (hasGoogle && map) {
                    const marker = markers?.find(m => m.placeId === sharedPlaceId);
                    if (marker) {
                        google.maps.event.trigger(marker, 'click');
                    }
                }
            }
        }, 800);
    }

    if (typeof window.checkAdminMode === 'function') {
        window.checkAdminMode();
    }
}

// Start Application
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
