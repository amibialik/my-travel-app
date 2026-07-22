import {
    places, setPlaces,
    groups, setGroups,
    activeGroupId, setActiveGroupId,
    activeSubGroupId, setActiveSubGroupId,
    editingPlaceId, setEditingPlaceId,
    pendingImages, setPendingImages,
    deleteTargetId, setDeleteTargetId,
    activeMarkerId, setActiveMarkerId,
    pendingGpxData, setPendingGpxData,
    searchQuery, setSearchQuery,
    savePlaces, saveGroups,
    getFilteredPlaces, getGroupById, getGroupPlaceCount,
    generateId, generateGroupId,
    DEFAULT_CENTER, DEFAULT_ZOOM,
    map
} from './state.js';

import {
    renderMarkers,
    drawAllGpxTracks,
    fitMapBounds,
    panToPlace,
    toggleOfflineMode,
    syncLeafletView,
    deleteSavedMap,
    getTilesForTrack,
    downloadOfflineTiles
} from './map.js';

import {
    renderElevationChart
} from './elevation.js';

import {
    syncPlaceToFirebase,
    deletePlaceFromFirebase,
    uploadPendingImages,
    importBackupData,
    exportBackupData
} from './db.js';

import {
    openMeasurementControlBar,
    loadRoadbookToEditor,
    deleteRoadbook,
    openRoadbookModal
} from './roadbook.js';

// ============= Toast Notifications =============
export function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    const toastIcon = document.getElementById('toast-icon');

    if (toast && toastMessage && toastIcon) {
        toastMessage.textContent = message;
        toastIcon.className = 'fas ';
        if (type === 'success') toastIcon.className += 'fa-check-circle';
        else if (type === 'error') toastIcon.className += 'fa-exclamation-circle';
        else if (type === 'warning') toastIcon.className += 'fa-exclamation-triangle';
        else toastIcon.className += 'fa-info-circle';

        toast.className = `toast toast-${type} active`;
        if (window.toastTimeout) clearTimeout(window.toastTimeout);
        window.toastTimeout = setTimeout(() => {
            toast.classList.remove('active');
        }, 3000);
        return;
    }

    const container = document.getElementById('toast-container');
    if (!container) return;

    const toastEl = document.createElement('div');
    toastEl.className = `toast toast-${type}`;

    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-check-circle';
    if (type === 'error') icon = 'fa-exclamation-circle';
    if (type === 'warning') icon = 'fa-exclamation-triangle';

    toastEl.innerHTML = `<i class="fas ${icon}"></i> <span>${escapeHtml(message)}</span>`;
    container.appendChild(toastEl);

    setTimeout(() => {
        toastEl.classList.add('active');
    }, 10);

    setTimeout(() => {
        toastEl.classList.remove('active');
        setTimeout(() => toastEl.remove(), 400);
    }, 3000);
}

// ============= Helper Functions =============
export function escapeHtml(str) {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function getPoiEmoji(type) {
    if (type === 'water') return '💧';
    if (type === 'camp') return '🏕️';
    if (type === 'view') return '🌅';
    if (type === 'danger') return '⚠️';
    return '📍';
}

export function getPoiLabel(type) {
    if (type === 'water') return 'נקודת מים / מילוי';
    if (type === 'camp') return 'חניון לילה';
    if (type === 'view') return 'נקודת תצפית / מנוחה';
    if (type === 'danger') return 'סכנה / מעבר קשה';
    return 'נקודת עניין';
}

export function getPlaceColor(place) {
    if (place.useCustomColor && place.customColor) {
        return place.customColor;
    }
    const group = getGroupById(place.groupId);
    return group ? group.color : '#2C4E72';
}

export function getLinkIcon(type) {
    if (type === 'wikipedia') return 'fab fa-wikipedia-w';
    if (type === 'youtube') return 'fab fa-youtube';
    if (type === 'facebook') return 'fab fa-facebook';
    if (type === 'instagram') return 'fab fa-instagram';
    if (type === 'trail_website') return 'fas fa-globe';
    return 'fas fa-link';
}

// ============= Group Rendering & Selection =============
export function renderGroupTabs() {
    const mainContainer = document.querySelector('.groups-scroll');
    const subContainer = document.getElementById('sub-groups-scroll');
    const subBar = document.getElementById('sub-groups-bar');
    if (!mainContainer) return;

    // Filter main (parent) groups
    const mainGroups = groups.filter(g => !g.parentId);
    mainGroups.sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));

    // Render Main Groups
    let mainHtml = `
        <button class="group-tab ${activeGroupId === 'all' ? 'active' : ''}" data-group-id="all">
            <i class="fas fa-globe-americas"></i> <span>הכל</span> <span class="group-count">${places.length}</span>
        </button>
    `;

    mainGroups.forEach(g => {
        const placeCount = getGroupPlaceCount(g.id);
        const childGroupIds = groups.filter(sub => sub.parentId === g.id).map(sub => sub.id);
        const totalCount = placeCount + places.filter(p => childGroupIds.includes(p.groupId)).length;

        const isSelected = activeGroupId === g.id;

        mainHtml += `
            <button class="group-tab ${isSelected ? 'active' : ''}" data-group-id="${g.id}" style="${isSelected ? `background:${g.color}; border-color:${g.color}; box-shadow:0 2px 8px ${g.color}40;` : ''}">
                <span class="group-tab-dot" style="background-color:${g.color}"></span>
                <span>${escapeHtml(g.name)}</span>
                <span class="group-count">${totalCount}</span>
            </button>
        `;
    });

    mainContainer.innerHTML = mainHtml;

    // Main group tabs event listeners
    mainContainer.querySelectorAll('.group-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const grpId = tab.dataset.groupId;
            setActiveGroup(grpId);
        });
    });

    // Render Sub-groups (Treks)
    if (subContainer && subBar) {
        if (activeGroupId === 'all') {
            subBar.style.display = 'none';
        } else {
            const subGroupsList = groups.filter(g => g.parentId === activeGroupId);
            subGroupsList.sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));

            if (subGroupsList.length === 0) {
                subBar.style.display = 'none';
            } else {
                subBar.style.display = 'flex';

                let subHtml = `
                    <button class="sub-group-tab ${activeSubGroupId === 'all' ? 'active' : ''}" data-sub-group-id="all">
                        <span>כל המסלולים</span>
                    </button>
                `;

                subGroupsList.forEach(sub => {
                    const subPlaceCount = getGroupPlaceCount(sub.id);
                    const isSubSelected = activeSubGroupId === sub.id;
                    subHtml += `
                        <button class="sub-group-tab ${isSubSelected ? 'active' : ''}" data-sub-group-id="${sub.id}">
                            <span>${escapeHtml(sub.name)}</span>
                            <span class="sub-group-count">${subPlaceCount}</span>
                        </button>
                    `;
                });

                subContainer.innerHTML = subHtml;

                // Sub-groups tabs event listeners
                subContainer.querySelectorAll('.sub-group-tab').forEach(tab => {
                    tab.addEventListener('click', () => {
                        const subId = tab.dataset.subGroupId;
                        setActiveSubGroup(subId);
                    });
                });
            }
        }
    }
}

