import {
    places, setPlaces,
    groups, setGroups,
    itineraries, setItineraries,
    savePlaces, saveGroups,
    STORAGE_KEY, GROUPS_KEY, DEMO_PLACES, DEFAULT_GROUPS,
    debounce
} from './state.js';

// Global error logger for Firebase connectivity/permission issues
export function logFirebaseError(message, error) {
    console.error(message, error);
    if (error && (error.code === 'permission-denied' || error.message.includes('permission'))) {
        console.warn("Firebase permissions error. Using local storage fallback.");
    }
}

// ============= Places Firebase Operations =============
export function loadPlaces(renderPlaces, renderMarkers, drawAllGpxTracks) {
    if (window.IS_FIREBASE_CONFIGURED && window.db) {
        window.db.collection('places').onSnapshot(snapshot => {
            if (snapshot.empty) {
                // Check if we have them in localStorage
                const stored = localStorage.getItem(STORAGE_KEY);
                if (stored) {
                    setPlaces(JSON.parse(stored));
                    places.forEach(p => {
                        window.db.collection('places').doc(p.id).set(p);
                    });
                } else {
                    setPlaces([...DEMO_PLACES]);
                    places.forEach(p => {
                        window.db.collection('places').doc(p.id).set(p);
                    });
                }
            } else {
                setPlaces(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            }
            savePlaces();
            if (typeof renderPlaces === 'function') renderPlaces();
            if (typeof renderMarkers === 'function') renderMarkers();
            if (typeof drawAllGpxTracks === 'function') drawAllGpxTracks();
        }, err => {
            logFirebaseError("Error loading places from Firebase:", err);
            loadPlacesFromLocalStorageOnly(renderPlaces, renderMarkers, drawAllGpxTracks);
        });
    } else {
        loadPlacesFromLocalStorageOnly(renderPlaces, renderMarkers, drawAllGpxTracks);
    }
}

function loadPlacesFromLocalStorageOnly(renderPlaces, renderMarkers, drawAllGpxTracks) {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        setPlaces(JSON.parse(stored));
    } else {
        setPlaces([...DEMO_PLACES]);
        savePlaces();
    }
    if (typeof renderPlaces === 'function') renderPlaces();
    if (typeof renderMarkers === 'function') renderMarkers();
    if (typeof drawAllGpxTracks === 'function') drawAllGpxTracks();
}

export function syncPlaceToFirebase(place) {
    if (window.IS_FIREBASE_CONFIGURED && window.db && place && place.id) {
        window.db.collection('places').doc(place.id).set(place)
            .catch(err => console.error("Error syncing place to Firebase:", err));
    }
}

export function deletePlaceFromFirebase(placeId) {
    if (window.IS_FIREBASE_CONFIGURED && window.db && placeId) {
        window.db.collection('places').doc(placeId).delete()
            .catch(err => console.error("Error deleting place from Firebase:", err));
    }
}

// ============= Groups Firebase Operations =============
export function loadGroups(renderGroupTabs, renderGroupSelect, renderGroupParentSelect) {
    if (window.IS_FIREBASE_CONFIGURED && window.db) {
        window.db.collection('groups').onSnapshot(snapshot => {
            if (snapshot.empty) {
                const stored = localStorage.getItem(GROUPS_KEY);
                if (stored) {
                    setGroups(JSON.parse(stored));
                } else {
                    setGroups([...DEFAULT_GROUPS]);
                }
                groups.forEach(g => {
                    window.db.collection('groups').doc(g.id).set(g);
                });
            } else {
                setGroups(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            }
            localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
            if (typeof renderGroupTabs === 'function') renderGroupTabs();
            if (typeof renderGroupSelect === 'function') renderGroupSelect();
            if (typeof renderGroupParentSelect === 'function') renderGroupParentSelect();
        }, err => {
            logFirebaseError("Error loading groups from Firebase:", err);
            loadGroupsFromLocalStorageOnly(renderGroupTabs, renderGroupSelect, renderGroupParentSelect);
        });
    } else {
        loadGroupsFromLocalStorageOnly(renderGroupTabs, renderGroupSelect, renderGroupParentSelect);
    }
}

function loadGroupsFromLocalStorageOnly(renderGroupTabs, renderGroupSelect, renderGroupParentSelect) {
    const stored = localStorage.getItem(GROUPS_KEY);
    if (stored) {
        setGroups(JSON.parse(stored));
    } else {
        setGroups([...DEFAULT_GROUPS]);
        saveGroups();
    }
    if (typeof renderGroupTabs === 'function') renderGroupTabs();
    if (typeof renderGroupSelect === 'function') renderGroupSelect();
    if (typeof renderGroupParentSelect === 'function') renderGroupParentSelect();
}

// ============= Firebase Storage Operations =============
export async function uploadPendingImages(placeId, pendingImagesList) {
    if (!window.IS_FIREBASE_CONFIGURED || !window.storage || !pendingImagesList) {
        return pendingImagesList || [];
    }

    const uploadPromises = pendingImagesList.map(async (img, idx) => {
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

// ============= Backup & Restore Operations =============
export function exportBackupData(itineraryList = []) {
    try {
        const backupData = {
            places: places,
            groups: groups,
            itineraries: itineraryList.length > 0 ? itineraryList : itineraries,
            exportVersion: "2.0",
            exportedAt: new Date().toISOString()
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
        
        if (window.showToast) window.showToast("הגיבוי יוצא בהצלחה!", "success");
    } catch (e) {
        console.error("Backup export failed:", e);
        if (window.showToast) window.showToast("ייצוא הגיבוי נכשל", "error");
    }
}

export function importBackupData(file, statusDiv, finalizeImportCallback, finalizeImportLocalCallback) {
    if (!file) return;

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
            setPlaces(data.places);
            setGroups(data.groups);
            
            if (Array.isArray(data.itineraries)) {
                setItineraries(data.itineraries);
                localStorage.setItem('mytravel-itineraries', JSON.stringify(data.itineraries));
            }
            
            // Save to LocalStorage
            savePlaces();
            saveGroups();
            
            // Sync to Firebase Firestore if configured
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
                    if (typeof finalizeImportCallback === 'function') finalizeImportCallback(statusDiv);
                }).catch(err => {
                    console.error("Sync failed during import:", err);
                    statusDiv.style.color = '#EF4444';
                    statusDiv.textContent = 'הייבוא הושלם מקומית אך הסנכרון לענן נכשל.';
                    if (typeof finalizeImportLocalCallback === 'function') finalizeImportLocalCallback();
                });
            } else {
                if (typeof finalizeImportCallback === 'function') finalizeImportCallback(statusDiv);
            }
        } catch (err) {
            console.error("Backup import failed:", err);
            statusDiv.style.color = '#EF4444';
            statusDiv.textContent = err.message || "פענוח הקובץ נכשל.";
            if (window.showToast) window.showToast("ייצוא הגיבוי נכשל", "error");
        }
    };
    reader.readAsText(file);
}