export function setActiveGroup(groupId) {
    setActiveGroupId(groupId);
    setActiveSubGroupId('all');
    renderGroupTabs();
    renderPlaces();
    renderMarkers();
    fitMapBounds();
    drawAllGpxTracks();
    if (isOfflineMode) {
        syncLeafletView();
    }
}

export function setActiveSubGroup(subGroupId) {
    setActiveSubGroupId(subGroupId);
    renderGroupTabs();
    renderPlaces();
    renderMarkers();
    fitMapBounds();
    drawAllGpxTracks();
    if (isOfflineMode) {
        syncLeafletView();
    }
}

export function renderGroupSelect() {
    const select = document.getElementById('place-group');
    if (!select) return;

    let html = '<option value="">ללא קבוצה</option>';

    // Parent groups (Countries)
    const parents = groups.filter(g => !g.parentId);
    parents.forEach(p => {
        html += `<option value="${p.id}" style="font-weight:bold; color:${p.color};">${escapeHtml(p.name)} (מדינה)</option>`;

        // Children (Treks)
        const children = groups.filter(g => g.parentId === p.id);
        children.forEach(c => {
            html += `<option value="${c.id}" style="color:${p.color};">&nbsp;&nbsp;&nbsp;&nbsp;➔ ${escapeHtml(c.name)} (טרק)</option>`;
        });
    });

    select.innerHTML = html;
}

export function renderGroupParentSelect() {
    const select = document.getElementById('group-parent');
    if (!select) return;

    let html = '<option value="">ללא הורה (מדינה עצמאית)</option>';
    const parents = groups.filter(g => !g.parentId);
    parents.forEach(p => {
        html += `<option value="${p.id}">${escapeHtml(p.name)}</option>`;
    });

    select.innerHTML = html;
}

// ============= Places Rendering =============
export function renderPlaces() {
    const list = document.getElementById('places-list');
    const emptyState = document.getElementById('empty-state');
    const count = document.getElementById('places-count');
    if (!list || !emptyState || !count) return;

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

    const isParentGroup = activeGroupId !== 'all' && !getGroupById(activeGroupId)?.parentId;
    const subGroups = activeGroupId !== 'all' ? groups.filter(g => g.parentId === activeGroupId) : [];
    const hasSubGroups = subGroups.length > 0;

    list.innerHTML = '';

    if (!isSearchActive && isParentGroup && activeSubGroupId === 'all' && hasSubGroups) {
        emptyState.style.display = 'none';
        list.style.display = 'flex';

        // Render Trek Cards first
        subGroups.forEach((sub, subIdx) => {
            const trekCard = createTrekCard(sub, subIdx);
            list.appendChild(trekCard);
        });

        // Render standalone places
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

    if (typeof Sortable !== 'undefined' && list) {
        new Sortable(list, {
            animation: 150,
            handle: '.drag-handle',
            draggable: '.place-card',
            ghostClass: 'sortable-ghost',
            onEnd: (evt) => {
                const cards = list.querySelectorAll('.place-card[data-id]');
                const newOrder = Array.from(cards).map(card => card.dataset.id);
                newOrder.forEach((id, idx) => {
                    const place = places.find(p => p.id === id);
                    if (place) {
                        place.sortOrder = idx;
                        syncPlaceToFirebase(place);
                    }
                });
                savePlaces();
                renderMarkers();
                drawAllGpxTracks();
            }
        });
    }
}

export function createTrekCard(trek, index) {
    const card = document.createElement('div');
    card.className = 'place-card trek-card';
    card.style.animationDelay = `${index * 0.08}s`;
    card.style.borderRightColor = trek.color;

    card.innerHTML = `
        <div class="card-header" style="padding-bottom:12px;">
            <div class="card-number" style="background:${trek.color}20; color:${trek.color}; border-color:${trek.color};"><i class="fas fa-hiking"></i></div>
            <div class="card-title-section">
                <div class="card-title" style="font-size:16px; font-weight:bold;">${escapeHtml(trek.name)}</div>
                <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">
                    <i class="fas fa-map-pin"></i> ${getGroupPlaceCount(trek.id)} מקומות שמורים
                </div>
            </div>
            <div class="card-actions">
                <button type="button" class="card-action-btn enter-trek-btn" style="background:var(--primary); color:white; border:none; padding:4px 10px; border-radius:4px; font-size:11.5px; font-weight:bold; cursor:pointer; font-family:inherit; transition: all 0.2s;">
                    כנס לטרק ➔
                </button>
            </div>
        </div>
        ${trek.description ? `
            <div class="card-body" style="padding-top:0;">
                <p class="card-description" style="margin-top:0; font-size:12.5px;">${escapeHtml(trek.description)}</p>
            </div>
        ` : ''}
    `;

    card.querySelector('.enter-trek-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        setActiveSubGroup(trek.id);
    });

    return card;
}

export function createTrekHeaderCard(trek) {
    const card = document.createElement('div');
    card.className = 'place-card trek-header-card';
    card.style.borderRightColor = trek.color;
    card.style.background = 'var(--primary-light)';

    card.innerHTML = `
        <div class="card-header" style="padding-bottom:8px;">
            <div class="card-number" style="background:${trek.color}; color:white; border-color:${trek.color};"><i class="fas fa-hiking"></i></div>
            <div class="card-title-section">
                <div style="font-size:11px; font-weight:bold; color:var(--text-muted); text-transform:uppercase;">טרק פעיל</div>
                <div class="card-title" style="font-size:17px; font-weight:bold; color:var(--primary-dark);">${escapeHtml(trek.name)}</div>
            </div>
            <div class="card-actions">
                <button type="button" class="btn-exit-trek" style="border:1px solid var(--border); background:white; color:var(--text-secondary); padding:4px 8px; border-radius:var(--radius-sm); font-size:11.5px; cursor:pointer; font-family:inherit; font-weight:bold; display:flex; align-items:center; gap:4px; transition: all 0.2s;">
                    <i class="fas fa-arrow-right"></i> חזרה למדינה
                </button>
            </div>
        </div>
        ${trek.description ? `
            <div class="card-body" style="padding-top:4px; padding-bottom:8px;">
                <p class="card-description" style="margin:0; font-size:13px; line-height:1.5; color:var(--text-secondary);">${escapeHtml(trek.description)}</p>
            </div>
        ` : ''}
    `;

    card.querySelector('.btn-exit-trek').addEventListener('click', (e) => {
        e.stopPropagation();
        setActiveSubGroup('all');
    });

    return card;
}

export function createPlaceCard(place, index) {
    const card = document.createElement('div');
    card.className = 'place-card';
    card.dataset.id = place.id;
    card.style.animationDelay = `${index * 0.08}s`;

    const labelText = place.customLabel || String(index + 1);
    const group = getGroupById(place.groupId);
    const badgeColor = getPlaceColor(place);

    card.style.borderRightColor = badgeColor;

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

            tagSpan.onclick = (e) => {
                e.stopPropagation();
                const searchInput = document.getElementById('search-places-input');
                if (searchInput) {
                    searchInput.value = tag;
                    setSearchQuery(tag);
                    renderPlaces();
                }
            };

            tagsContainer.appendChild(tagSpan);
        });
        body.appendChild(tagsContainer);
    }

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

        const headerEl = profileDiv.querySelector('.elevation-profile-header');
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

        headerEl.addEventListener('click', (e) => {
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
                <div style="font-size:12px; font-weight:bold; color:var(--primary-dark); margin: 0 0 6px 0;"><i class="fas fa-chart-line"></i> מקטעי מדידה (${segments.length})</div>
                <div class="segments-list" style="padding:0; max-height: 180px;">
                    ${segments.length === 0 ? '<div style="font-size:11.5px; color:var(--text-tertiary); text-align:center; padding:10px 0;">אין מקטעי מדידה עדיין.</div>' : segments.map(seg => {
                        const stats = getSegmentStatsLocal(place, seg.startIndex, seg.endIndex);
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
                                    <button type="button" class="btn-delete-segment delete-seg-action icon-btn" data-place-id="${place.id}" data-seg-id="${seg.id}" title="מחק מקטע" style="border:none; background:transparent; padding:0; cursor:pointer; color:var(--accent-rose); font-size:13px;">
                                        <i class="fas fa-trash-alt"></i>
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
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
        });

        segmentsDiv.querySelectorAll('.delete-seg-action').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetBtn = e.target.closest('.delete-seg-action');
                const placeId = targetBtn.dataset.placeId;
                const segId = targetBtn.dataset.segId;
                if (confirm('האם אתה בטוח שברצונך למחוק מקטע זה?')) {
                    deleteSegment(placeId, segId);
                }
            });
        });

        segmentsDiv.querySelectorAll('.segment-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.delete-seg-action') || e.target.closest('.segment-eye-toggle')) return;
                e.stopPropagation();
                const segId = item.dataset.segId;
                const seg = segments.find(s => s.id === segId);
                if (seg) {
                    focusMapOnSegment(place, seg);
                }
            });
        });

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

    const footer = document.createElement('div');
    footer.className = 'card-footer';

    const linksDiv = document.createElement('div');
    linksDiv.className = 'card-links';

    const gmapsUrl = place.links?.find(l => l.type === 'google_maps')?.url ||
                     `https://www.google.com/maps?q=${place.lat},${place.lng}`;
    linksDiv.innerHTML = `
        <a href="${gmapsUrl}" target="_blank" rel="noopener" class="link-badge google-maps">
            <i class="fas fa-map-marker-alt"></i> Google Maps
        </a>
    `;

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

    if (place.gpxData && place.gpxData.length > 0) {
        const recordBtn = document.createElement('button');
        recordBtn.className = 'link-badge record-route';
        recordBtn.innerHTML = `<i class="fas fa-video"></i> <span>הנפש מסלול</span>`;
        recordBtn.style.cursor = 'pointer';
        recordBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.openRecordingControlBar) window.openRecordingControlBar(place);
        });
        linksDiv.appendChild(recordBtn);

        const measureBtn = document.createElement('button');
        measureBtn.className = 'link-badge measure-route';
        measureBtn.innerHTML = `<i class="fas fa-ruler-combined"></i> <span>מדוד מקטע</span>`;
        measureBtn.style.cursor = 'pointer';
        measureBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openMeasurementControlBar(place);
        });
        linksDiv.appendChild(measureBtn);

        const exportGpxBtn = document.createElement('button');
        exportGpxBtn.className = 'link-badge export-gpx';
        exportGpxBtn.innerHTML = `<i class="fas fa-file-export"></i> <span>ייצוא GPX משודרג</span>`;
        exportGpxBtn.style.cursor = 'pointer';
        exportGpxBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.exportPlaceToGpx) window.exportPlaceToGpx(place);
        });
        linksDiv.appendChild(exportGpxBtn);
    }

    footer.appendChild(linksDiv);
    card.appendChild(footer);

    card.addEventListener('click', (e) => {
        if (e.target.closest('.card-action-btn') || e.target.closest('a') || e.target.closest('.carousel-btn') || e.target.closest('.carousel-item') || e.target.closest('.route-segments-container') || e.target.closest('.elevation-profile-container') || e.target.closest('input') || e.target.closest('button')) return;

        const wasActive = (activeMarkerId === place.id);
        if (wasActive) {
            setActiveMarker(place.id);
            if (window.innerWidth <= 900 && typeof window.switchToMobileMapTab === 'function') {
                window.switchToMobileMapTab();
            }
            return;
        }

        panToPlace(place.lat, place.lng);
        setActiveMarker(place.id);

        if (window.innerWidth <= 900 && typeof window.switchToMobileMapTab === 'function') {
            window.switchToMobileMapTab();
        }
    });

    header.querySelector('.collapse-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        setActiveMarker(place.id);
    });

    header.querySelector('.share-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        sharePlace(place.id);
    });

    header.querySelector('.edit-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openModal('edit', place);
    });

    header.querySelector('.delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDelete(place.id);
    });

    return card;
}

function getSegmentStatsLocal(place, startIdx, endIdx) {
    let gain = 0;
    let loss = 0;
    if (!place.gpxData) return { gain, loss };

    const start = Math.min(startIdx, endIdx);
    const end = Math.max(startIdx, endIdx);

    for (let i = start; i < end; i++) {
        const p1 = place.gpxData[i];
        const p2 = place.gpxData[i + 1];
        if (p1 && p2 && p1.ele !== null && p2.ele !== null) {
            const diff = p2.ele - p1.ele;
            if (diff > 0) gain += diff;
            else loss += Math.abs(diff);
        }
    }
    return { gain: Math.round(gain), loss: Math.round(loss) };
}

export function setActiveMarker(placeId, forceExpand = false) {
    if (!forceExpand && activeMarkerId === placeId) {
        setActiveMarkerId(null);
        renderMarkers();
        document.querySelectorAll('.place-card').forEach(card => {
            card.classList.remove('highlighted');
        });
        drawAllGpxTracks();
        return;
    }

    setActiveMarkerId(placeId);
    renderMarkers();

    document.querySelectorAll('.place-card').forEach(card => {
        card.classList.remove('highlighted');
        if (card.dataset.id === placeId) {
            card.classList.add('highlighted');
        }
    });

    drawAllGpxTracks();
}

// Focus map view on selected custom GPX segment
export function focusMapOnSegment(place, seg) {
    if (!map || !place.gpxData) return;
    const start = Math.min(seg.startIndex, seg.endIndex);
    const end = Math.max(seg.startIndex, seg.endIndex);
    const segmentPath = place.gpxData.slice(start, end + 1);

    if (segmentPath.length > 0) {
        if (isOfflineMode && leafletMap) {
            const bounds = L.latLngBounds(segmentPath.map(pt => [pt.lat, pt.lng]));
            leafletMap.fitBounds(bounds, { padding: [40, 40] });
        } else {
            const bounds = new google.maps.LatLngBounds();
            segmentPath.forEach(pt => bounds.extend(pt));
            map.fitBounds(bounds);
        }
        showToast(`מתמקד במקטע: ${seg.name}`, 'info');
    }
}

export function toggleSegmentVisibility(placeId, segId, isVisible) {
    const place = places.find(p => p.id === placeId);
    if (!place || !place.gpxSegments) return;

    const seg = place.gpxSegments.find(s => s.id === segId);
    if (seg) {
        seg.visible = isVisible;
        savePlaces();
        syncPlaceToFirebase(place);
        drawAllGpxTracks();
        if (isOfflineMode) syncLeafletView();

        // Update eye icon class dynamically
        const card = document.querySelector(`.place-card[data-id="${placeId}"]`);
        if (card) {
            const eye = card.querySelector(`.chk-segment-visibility[data-seg-id="${segId}"] ~ i`);
            if (eye) {
                if (isVisible) {
                    eye.className = 'fas fa-eye';
                    eye.style.color = 'var(--primary)';
                } else {
                    eye.className = 'fas fa-eye-slash';
                    eye.style.color = 'var(--text-muted)';
                }
            }
        }
    }
}

export function deleteSegment(placeId, segId) {
    const place = places.find(p => p.id === placeId);
    if (!place || !place.gpxSegments) return;

    place.gpxSegments = place.gpxSegments.filter(s => s.id !== segId);
    savePlaces();
    syncPlaceToFirebase(place);
    renderPlaces();
    drawAllGpxTracks();
    if (isOfflineMode) syncLeafletView();
    showToast('המקטע נמחק בהצלחה', 'info');
}

export function sharePlace(placeId) {
    const shareUrl = `${window.location.origin}${window.location.pathname}?placeId=${placeId}`;
    if (navigator.share) {
        const place = places.find(p => p.id === placeId);
        navigator.share({
            title: place ? place.name : 'מיקום מהטיול שלי',
            text: place ? place.description : 'ראה מקום זה במפה',
            url: shareUrl
        }).catch(err => console.error('Share error:', err));
    } else {
        navigator.clipboard.writeText(shareUrl).then(() => {
            showToast('קישור לשיתוף המקום הועתק ללוח!', 'success');
        }).catch(() => {
            showToast('העתקת הקישור נכשלה', 'error');
        });
    }
}

// ============= Modal =============
export function openModal(mode, place) {
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

    // Reset fields
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
    setPendingImages([]);
    setPendingGpxData(null);
    document.getElementById('gpx-input').value = '';
    document.getElementById('gpx-status').textContent = 'לא נבחר מסלול';
    document.getElementById('btn-remove-gpx').style.display = 'none';
    setEditingPlaceId(null);

    renderGroupSelect();
    const groupSelect = document.getElementById('place-group');
    if (activeGroupId !== 'all') {
        groupSelect.value = activeGroupId;
    } else {
        groupSelect.value = '';
    }

    if (window.miniMapMarker) {
        window.miniMapMarker.setMap(null);
        window.miniMapMarker = null;
    }

    if (mode === 'edit' && place) {
        title.innerHTML = '<i class="fas fa-pen"></i> עריכת מקום';
        setEditingPlaceId(place.id);
        form.name.value = place.name;
        form.description.value = place.description || '';
        form.lat.value = place.lat;
        form.lng.value = place.lng;
        form.id.value = place.id;

        groupSelect.value = place.groupId || '';

        if (form.customLabel) form.customLabel.value = place.customLabel || '';
        if (form.useCustomColor) {
            form.useCustomColor.checked = !!place.useCustomColor;
            if (form.customColor) {
                form.customColor.value = place.customColor || '#E5B23A';
                form.customColor.style.display = place.useCustomColor ? 'inline-block' : 'none';
            }
        }

        if (form.tags) {
            form.tags.value = place.tags ? place.tags.join(', ') : '';
        }

        if (place.images && place.images.length > 0) {
            setPendingImages([...place.images]);
            renderImagePreviews();
        }

        if (place.links) {
            place.links.filter(l => l.type !== 'google_maps').forEach(link => {
                addLinkInput(link.url, link.type);
            });
        }

        if (place.gpxData && place.gpxData.length > 0) {
            setPendingGpxData(place.gpxData);
            document.getElementById('gpx-status').textContent = `מסלול קיים (${place.gpxData.length} נקודות)`;
            document.getElementById('btn-remove-gpx').style.display = 'block';
        }

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

    if (mode !== 'edit') {
        setTimeout(() => form.search.focus(), 300);
    }
}

export function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    setEditingPlaceId(null);
    setPendingImages([]);
}

export function savePlace() {
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

    uploadPendingImages(placeId, pendingImages).then(uploadedImages => {
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

export function confirmDelete(placeId) {
    setDeleteTargetId(placeId);
    const overlay = document.getElementById('confirm-overlay');
    overlay.classList.add('active');
}

export function executeDelete() {
    if (!deleteTargetId) return;

    deletePlaceFromFirebase(deleteTargetId);

    setPlaces(places.filter(p => p.id !== deleteTargetId));
    savePlaces();
    renderGroupTabs();
    renderPlaces();
    renderMarkers();
    fitMapBounds();
    drawAllGpxTracks();

    const overlay = document.getElementById('confirm-overlay');
    overlay.classList.remove('active');
    setDeleteTargetId(null);
}

// ============= Link Inputs Management =============
export function addLinkInput(url = '', type = 'Wikipedia') {
    const container = document.getElementById('links-container');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'link-input-row';
    row.style = 'display:flex; gap:8px; margin-bottom:8px;';

    row.innerHTML = `
        <select class="link-type" style="width:110px; height:32px; font-size:12.5px; border:1px solid var(--border); border-radius:var(--radius-sm); font-family:inherit;">
            <option value="wikipedia" ${type === 'wikipedia' ? 'selected' : ''}>Wikipedia</option>
            <option value="youtube" ${type === 'youtube' ? 'selected' : ''}>YouTube</option>
            <option value="facebook" ${type === 'facebook' ? 'selected' : ''}>Facebook</option>
            <option value="instagram" ${type === 'instagram' ? 'selected' : ''}>Instagram</option>
            <option value="trail_website" ${type === 'trail_website' ? 'selected' : ''}>אתר מסלול</option>
            <option value="other" ${type === 'other' ? 'selected' : ''}>אחר</option>
        </select>
        <input type="url" class="link-url" placeholder="https://example.com" value="${escapeHtml(url)}" style="flex:1; height:32px; padding:0 8px; font-size:12.5px; border:1px solid var(--border); border-radius:var(--radius-sm); font-family:inherit;">
        <button type="button" class="btn-remove-link icon-btn" style="color:var(--accent-rose); border:none; background:transparent; cursor:pointer; font-size:14px;"><i class="fas fa-trash-alt"></i></button>
    `;

    row.querySelector('.btn-remove-link').addEventListener('click', () => {
        row.remove();
    });

    container.appendChild(row);
}

// ============= Mini Map (Google Maps inside Add/Edit modal) =============
export function updateMiniMap(lat, lng) {
    const miniWrapper = document.getElementById('mini-map-wrapper');
    if (!miniWrapper) return;
    miniWrapper.style.display = 'block';

    const pos = { lat, lng };

    if (!window.miniMap && typeof google !== 'undefined' && google.maps) {
        window.miniMap = new google.maps.Map(document.getElementById('mini-map'), {
            center: pos,
            zoom: 14,
            zoomControl: true,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false
        });

        window.miniMap.addListener('click', (e) => {
            const clickedLat = e.latLng.lat();
            const clickedLng = e.latLng.lng();
            document.getElementById('place-lat').value = clickedLat.toFixed(6);
            document.getElementById('place-lng').value = clickedLng.toFixed(6);

            if (window.miniMapMarker) {
                window.miniMapMarker.setPosition(e.latLng);
            } else {
                window.miniMapMarker = new google.maps.Marker({
                    position: e.latLng,
                    map: window.miniMap,
                    draggable: true
                });
            }
        });
    }

    if (window.miniMap) {
        window.miniMap.setCenter(pos);
        if (window.miniMapMarker) {
            window.miniMapMarker.setPosition(pos);
        } else {
            window.miniMapMarker = new google.maps.Marker({
                position: pos,
                map: window.miniMap,
                draggable: true
            });

            google.maps.event.addListener(window.miniMapMarker, 'dragend', (evt) => {
                document.getElementById('place-lat').value = evt.latLng.lat().toFixed(6);
                document.getElementById('place-lng').value = evt.latLng.lng().toFixed(6);
            });
        }
    }
}

// ============= Images Previews inside Modal =============
export function renderImagePreviews() {
    const container = document.getElementById('image-previews');
    if (!container) return;
    container.innerHTML = '';

    pendingImages.forEach((img, idx) => {
        const div = document.createElement('div');
        div.className = 'image-preview-item';
        div.style = 'position:relative; width:80px; height:60px; border-radius:4px; overflow:hidden; border:1.5px solid var(--border-light);';

        div.innerHTML = `
            <img src="${img}" style="width:100%; height:100%; object-fit:cover;">
            <button type="button" class="btn-delete-preview-image" data-idx="${idx}" style="position:absolute; top:2px; left:2px; background:rgba(0,0,0,0.6); color:white; border:none; border-radius:2px; width:18px; height:18px; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:10px;"><i class="fas fa-times"></i></button>
        `;

        div.querySelector('.btn-delete-preview-image').addEventListener('click', (e) => {
            e.stopPropagation();
            const removeIdx = parseInt(e.currentTarget.dataset.idx);
            pendingImages.splice(removeIdx, 1);
            setPendingImages([...pendingImages]);
            renderImagePreviews();
        });

        container.appendChild(div);
    });
}

// ============= Google Places Details Panel (POI Map Click) =============
export function showGooglePlaceDetails(placeId) {
    if (isOfflineMode || typeof google === 'undefined' || !google.maps) return;

    const panel = document.getElementById('google-place-panel');
    if (!panel) return;

    panel.classList.add('loading');
    panel.classList.add('active');

    // Immediate loading UI feedback
    panel.innerHTML = `
        <div style="position:relative; padding:40px 20px; text-align:center; color:var(--text-secondary); min-height:220px; display:flex; flex-direction:column; align-items:center; justify-content:center;">
            <button class="panel-close-btn" id="btn-google-panel-close-loading" style="position:absolute; top:16px; left:16px; width:32px; height:32px; border-radius:50%; border:none; background:rgba(0,0,0,0.08); color:var(--text-primary); display:flex; align-items:center; justify-content:center; cursor:pointer;"><i class="fas fa-times"></i></button>
            <i class="fas fa-spinner fa-spin" style="font-size:32px; color:var(--primary); margin-bottom:14px;"></i>
            <div style="font-size:14.5px; font-weight:600; color:var(--text-primary);">טוען פרטי מקום בגוגל מפות...</div>
        </div>
    `;
    panel.querySelector('#btn-google-panel-close-loading')?.addEventListener('click', closeGooglePlacePanel);

    const service = new google.maps.places.PlacesService(map || window.miniMap || document.createElement('div'));
    service.getDetails({
        placeId: placeId,
        fields: ['name', 'formatted_address', 'formatted_phone_number', 'website', 'rating', 'user_ratings_total', 'photos', 'reviews', 'url', 'geometry', 'place_id', 'opening_hours', 'vicinity', 'types']
    }, (place, status) => {
        panel.classList.remove('loading');
        if (status === google.maps.places.PlacesServiceStatus.OK && place) {
            panel.$activeGooglePlace = place; // Cache data

            let photoUrl = '';
            if (place.photos && place.photos.length > 0) {
                photoUrl = place.photos[0].getUrl({ maxWidth: 600, maxHeight: 320 });
            }

            let ratingHtml = '';
            if (place.rating) {
                const fullStars = Math.floor(place.rating);
                const hasHalf = (place.rating % 1) >= 0.5;
                let starsSvg = '';
                for (let i = 0; i < 5; i++) {
                    if (i < fullStars) {
                        starsSvg += '<i class="fas fa-star" style="color:#F59E0B; font-size:12px;"></i>';
                    } else if (i === fullStars && hasHalf) {
                        starsSvg += '<i class="fas fa-star-half-alt" style="color:#F59E0B; font-size:12px;"></i>';
                    } else {
                        starsSvg += '<i class="far fa-star" style="color:#CBD5E1; font-size:12px;"></i>';
                    }
                }

                ratingHtml = `
                    <div class="google-rating" style="display:flex; align-items:center; gap:6px; margin-top:6px;">
                        <span class="rating-num" style="font-weight:bold; font-size:14px; color:#F59E0B;">${place.rating}</span>
                        <div class="stars-wrap" style="display:inline-flex; gap:2px;">
                            ${starsSvg}
                        </div>
                        <span class="reviews-count" style="font-size:12px; color:var(--text-muted);">(${place.user_ratings_total ? place.user_ratings_total.toLocaleString() : 0} חוות דעת)</span>
                    </div>
                `;
            }

            let isOpenHtml = '';
            if (place.opening_hours && typeof place.opening_hours.isOpen === 'function') {
                const openNow = place.opening_hours.isOpen();
                isOpenHtml = openNow 
                    ? `<span style="display:inline-block; padding:2px 8px; border-radius:12px; background:#D1FAE5; color:#065F46; font-size:11px; font-weight:bold; margin-top:6px;">פתוח עכשיו</span>`
                    : `<span style="display:inline-block; padding:2px 8px; border-radius:12px; background:#FEE2E2; color:#991B1B; font-size:11px; font-weight:bold; margin-top:6px;">סגור כעת</span>`;
            }

            let lat = null, lng = null;
            if (place.geometry && place.geometry.location) {
                lat = place.geometry.location.lat();
                lng = place.geometry.location.lng();
            }

            let wazeUrl = '';
            if (lat && lng) {
                wazeUrl = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
            }

            let reviewsHtml = '';
            if (place.reviews && place.reviews.length > 0) {
                const topReviews = place.reviews.slice(0, 2);
                reviewsHtml = `
                    <div style="margin-top:18px; border-top:1px solid var(--border-light); padding-top:14px;">
                        <div style="font-size:13px; font-weight:bold; color:var(--primary-dark); margin-bottom:8px;"><i class="fas fa-comment-alt" style="margin-left:6px; color:var(--primary-lighter);"></i>ביקורות גוגל:</div>
                        ${topReviews.map(r => `
                            <div style="background:var(--primary-bg); padding:10px 12px; border-radius:var(--radius-sm); margin-bottom:8px; font-size:12px; line-height:1.4;">
                                <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-weight:600; color:var(--text-primary);">
                                    <span>${escapeHtml(r.author_name)}</span>
                                    <span style="color:#F59E0B;">★ ${r.rating}</span>
                                </div>
                                <div style="color:var(--text-secondary); max-height:60px; overflow:hidden; text-overflow:ellipsis;">"${escapeHtml(r.text)}"</div>
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            panel.innerHTML = `
                <div class="panel-header-image" style="position:relative; width:100%; height:180px; background-color:#E2E8F0; overflow:hidden;">
                    ${photoUrl ? `<img src="${photoUrl}" style="width:100%; height:100%; object-fit:cover;">` : '<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:32px; background:var(--primary-bg);"><i class="fas fa-map-marked-alt"></i></div>'}
                    <button class="panel-close-btn" id="btn-google-panel-close" style="position:absolute; top:12px; left:12px; width:32px; height:32px; border-radius:50%; border:none; background:rgba(0,0,0,0.55); color:white; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:14px; transition:background 0.2s;"><i class="fas fa-times"></i></button>
                    ${place.photos && place.photos.length > 1 ? `<span style="position:absolute; bottom:10px; right:10px; background:rgba(0,0,0,0.6); color:white; font-size:11px; padding:3px 8px; border-radius:10px;"><i class="fas fa-camera" style="margin-left:4px;"></i>${place.photos.length} תמונות</span>` : ''}
                </div>
                <div class="panel-content" style="padding:18px; direction:rtl; text-align:right; overflow-y:auto; flex:1;">
                    <h2 class="panel-title" style="font-size:19px; font-weight:bold; color:var(--primary-dark); margin:0 0 4px 0; line-height:1.3;">${escapeHtml(place.name)}</h2>
                    ${ratingHtml}
                    ${isOpenHtml}

                    <div class="panel-address" style="font-size:13px; color:var(--text-secondary); margin-top:12px; line-height:1.4;">
                        <i class="fas fa-map-marker-alt" style="color:var(--accent-rose); margin-left:8px; font-size:14px;"></i>${escapeHtml(place.formatted_address || place.vicinity || 'אין כתובת')}
                    </div>

                    ${place.formatted_phone_number ? `
                        <div class="panel-phone" style="font-size:13px; color:var(--text-secondary); margin-top:8px;">
                            <i class="fas fa-phone-alt" style="color:var(--primary-lighter); margin-left:8px; font-size:14px;"></i>
                            <a href="tel:${place.formatted_phone_number}" style="color:inherit; text-decoration:none; font-weight:500;">${escapeHtml(place.formatted_phone_number)}</a>
                        </div>
                    ` : ''}

                    <div style="display:flex; flex-direction:column; gap:8px; margin-top:20px;">
                        <button class="panel-btn" id="btn-add-google-place" style="width:100%; height:40px; background:var(--accent-emerald, #0D9E72); border:none; color:white; font-family:inherit; font-size:13.5px; font-weight:bold; border-radius:var(--radius-sm); cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:var(--shadow-sm);">
                            <i class="fas fa-plus-circle" style="font-size:15px;"></i>שמור למפת החלומות
                        </button>

                        <div style="display:flex; gap:8px;">
                            ${wazeUrl ? `
                                <a href="${wazeUrl}" target="_blank" style="flex:1; height:36px; background:#33CCFF; color:#002244; text-decoration:none; display:flex; align-items:center; justify-content:center; gap:6px; border-radius:var(--radius-sm); font-size:12.5px; font-weight:bold;">
                                    <i class="fas fa-route"></i>ניווט Waze
                                </a>
                            ` : ''}
                            ${place.website ? `
                                <a href="${place.website}" target="_blank" style="flex:1; height:36px; border:1.5px solid var(--border); border-radius:var(--radius-sm); color:var(--text-primary); text-decoration:none; display:flex; align-items:center; justify-content:center; gap:6px; font-size:12.5px; font-weight:500; background:var(--surface);">
                                    <i class="fas fa-globe" style="color:var(--primary-lighter);"></i>אתר אינטרנט
                                </a>
                            ` : ''}
                            <a href="${place.url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=${placeId}`}" target="_blank" style="width:36px; height:36px; border:1.5px solid var(--border); border-radius:var(--radius-sm); color:#4285F4; text-decoration:none; display:flex; align-items:center; justify-content:center; font-size:14px; background:var(--surface);" title="פתח בגוגל מפות">
                                <i class="fab fa-google"></i>
                            </a>
                        </div>
                    </div>

                    ${reviewsHtml}
                </div>
            `;

            panel.querySelector('#btn-google-panel-close')?.addEventListener('click', closeGooglePlacePanel);
            panel.querySelector('#btn-add-google-place')?.addEventListener('click', () => {
                openModalFromGooglePlace(place);
            });
        } else {
            panel.innerHTML = `
                <div style="position:relative; padding:40px 20px; text-align:center; color:var(--text-secondary);">
                    <button class="panel-close-btn" id="btn-google-panel-close-err" style="position:absolute; top:14px; left:14px; width:30px; height:30px; border-radius:50%; border:none; background:rgba(0,0,0,0.08); color:var(--text-primary); display:flex; align-items:center; justify-content:center; cursor:pointer;"><i class="fas fa-times"></i></button>
                    <i class="fas fa-exclamation-circle" style="font-size:36px; color:var(--accent-rose, #C95E6A); margin-bottom:12px;"></i>
                    <div style="font-size:15px; font-weight:bold; color:var(--text-primary);">פרטי המקום לא נמצאו</div>
                    <div style="font-size:12.5px; margin-top:6px; color:var(--text-muted);">לא ניתן להציג פרטים מלאים מתוך גוגל מפות עבור מיקום זה.</div>
                </div>
            `;
            panel.querySelector('#btn-google-panel-close-err')?.addEventListener('click', closeGooglePlacePanel);
        }
    });
}

export function closeGooglePlacePanel() {
    const panel = document.getElementById('google-place-panel');
    if (panel) panel.classList.remove('active');
}

export function openModalFromGooglePlace(googlePlace) {
    closeGooglePlacePanel();

    let latVal = 0;
    let lngVal = 0;
    if (googlePlace.geometry && googlePlace.geometry.location) {
        latVal = googlePlace.geometry.location.lat();
        lngVal = googlePlace.geometry.location.lng();
    } else if (map) {
        latVal = map.getCenter().lat();
        lngVal = map.getCenter().lng();
    }

    openModal('add');

    document.getElementById('place-name').value = googlePlace.name || '';
    document.getElementById('place-description').value = googlePlace.formatted_address || '';
    document.getElementById('place-lat').value = latVal.toFixed(6);
    document.getElementById('place-lng').value = lngVal.toFixed(6);
    document.getElementById('place-google-url').value = googlePlace.url || '';

    if (googlePlace.photos && googlePlace.photos.length > 0) {
        const photoUrl = googlePlace.photos[0].getUrl({ maxWidth: 600, maxHeight: 400 });
        setPendingImages([photoUrl]);
        renderImagePreviews();
    }

    updateMiniMap(latVal, lngVal);
}

// Lightbox for card image click
export function openLightbox(imgSrc) {
    const overlay = document.getElementById('lightbox-overlay');
    const img = document.getElementById('lightbox-image');
    if (!overlay || !img) return;

    img.src = imgSrc;
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

// ============= Auto-update lists of offline maps =============
export function updateSavedMapsList() {
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

    container.querySelectorAll('.delete-map-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const mapId = e.currentTarget.dataset.mapId;
            if (confirm('האם ברצונך למחוק מפה שמורה זו מהמכשיר?')) {
                await deleteSavedMap(mapId);
            }
        });
    });
}
window.updateSavedMapsList = updateSavedMapsList;

// ============= Admin Mode (מצב עריכה) =============
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

export function checkAdminMode() {
    if (sessionStorage.getItem('isAdmin') === 'true') {
        document.body.classList.add('admin-mode');
        const lockBtn = document.getElementById('btn-admin-lock');
        if (lockBtn) {
            lockBtn.innerHTML = '<i class="fas fa-lock-open"></i><span class="admin-btn-text">מנהל</span>';
            lockBtn.title = 'יציאה ממצב מנהל';
        }
    }
}
window.checkAdminMode = checkAdminMode;

export function initAdminEvents() {
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
                if (adminPasswordInput) adminPasswordInput.value = '';
                adminModal.classList.add('active');
                if (adminPasswordInput) adminPasswordInput.focus();
            }
        });

        const closeAdminModal = () => {
            adminModal.classList.remove('active');
        };

        if (adminCloseBtn) adminCloseBtn.addEventListener('click', closeAdminModal);
        if (adminCancelBtn) adminCancelBtn.addEventListener('click', closeAdminModal);

        const submitAdminLogin = () => {
            const password = adminPasswordInput ? adminPasswordInput.value : '';
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
}

// ============= Offline Mode Event Handlers =============
export function initOfflineEvents() {
    const offlineManagerBtn = document.getElementById('btn-offline-manager');
    const offlineModal = document.getElementById('offline-modal-overlay');
    const offlineCloseBtn = document.getElementById('offline-modal-close');
    const offlineCloseBottomBtn = document.getElementById('btn-offline-close-bottom');
    const downloadOfflineBtn = document.getElementById('btn-download-offline-map');
    const simulateOfflineCheckbox = document.getElementById('toggle-simulate-offline');
    const offlineTrekSelect = document.getElementById('offline-trek-select');

    if (offlineManagerBtn && offlineModal) {
        offlineManagerBtn.addEventListener('click', () => {
            if (offlineTrekSelect) {
                offlineTrekSelect.innerHTML = `<option value="all">כל המסלולים השמורים</option>` + 
                    places.filter(p => p.gpxData && p.gpxData.length > 0)
                        .map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
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

        if (offlineCloseBottomBtn) {
            offlineCloseBottomBtn.addEventListener('click', () => {
                offlineModal.classList.remove('active');
            });
        }

        if (downloadOfflineBtn) {
            downloadOfflineBtn.addEventListener('click', async () => {
                const layerSelect = document.getElementById('offline-layer-select');
                const layerType = layerSelect ? layerSelect.value : 'osm';
                const trekId = offlineTrekSelect ? offlineTrekSelect.value : 'all';

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
    }

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

    window.addEventListener('offline', () => {
        showToast('החיבור לאינטרנט אבד! עובר אוטומטית למפות שטח אוף-ליין', 'warning');
        toggleOfflineMode(true);
        if (simulateOfflineCheckbox) simulateOfflineCheckbox.checked = true;
    });

    window.addEventListener('online', () => {
        if (simulateOfflineCheckbox && !simulateOfflineCheckbox.checked) {
            showToast('החיבור לאינטרנט חזר! טוען מפות גוגל מקוונות', 'success');
            toggleOfflineMode(false);
        }
    });

    if (!navigator.onLine) {
        toggleOfflineMode(true);
        if (simulateOfflineCheckbox) simulateOfflineCheckbox.checked = true;
    }
}

// ============= Resizable Split Pane (Map / Places List / Itinerary) =============
export function initResizablePanels() {
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



