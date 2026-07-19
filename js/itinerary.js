import {
    places,
    groups,
    itineraries, setItineraries,
    activeTrip, setActiveTrip,
    activeGroupId, setActiveGroupId,
    activeSubGroupId, setActiveSubGroupId,
    savePlaces,
    isOfflineMode
} from './state.js';

import {
    escapeHtml,
    showToast,
    getPlaceColor,
    renderPlaces,
    setActiveGroup,
    setActiveSubGroup
} from './ui.js';

import {
    getDistance,
    panToPlace
} from './map.js';

// ============= Constants =============
export const ITINERARIES_KEY = 'mytravel-itineraries';

// ============= State =============
export let activeItineraryId = null;  // Currently viewed trip
export let editingDayDate = null;     // Date being edited in modal
export let currentItineraryView = localStorage.getItem('mytravel-itinerary-view') || 'timeline'; // 'timeline', 'compact', 'calendar'
export let jewishHolidaysMap = {};
export let calendarCurrentYear = null;
export let calendarCurrentMonth = null;

// Helpers to modify state values (since ES modules don't allow modifying imports directly)
export function setActiveItineraryId(val) { activeItineraryId = val; }
export function setEditingDayDate(val) { editingDayDate = val; }
export function setCurrentItineraryView(val) { currentItineraryView = val; }
export function setCalendarCurrentYear(val) { calendarCurrentYear = val; }
export function setCalendarCurrentMonth(val) { calendarCurrentMonth = val; }

// ============= Storage =============
export function loadItineraries() {
    if (window.IS_FIREBASE_CONFIGURED && window.db) {
        window.db.collection('itineraries').onSnapshot(snapshot => {
            if (snapshot.empty) {
                const stored = localStorage.getItem(ITINERARIES_KEY);
                if (stored) {
                    setItineraries(JSON.parse(stored));
                    itineraries.forEach(it => {
                        window.db.collection('itineraries').doc(it.id).set(it);
                    });
                } else {
                    setItineraries([]);
                }
            } else {
                setItineraries(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            }
            localStorage.setItem(ITINERARIES_KEY, JSON.stringify(itineraries));
            
            // Restore saved active itinerary
            const savedActiveId = localStorage.getItem('mytravel-active-itinerary-id');
            if (savedActiveId && itineraries.some(it => it.id === savedActiveId)) {
                setActiveItineraryId(savedActiveId);
                // Also set activeItineraryId on window for global scopes like map
                window.activeItineraryId = savedActiveId;
            }
            
            renderItineraryList();
            if (activeItineraryId) {
                renderGanttView(activeItineraryId);
            }
        }, err => {
            console.error("Error loading itineraries from Firebase:", err);
            loadItinerariesFromLocalStorage();
        });
    } else {
        loadItinerariesFromLocalStorage();
        const savedActiveId = localStorage.getItem('mytravel-active-itinerary-id');
        if (savedActiveId && itineraries.some(it => it.id === savedActiveId)) {
            setActiveItineraryId(savedActiveId);
            window.activeItineraryId = savedActiveId;
        }
    }
}

export function loadItinerariesFromLocalStorage() {
    const stored = localStorage.getItem(ITINERARIES_KEY);
    if (stored) {
        setItineraries(JSON.parse(stored));
    } else {
        setItineraries([]);
    }
}

export function saveItineraries() {
    localStorage.setItem(ITINERARIES_KEY, JSON.stringify(itineraries));
}

export function syncItineraryToFirebase(itinerary) {
    if (window.IS_FIREBASE_CONFIGURED && window.db && itinerary && itinerary.id) {
        window.db.collection('itineraries').doc(itinerary.id).set(itinerary)
            .catch(err => console.error("Error syncing itinerary to Firebase:", err));
    }
}

export function deleteItineraryFromFirebase(id) {
    if (window.IS_FIREBASE_CONFIGURED && window.db) {
        window.db.collection('itineraries').doc(id).delete()
            .catch(err => console.error("Error deleting itinerary from Firebase:", err));
    }
}

// ============= CRUD Operations =============
export function createItinerary(name, startDate, endDate, color) {
    const id = 'itin-' + Date.now();
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = [];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        days.push({
            date: d.toISOString().split('T')[0], // YYYY-MM-DD
            title: '',
            notes: '',
            links: [],       // [{url, label}]
            placeIds: [],     // IDs of places from the places list
            gpxPlaceId: '',   // ID of a place that has a GPX track
            color: ''         // Optional per-day color override
        });
    }

    const itinerary = {
        id,
        name,
        startDate: startDate,
        endDate: endDate,
        color: color || '#2C4E72',
        days,
        createdAt: Date.now()
    };

    itineraries.push(itinerary);
    saveItineraries();
    syncItineraryToFirebase(itinerary);
    enrichItineraryWithHolidays(itinerary); // fetch Jewish holidays asynchronously
    return itinerary;
}

export function deleteItinerary(id) {
    setItineraries(itineraries.filter(it => it.id !== id));
    saveItineraries();
    deleteItineraryFromFirebase(id);
    if (activeItineraryId === id) {
        setActiveItineraryId(null);
        window.activeItineraryId = null;
        localStorage.removeItem('mytravel-active-itinerary-id');
    }
    renderItineraryList();
}

export function updateDay(itineraryId, date, updates) {
    const itin = itineraries.find(it => it.id === itineraryId);
    if (!itin) return;
    const day = itin.days.find(d => d.date === date);
    if (!day) return;
    Object.assign(day, updates);
    saveItineraries();
    syncItineraryToFirebase(itin);
}

export function getItineraryById(id) {
    return itineraries.find(it => it.id === id);
}

// ============= Helper =============
export function formatDateHebrew(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    const months = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    return `יום ${days[d.getDay()]}, ${d.getDate()} ב${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateShort(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getDate()}/${d.getMonth() + 1}`;
}

export function getDayNumber(itinerary, dateStr) {
    const idx = itinerary.days.findIndex(d => d.date === dateStr);
    return idx >= 0 ? idx + 1 : 0;
}

// ============= Render: Itinerary List (Trip Selection) =============
export function renderItineraryList() {
    const container = document.getElementById('itinerary-list');
    if (!container) return;

    if (itineraries.length === 0) {
        container.innerHTML = `
            <div class="itin-empty-state">
                <div class="itin-empty-icon"><i class="fas fa-calendar-plus"></i></div>
                <h3>אין לוחות זמנים עדיין</h3>
                <p>צור לוח זמנים חדש כדי לתכנן את הטיול הבא שלך</p>
            </div>
        `;
        return;
    }

    container.innerHTML = itineraries
        .sort((a, b) => new Date(b.startDate) - new Date(a.startDate))
        .map(itin => {
            const start = new Date(itin.startDate + 'T00:00:00');
            const end = new Date(itin.endDate + 'T00:00:00');
            const totalDays = itin.days.length;
            const filledDays = itin.days.filter(d => d.title || d.links.length > 0 || d.placeIds.length > 0 || d.gpxPlaceId).length;
            const progress = totalDays > 0 ? Math.round((filledDays / totalDays) * 100) : 0;
            const isActive = itin.id === activeItineraryId;

            const now = new Date();
            now.setHours(0, 0, 0, 0);
            let statusClass = 'itin-future';
            let statusLabel = 'טיול עתידי';
            if (now > end) {
                statusClass = 'itin-past';
                statusLabel = 'טיול עבר';
            } else if (now >= start && now <= end) {
                statusClass = 'itin-current';
                statusLabel = 'עכשיו בטיול!';
            }

            return `
                <div class="itin-card ${isActive ? 'active' : ''} ${statusClass}" data-itin-id="${itin.id}" style="--itin-color: ${itin.color}">
                    <div class="itin-card-header">
                        <div class="itin-card-color" style="background: ${itin.color}"></div>
                        <div class="itin-card-info">
                            <h3 class="itin-card-name">${itin.name}</h3>
                            <span class="itin-card-dates">
                                <i class="fas fa-calendar-alt"></i>
                                ${formatDateShort(itin.startDate)} – ${formatDateShort(itin.endDate)}
                                <span class="itin-days-badge">${totalDays} ימים</span>
                            </span>
                        </div>
                        <span class="itin-status-badge ${statusClass}">${statusLabel}</span>
                    </div>
                    <div class="itin-card-progress">
                        <div class="itin-progress-bar">
                            <div class="itin-progress-fill" style="width: ${progress}%; background: ${itin.color}"></div>
                        </div>
                        <span class="itin-progress-text">${filledDays}/${totalDays} ימים מתוכננים</span>
                    </div>
                    <div class="itin-card-actions">
                        <button class="itin-btn-open" data-itin-id="${itin.id}" title="פתח לוח זמנים">
                            <i class="fas fa-calendar-day"></i> פתח
                        </button>
                        <button class="itin-btn-delete" data-itin-id="${itin.id}" title="מחק לוח זמנים">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

    // Bind events
    container.querySelectorAll('.itin-btn-open').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.itinId;
            setActiveItineraryId(id);
            window.activeItineraryId = id;
            localStorage.setItem('mytravel-active-itinerary-id', id);
            renderItineraryList();
            renderGanttView(id);
            if (window.drawAllGpxTracks) window.drawAllGpxTracks();
            if (isOfflineMode) syncLeafletView();
        });
    });

    container.querySelectorAll('.itin-btn-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.itinId;
            const itin = getItineraryById(id);
            if (confirm(`למחוק את הלוח "${itin ? itin.name : ''}"? פעולה זו אינה ניתנת לביטול.`)) {
                deleteItinerary(id);
            }
        });
    });

    container.querySelectorAll('.itin-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = card.dataset.itinId;
            setActiveItineraryId(id);
            window.activeItineraryId = id;
            localStorage.setItem('mytravel-active-itinerary-id', id);
            renderItineraryList();
            renderGanttView(id);
            if (window.drawAllGpxTracks) window.drawAllGpxTracks();
            if (isOfflineMode) syncLeafletView();
        });
    });
}

// ============= Render: Gantt Timeline / Compact View =============
export function renderGanttView(itineraryId) {
    if (currentItineraryView === 'calendar') {
        renderCalendarView(itineraryId);
        return;
    }

    const itin = getItineraryById(itineraryId);
    const ganttContainer = document.getElementById('gantt-container');
    if (!ganttContainer || !itin) return;

    const start = new Date(itin.startDate + 'T00:00:00');
    loadJewishHolidaysForYear(start.getFullYear());
    loadJewishHolidaysForYear(start.getFullYear() + 1);

    const backBtn = `
        <button class="itin-back-btn" id="itin-back-btn">
            <i class="fas fa-arrow-right"></i> חזרה לרשימה
        </button>
    `;

    const viewSelector = `
        <div class="itin-view-selector">
            <button class="view-opt-btn ${currentItineraryView === 'timeline' ? 'active' : ''}" data-view="timeline"><i class="fas fa-stream"></i> ציר זמן</button>
            <button class="view-opt-btn ${currentItineraryView === 'compact' ? 'active' : ''}" data-view="compact"><i class="fas fa-list-ul"></i> קומפקטי</button>
            <button class="view-opt-btn ${currentItineraryView === 'calendar' ? 'active' : ''}" data-view="calendar"><i class="fas fa-calendar-alt"></i> לוח שנה</button>
        </div>
    `;

    const actionsRow = `
        <div class="itin-actions-row">
            <button class="itin-action-btn" id="btn-edit-itin-dates" data-itin-id="${itin.id}"><i class="fas fa-calendar-alt"></i> ערוך תאריכים</button>
            <button class="itin-action-btn" id="btn-export-ics" data-itin-id="${itin.id}"><i class="fas fa-file-export"></i> ייצוא ליומן (.ics)</button>
        </div>
    `;

    const headerHtml = `
        <div class="gantt-header">
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%; flex-wrap:wrap; gap:10px;">
                ${backBtn}
                ${viewSelector}
            </div>
            <div class="gantt-title-row" style="margin-top: 14px; justify-content: space-between;">
                <div style="display:flex; align-items:center; gap:12px;">
                    <div class="gantt-title-color" style="background: ${itin.color}"></div>
                    <h2 class="gantt-title">${itin.name}</h2>
                    <span class="gantt-dates">${formatDateHebrew(itin.startDate)} – ${formatDateHebrew(itin.endDate)}</span>
                </div>
                ${actionsRow}
            </div>
        </div>
    `;

    const isCompact = currentItineraryView === 'compact';

    const daysHtml = itin.days.map((day, idx) => {
        const dayNum = idx + 1;
        const hasContent = day.title || day.notes || day.links.length > 0 || day.placeIds.length > 0 || day.gpxPlaceId;
        const isToday = day.date === new Date().toISOString().split('T')[0];
        
        const linkedPlaces = day.placeIds
            .map(pid => (places ? places.find(p => p.id === pid) : null))
            .filter(Boolean);
        
        const gpxPlace = day.gpxPlaceId && places
            ? places.find(p => p.id === day.gpxPlaceId)
            : null;

        const holidays = (jewishHolidaysMap[day.date] || []).concat(day.holidays || []);
        const uniqueHolidays = Array.from(new Set(holidays));
        const holidaysHtml = uniqueHolidays.map(h => `<span class="itin-holiday-badge">${h}</span>`).join('');

        if (isCompact) {
            return `
                <div class="gantt-day compact ${hasContent ? 'has-content' : ''} ${isToday ? 'is-today' : ''}" 
                     data-date="${day.date}" data-itin-id="${itineraryId}">
                    <div class="gantt-day-marker">
                        <div class="gantt-day-dot" style="background: ${day.color || itin.color}"></div>
                        <div class="gantt-day-line"></div>
                    </div>
                    <div class="gantt-day-content">
                        <div class="gantt-day-header" style="margin-bottom: 0;">
                            <span class="gantt-day-num">יום ${dayNum}</span>
                            <span class="gantt-day-date">${formatDateShort(day.date)}</span>
                            ${holidaysHtml}
                            <span class="gantt-day-title" style="margin: 0 8px 0 0; font-size:14px; font-weight:700;">${day.title || 'יום ללא כותרת'}</span>
                            ${isToday ? '<span class="gantt-today-badge">היום!</span>' : ''}
                            
                            <div style="margin-right: auto; display: flex; align-items: center; gap: 8px;">
                                ${gpxPlace ? (() => {
                                    const hasRange = (day.gpxStartKm !== undefined && day.gpxStartKm !== null) || (day.gpxEndKm !== undefined && day.gpxEndKm !== null);
                                    const start = (day.gpxStartKm !== undefined && day.gpxStartKm !== null) ? day.gpxStartKm : 0;
                                    const end = (day.gpxEndKm !== undefined && day.gpxEndKm !== null) ? day.gpxEndKm : 99999;
                                    const rangeText = hasRange ? ` (ק"מ ${start.toFixed(1)}–${end === 99999 ? 'סוף' : end.toFixed(1)})` : '';
                                    return `
                                        <span class="gantt-day-gpx" data-place-id="${gpxPlace.id}" style="margin: 0; padding: 2px 8px; font-size:11px;">
                                            <i class="fas fa-route"></i> ${gpxPlace.name}${rangeText}
                                        </span>
                                    `;
                                })() : ''}
                                ${linkedPlaces.length > 0 ? `
                                    <span class="gantt-place-chip" data-place-id="${linkedPlaces[0].id}" style="margin: 0; padding: 2px 8px; font-size:11px;">
                                        <i class="fas fa-map-pin"></i> ${linkedPlaces.length} מקומות
                                    </span>
                                ` : ''}
                                <button class="gantt-day-edit-btn" data-date="${day.date}" data-itin-id="${itineraryId}" style="margin: 0; padding: 2px 8px; font-size:11px; border-style: solid;">
                                    <i class="fas fa-pen"></i> ערוך
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        return `
            <div class="gantt-day ${hasContent ? 'has-content' : ''} ${isToday ? 'is-today' : ''}" 
                 data-date="${day.date}" data-itin-id="${itineraryId}">
                <div class="gantt-day-marker">
                    <div class="gantt-day-dot" style="background: ${day.color || itin.color}"></div>
                    <div class="gantt-day-line"></div>
                </div>
                <div class="gantt-day-content">
                    <div class="gantt-day-header">
                        <span class="gantt-day-num">יום ${dayNum}</span>
                        <span class="gantt-day-date">${formatDateHebrew(day.date)}</span>
                        ${holidaysHtml}
                        ${isToday ? '<span class="gantt-today-badge">היום!</span>' : ''}
                    </div>
                    ${day.title ? `<h4 class="gantt-day-title">${day.title}</h4>` : ''}
                    ${day.notes ? `<p class="gantt-day-notes">${day.notes}</p>` : ''}
                    
                    ${gpxPlace ? (() => {
                        const hasRange = (day.gpxStartKm !== undefined && day.gpxStartKm !== null) || (day.gpxEndKm !== undefined && day.gpxEndKm !== null);
                        const start = (day.gpxStartKm !== undefined && day.gpxStartKm !== null) ? day.gpxStartKm : 0;
                        const end = (day.gpxEndKm !== undefined && day.gpxEndKm !== null) ? day.gpxEndKm : 99999;
                        const rangeText = hasRange ? ` (ק"מ ${start.toFixed(1)} עד ק"מ ${end === 99999 ? 'סוף' : end.toFixed(1)})` : '';
                        return `
                            <div class="gantt-day-gpx" data-place-id="${gpxPlace.id}">
                                <i class="fas fa-route"></i>
                                <span>${gpxPlace.name}${rangeText}</span>
                            </div>
                        `;
                    })() : ''}
                    
                    ${linkedPlaces.length > 0 ? `
                        <div class="gantt-day-places">
                            ${linkedPlaces.map(p => `
                                <span class="gantt-place-chip" data-place-id="${p.id}">
                                    <i class="fas fa-map-pin"></i> ${p.name}
                                </span>
                            `).join('')}
                        </div>
                    ` : ''}
                    
                    ${day.links.length > 0 ? `
                        <div class="gantt-day-links">
                            ${day.links.map((lnk, li) => `
                                <a class="gantt-link" href="${lnk.url}" target="_blank" rel="noopener">
                                    <i class="fas fa-external-link-alt"></i> ${lnk.label || lnk.url}
                                </a>
                            `).join('')}
                        </div>
                    ` : ''}
                    
                    <button class="gantt-day-edit-btn" data-date="${day.date}" data-itin-id="${itineraryId}">
                        <i class="fas fa-pen"></i> ערוך יום
                    </button>
                </div>
            </div>
        `;
    }).join('');

    ganttContainer.innerHTML = headerHtml + `<div class="gantt-timeline">${daysHtml}</div>`;

    bindGanttHeaderEvents(itineraryId);
    bindGanttTimelineEvents(itineraryId);

    document.getElementById('itinerary-list-wrapper').style.display = 'none';
    ganttContainer.style.display = '';

    const todayEl = ganttContainer.querySelector('.gantt-day.is-today');
    if (todayEl) {
        setTimeout(() => todayEl.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
    }
}

// ============= Day Edit Modal =============
export function openDayEditModal(itineraryId, dateStr) {
    const itin = getItineraryById(itineraryId);
    if (!itin) return;
    const day = itin.days.find(d => d.date === dateStr);
    if (!day) return;

    setEditingDayDate(dateStr);
    const dayNum = getDayNumber(itin, dateStr);

    const modal = document.getElementById('day-edit-modal-overlay');
    if (!modal) return;

    document.getElementById('day-edit-title-text').textContent = `עריכת יום ${dayNum} – ${formatDateHebrew(dateStr)}`;
    document.getElementById('day-edit-day-title').value = day.title || '';
    document.getElementById('day-edit-day-notes').value = day.notes || '';

    renderDayLinks(day.links);
    renderDayPlacesSelector(day.placeIds);
    renderDayGpxSelector(day.gpxPlaceId);
    updateGpxRangeUI(day.gpxPlaceId, day.gpxStartKm, day.gpxEndKm);

    const swapSelect = document.getElementById('day-edit-swap-target');
    if (swapSelect) {
        const otherDays = itin.days.filter(d => d.date !== dateStr);
        swapSelect.innerHTML = otherDays.map(d => {
            const dayNo = getDayNumber(itin, d.date);
            const titleText = d.title ? ` - ${d.title}` : '';
            return `<option value="${d.date}">יום ${dayNo}${titleText}</option>`;
        }).join('');
    }

    modal.dataset.itinId = itineraryId;
    modal.dataset.date = dateStr;

    modal.classList.add('active');
}

export function closeDayEditModal() {
    const modal = document.getElementById('day-edit-modal-overlay');
    if (modal) modal.classList.remove('active');
    setEditingDayDate(null);
}

export function saveDayEdit() {
    const modal = document.getElementById('day-edit-modal-overlay');
    if (!modal) return;

    const itineraryId = modal.dataset.itinId;
    const dateStr = modal.dataset.date;

    const title = document.getElementById('day-edit-day-title').value.trim();
    const notes = document.getElementById('day-edit-day-notes').value.trim();

    const linkEls = document.querySelectorAll('#day-edit-links-container .day-link-row');
    const links = [];
    linkEls.forEach(row => {
        const url = row.querySelector('.day-link-url')?.value.trim();
        const label = row.querySelector('.day-link-label')?.value.trim();
        if (url) {
            links.push({ url, label: label || url });
        }
    });

    const placeCheckboxes = document.querySelectorAll('#day-edit-places-list input[type="checkbox"]:checked');
    const placeIds = Array.from(placeCheckboxes).map(cb => cb.value);

    const gpxSelect = document.getElementById('day-edit-gpx-select');
    const gpxPlaceId = gpxSelect ? gpxSelect.value : '';

    const startVal = parseFloat(document.getElementById('day-edit-gpx-start-km').value);
    const endVal = parseFloat(document.getElementById('day-edit-gpx-end-km').value);
    const gpxStartKm = !isNaN(startVal) ? startVal : null;
    const gpxEndKm = !isNaN(endVal) ? endVal : null;

    updateDay(itineraryId, dateStr, { 
        title, 
        notes, 
        links, 
        placeIds, 
        gpxPlaceId, 
        gpxStartKm, 
        gpxEndKm 
    });

    closeDayEditModal();
    renderGanttView(itineraryId);
    
    // Rerender Map / Leaflet view
    if (window.drawAllGpxTracks) window.drawAllGpxTracks();
    if (isOfflineMode) syncLeafletView();

    showToast('היום עודכן בהצלחה!', 'success');
}

export function renderDayLinks(links) {
    const container = document.getElementById('day-edit-links-container');
    if (!container) return;

    container.innerHTML = (links || []).map((lnk, i) => `
        <div class="day-link-row" data-index="${i}">
            <input type="text" class="day-link-label" value="${lnk.label || ''}" placeholder="שם הקישור (למשל: מלון, מסעדה...)">
            <input type="text" class="day-link-url" value="${lnk.url || ''}" placeholder="https://...">
            <button class="day-link-remove" data-index="${i}" title="הסר קישור"><i class="fas fa-times"></i></button>
        </div>
    `).join('');

    container.querySelectorAll('.day-link-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.day-link-row').remove();
        });
    });
}

export function addDayLink() {
    const container = document.getElementById('day-edit-links-container');
    if (!container) return;
    const idx = container.children.length;
    const row = document.createElement('div');
    row.className = 'day-link-row';
    row.dataset.index = idx;
    row.innerHTML = `
        <input type="text" class="day-link-label" value="" placeholder="שם הקישור (למשל: מלון, מסעדה...)">
        <input type="text" class="day-link-url" value="" placeholder="https://...">
        <button class="day-link-remove" title="הסר קישור"><i class="fas fa-times"></i></button>
    `;
    row.querySelector('.day-link-remove').addEventListener('click', () => row.remove());
    container.appendChild(row);
}

export function renderDayPlacesSelector(selectedIds) {
    const list = document.getElementById('day-edit-places-list');
    if (!list) return;

    const allPlaces = places || [];
    if (allPlaces.length === 0) {
        list.innerHTML = '<p class="day-edit-no-places">אין מקומות שמורים עדיין</p>';
        return;
    }

    list.innerHTML = allPlaces.map(p => {
        const checked = (selectedIds || []).includes(p.id) ? 'checked' : '';
        return `
            <label class="day-place-option">
                <input type="checkbox" value="${p.id}" ${checked}>
                <span class="day-place-name"><i class="fas fa-map-marker-alt"></i> ${p.name}</span>
            </label>
        `;
    }).join('');
}

export function renderDayGpxSelector(selectedGpxId) {
    const select = document.getElementById('day-edit-gpx-select');
    if (!select) return;

    const allPlaces = places || [];
    const gpxPlaces = allPlaces.filter(p => p.gpxData);

    select.innerHTML = '<option value="">ללא מסלול GPX</option>' +
        gpxPlaces.map(p => {
            const selected = p.id === selectedGpxId ? 'selected' : '';
            return `<option value="${p.id}" ${selected}>${p.name}</option>`;
        }).join('');
}

// ============= Create Itinerary Modal =============
export function openCreateItineraryModal() {
    const modal = document.getElementById('create-itin-modal-overlay');
    if (!modal) return;
    
    document.getElementById('create-itin-name').value = '';
    document.getElementById('create-itin-start').value = '';
    document.getElementById('create-itin-end').value = '';
    
    const colorOptions = modal.querySelectorAll('.itin-color-option');
    colorOptions.forEach(opt => opt.classList.remove('selected'));
    if (colorOptions[0]) colorOptions[0].classList.add('selected');
    modal.classList.add('active');
}

export function closeCreateItineraryModal() {
    const modal = document.getElementById('create-itin-modal-overlay');
    if (modal) modal.classList.remove('active');
}

export function submitCreateItinerary() {
    const name = document.getElementById('create-itin-name').value.trim();
    const start = document.getElementById('create-itin-start').value;
    const end = document.getElementById('create-itin-end').value;
    const selectedColor = document.querySelector('#create-itin-modal-overlay .itin-color-option.selected');
    const color = selectedColor ? selectedColor.dataset.color : '#2C4E72';

    if (!name) {
        showToast('נא להזין שם לטיול', 'error');
        return;
    }
    if (!start || !end) {
        showToast('נא לבחור תאריכי התחלה וסיום', 'error');
        return;
    }
    if (new Date(start) > new Date(end)) {
        showToast('תאריך ההתחלה חייב להיות לפני תאריך הסיום', 'error');
        return;
    }

    const daysDiff = Math.ceil((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24)) + 1;
    if (daysDiff > 60) {
        showToast('לוח זמנים מוגבל ל-60 ימים מקסימום', 'error');
        return;
    }

    const itin = createItinerary(name, start, end, color);
    closeCreateItineraryModal();
    setActiveItineraryId(itin.id);
    window.activeItineraryId = itin.id;
    localStorage.setItem('mytravel-active-itinerary-id', itin.id);
    renderItineraryList();
    renderGanttView(itin.id);
    if (window.drawAllGpxTracks) window.drawAllGpxTracks();

    showToast(`הלוח "${name}" נוצר בהצלחה!`, 'success');
}

// ============= Render: Classic Calendar Monthly View =============
export function renderCalendarView(itineraryId, customYear, customMonth) {
    const itin = getItineraryById(itineraryId);
    const ganttContainer = document.getElementById('gantt-container');
    if (!ganttContainer || !itin) return;

    if (customYear !== undefined && customMonth !== undefined) {
        setCalendarCurrentYear(customYear);
        setCalendarCurrentMonth(customMonth);
    } else if (calendarCurrentYear === null || calendarCurrentMonth === null) {
        const start = new Date(itin.startDate + 'T00:00:00');
        setCalendarCurrentYear(start.getFullYear());
        setCalendarCurrentMonth(start.getMonth());
    }

    loadJewishHolidaysForYear(calendarCurrentYear);
    loadJewishHolidaysForYear(calendarCurrentYear + 1);

    const backBtn = `
        <button class="itin-back-btn" id="itin-back-btn">
            <i class="fas fa-arrow-right"></i> חזרה לרשימה
        </button>
    `;

    const viewSelector = `
        <div class="itin-view-selector">
            <button class="view-opt-btn ${currentItineraryView === 'timeline' ? 'active' : ''}" data-view="timeline"><i class="fas fa-stream"></i> ציר זמן</button>
            <button class="view-opt-btn ${currentItineraryView === 'compact' ? 'active' : ''}" data-view="compact"><i class="fas fa-list-ul"></i> קומפקטי</button>
            <button class="view-opt-btn ${currentItineraryView === 'calendar' ? 'active' : ''}" data-view="calendar"><i class="fas fa-calendar-alt"></i> לוח שנה</button>
        </div>
    `;

    const actionsRow = `
        <div class="itin-actions-row">
            <button class="itin-action-btn" id="btn-edit-itin-dates" data-itin-id="${itin.id}"><i class="fas fa-calendar-alt"></i> ערוך תאריכים</button>
            <button class="itin-action-btn" id="btn-export-ics" data-itin-id="${itin.id}"><i class="fas fa-file-export"></i> ייצוא ליומן (.ics)</button>
        </div>
    `;

    const firstDayOfMonth = new Date(calendarCurrentYear, calendarCurrentMonth, 1);
    const lastDayOfMonth = new Date(calendarCurrentYear, calendarCurrentMonth + 1, 0);
    
    const startOffset = firstDayOfMonth.getDay();
    const totalDaysInMonth = lastDayOfMonth.getDate();

    const monthsHebrew = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    
    const monthHeader = `
        <div class="calendar-month-nav">
            <button class="cal-nav-btn" id="cal-prev-month"><i class="fas fa-chevron-right"></i></button>
            <h3 class="cal-month-title">${monthsHebrew[calendarCurrentMonth]} ${calendarCurrentYear}</h3>
            <button class="cal-nav-btn" id="cal-next-month"><i class="fas fa-chevron-left"></i></button>
        </div>
    `;

    const daysOfWeekHebrew = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
    const daysOfWeekHtml = `<div class="calendar-weekdays-row">` + 
        daysOfWeekHebrew.map(d => `<div class="cal-weekday-cell">${d}</div>`).join('') + 
        `</div>`;

    let gridCellsHtml = `<div class="calendar-grid-cells">`;
    
    for (let i = 0; i < startOffset; i++) {
        gridCellsHtml += `<div class="cal-day-cell empty"></div>`;
    }

    for (let dayNum = 1; dayNum <= totalDaysInMonth; dayNum++) {
        const dateStr = calendarCurrentYear + '-' + 
            String(calendarCurrentMonth + 1).padStart(2, '0') + '-' + 
            String(dayNum).padStart(2, '0');

        const dayIdx = itin.days.findIndex(d => d.date === dateStr);
        const isItinDay = dayIdx >= 0;
        const itinDay = isItinDay ? itin.days[dayIdx] : null;
        
        const holidays = jewishHolidaysMap[dateStr] || [];
        
        let cellClass = 'cal-day-cell';
        let cellContent = `<span class="cal-day-number">${dayNum}</span>`;
        let style = '';

        if (isItinDay) {
            cellClass += ' itin-day-active';
            style = `background-color: ${itin.color}15; border-color: ${itin.color};`;
            
            const dayNumberInItin = dayIdx + 1;
            const linkedPlaces = itinDay.placeIds
                .map(pid => (places ? places.find(p => p.id === pid) : null))
                .filter(Boolean);

            cellContent += `
                <div class="cal-itin-day-info">
                    <span class="cal-itin-day-num" style="color: ${itin.color}">יום ${dayNumberInItin}</span>
                    <span class="cal-itin-day-title">${itinDay.title || 'יום ללא כותרת'}</span>
                </div>
                <div class="cal-itin-icons">
                    ${itinDay.gpxPlaceId ? (() => {
                        const gpxP = places ? places.find(p => p.id === itinDay.gpxPlaceId) : null;
                        if (!gpxP) return '';
                        const hasRange = (itinDay.gpxStartKm !== undefined && itinDay.gpxStartKm !== null) || (itinDay.gpxEndKm !== undefined && itinDay.gpxEndKm !== null);
                        const start = (itinDay.gpxStartKm !== undefined && itinDay.gpxStartKm !== null) ? itinDay.gpxStartKm : 0;
                        const end = (itinDay.gpxEndKm !== undefined && itinDay.gpxEndKm !== null) ? itinDay.gpxEndKm : 99999;
                        const rangeText = hasRange ? ` [ק"מ ${start.toFixed(1)}–${end === 99999 ? 'סוף' : end.toFixed(1)}]` : '';
                        return `<span class="cal-place-link cal-gpx" data-place-id="${gpxP.id}" title="מסלול GPX: ${gpxP.name}${rangeText}"><i class="fas fa-route"></i> ${gpxP.name}${rangeText}</span>`;
                    })() : ''}
                    
                    ${linkedPlaces.map(p => `
                        <span class="cal-place-link" data-place-id="${p.id}" title="${p.name}">
                            <i class="fas fa-map-pin"></i> ${p.name}
                        </span>
                    `).join('')}
                    
                    ${itinDay.links.length > 0 ? `<i class="fas fa-link" title="${itinDay.links.length} קישורים חיצוניים"></i>` : ''}
                </div>
            `;
        }

        if (holidays.length > 0) {
            cellClass += ' has-holiday';
            cellContent += `<div class="cal-day-holiday" title="${holidays.join(', ')}">${holidays[0]}</div>`;
        }

        gridCellsHtml += `
            <div class="${cellClass}" style="${style}" data-date="${dateStr}" data-itin-day-active="${isItinDay}">
                ${cellContent}
            </div>
        `;
    }

    gridCellsHtml += `</div>`;

    const headerHtml = `
        <div class="gantt-header">
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%; flex-wrap:wrap; gap:10px;">
                ${backBtn}
                ${viewSelector}
            </div>
            <div class="gantt-title-row" style="margin-top: 14px; justify-content: space-between;">
                <div style="display:flex; align-items:center; gap:12px;">
                    <div class="gantt-title-color" style="background: ${itin.color}"></div>
                    <h2 class="gantt-title">${itin.name}</h2>
                    <span class="gantt-dates">${formatDateHebrew(itin.startDate)} – ${formatDateHebrew(itin.endDate)}</span>
                </div>
                ${actionsRow}
            </div>
        </div>
    `;

    const calendarBodyHtml = `
        <div class="calendar-view-wrapper">
            ${monthHeader}
            ${daysOfWeekHtml}
            ${gridCellsHtml}
        </div>
    `;

    ganttContainer.innerHTML = headerHtml + calendarBodyHtml;

    bindGanttHeaderEvents(itineraryId);

    document.getElementById('cal-prev-month').addEventListener('click', () => {
        let prevMonth = calendarCurrentMonth - 1;
        let prevYear = calendarCurrentYear;
        if (prevMonth < 0) {
            prevMonth = 11;
            prevYear--;
        }
        renderCalendarView(itineraryId, prevYear, prevMonth);
    });

    document.getElementById('cal-next-month').addEventListener('click', () => {
        let nextMonth = calendarCurrentMonth + 1;
        let nextYear = calendarCurrentYear;
        if (nextMonth > 11) {
            nextMonth = 0;
            nextYear++;
        }
        renderCalendarView(itineraryId, nextYear, nextMonth);
    });

    ganttContainer.querySelectorAll('.cal-day-cell.itin-day-active').forEach(cell => {
        cell.addEventListener('click', () => {
            const dateStr = cell.dataset.date;
            openDayEditModal(itineraryId, dateStr);
        });
    });

    document.getElementById('itinerary-list-wrapper').style.display = 'none';
    ganttContainer.style.display = '';

    bindGanttTimelineEvents(itineraryId);
}

// ============= Helper Functions for Binding Events =============
export function bindGanttHeaderEvents(itineraryId) {
    document.getElementById('itin-back-btn')?.addEventListener('click', () => {
        setActiveItineraryId(null);
        window.activeItineraryId = null;
        localStorage.removeItem('mytravel-active-itinerary-id');
        const ganttContainer = document.getElementById('gantt-container');
        if (ganttContainer) {
            ganttContainer.innerHTML = '';
            ganttContainer.style.display = 'none';
        }
        const listWrapper = document.getElementById('itinerary-list-wrapper');
        if (listWrapper) listWrapper.style.display = '';
        renderItineraryList();
        
        // Redraw route polylines to clear itinerary segments
        if (window.drawAllGpxTracks) window.drawAllGpxTracks();
        if (isOfflineMode) syncLeafletView();
    });

    document.querySelectorAll('.view-opt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            setCurrentItineraryView(view);
            localStorage.setItem('mytravel-itinerary-view', view);
            renderGanttView(itineraryId);
        });
    });

    document.getElementById('btn-edit-itin-dates')?.addEventListener('click', () => {
        openEditItineraryDatesModal(itineraryId);
    });

    document.getElementById('btn-export-ics')?.addEventListener('click', () => {
        const itin = getItineraryById(itineraryId);
        if (itin) {
            exportItineraryToICS(itin);
            showToast("קובץ היומן (.ics) יוצר והורד!", "success");
        }
    });
}

export function bindGanttTimelineEvents(itineraryId) {
    const ganttContainer = document.getElementById('gantt-container');
    if (!ganttContainer) return;

    ganttContainer.querySelectorAll('.gantt-day-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openDayEditModal(btn.dataset.itinId, btn.dataset.date);
        });
    });

    ganttContainer.querySelectorAll('.gantt-day-gpx, .gantt-place-chip, .cal-place-link').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const placeId = el.dataset.placeId;
            if (placeId && typeof window.focusPlaceOnMap === 'function') {
                window.focusPlaceOnMap(placeId);
            }
        });
    });
}

// ============= Jewish Holidays & Hebcal API Integration =============
export async function loadJewishHolidaysForYear(year) {
    const key = `mytravel-holidays-${year}`;
    const stored = localStorage.getItem(key);
    if (stored) {
        try {
            const events = JSON.parse(stored);
            events.forEach(ev => {
                if (!jewishHolidaysMap[ev.date]) jewishHolidaysMap[ev.date] = [];
                if (!jewishHolidaysMap[ev.date].includes(ev.title)) {
                    jewishHolidaysMap[ev.date].push(ev.title);
                }
            });
            return;
        } catch (e) {}
    }
    
    try {
        const res = await fetch(`https://www.hebcal.com/hebcal?cfg=json&v=1&maj=on&min=on&mod=on&year=${year}&month=all&yt=G&lg=he`);
        if (res.ok) {
            const data = await res.json();
            if (data.events) {
                localStorage.setItem(key, JSON.stringify(data.events));
                data.events.forEach(ev => {
                    if (!jewishHolidaysMap[ev.date]) jewishHolidaysMap[ev.date] = [];
                    if (!jewishHolidaysMap[ev.date].includes(ev.title)) {
                        jewishHolidaysMap[ev.date].push(ev.title);
                    }
                });
                if (activeItineraryId) {
                    renderGanttView(activeItineraryId);
                }
            }
        }
    } catch (e) {
        console.warn("Could not load Jewish holidays for year", year, e);
    }
}

export async function enrichItineraryWithHolidays(itin) {
    try {
        const startYear = new Date(itin.startDate + 'T00:00:00').getFullYear();
        const endYear = new Date(itin.endDate + 'T00:00:00').getFullYear();
        const years = Array.from(new Set([startYear, endYear]));
        
        const allEvents = [];
        for (const yr of years) {
            const key = `mytravel-holidays-${yr}`;
            let yearEvents = null;
            const stored = localStorage.getItem(key);
            if (stored) {
                try { yearEvents = JSON.parse(stored); } catch(e) {}
            }
            if (!yearEvents) {
                const res = await fetch(`https://www.hebcal.com/hebcal?cfg=json&v=1&maj=on&min=on&mod=on&year=${yr}&month=all&yt=G&lg=he`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.events) {
                        localStorage.setItem(key, JSON.stringify(data.events));
                        yearEvents = data.events;
                    }
                }
            }
            if (yearEvents) {
                allEvents.push(...yearEvents);
            }
        }
        
        let updated = false;
        itin.days.forEach(day => {
            const dayEvents = allEvents.filter(ev => ev.date === day.date);
            if (dayEvents.length > 0) {
                const holidayTitles = dayEvents.map(ev => ev.title);
                if (JSON.stringify(day.holidays) !== JSON.stringify(holidayTitles)) {
                    day.holidays = holidayTitles;
                    updated = true;
                }
            }
        });
        
        if (updated) {
            saveItineraries();
            syncItineraryToFirebase(itin);
            if (activeItineraryId === itin.id) {
                renderGanttView(itin.id);
            }
        }
    } catch (e) {
        console.warn("Could not load Jewish holidays (offline or network error):", e);
    }
}

// ============= Edit Itinerary Dates & Resizing =============
export function updateItineraryDates(itineraryId, newStartDate, newEndDate) {
    const itin = itineraries.find(it => it.id === itineraryId);
    if (!itin) return;

    const oldStart = new Date(itin.startDate + 'T00:00:00');
    const newStart = new Date(newStartDate + 'T00:00:00');
    const newEnd = new Date(newEndDate + 'T00:00:00');

    const timeDiff = newStart.getTime() - oldStart.getTime();
    const dayShift = Math.round(timeDiff / (1000 * 60 * 60 * 24));

    const shiftedDaysMap = new Map();
    itin.days.forEach(day => {
        const d = new Date(day.date + 'T00:00:00');
        d.setDate(d.getDate() + dayShift);
        const newDateStr = d.toISOString().split('T')[0];
        shiftedDaysMap.set(newDateStr, day);
    });

    const newDays = [];
    for (let d = new Date(newStart); d <= newEnd; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        if (shiftedDaysMap.has(dateStr)) {
            const oldDayData = shiftedDaysMap.get(dateStr);
            oldDayData.date = dateStr;
            newDays.push(oldDayData);
        } else {
            newDays.push({
                date: dateStr,
                title: '',
                notes: '',
                links: [],
                placeIds: [],
                gpxPlaceId: '',
                color: ''
            });
        }
    }

    itin.startDate = newStartDate;
    itin.endDate = newEndDate;
    itin.days = newDays;

    saveItineraries();
    syncItineraryToFirebase(itin);
    enrichItineraryWithHolidays(itin);
    
    setCalendarCurrentYear(null);
    setCalendarCurrentMonth(null);

    if (activeItineraryId === itineraryId) {
        renderGanttView(itineraryId);
    }
}

export function openEditItineraryDatesModal(itineraryId) {
    const itin = getItineraryById(itineraryId);
    if (!itin) return;

    const modal = document.getElementById('edit-itin-dates-modal-overlay');
    if (!modal) return;

    document.getElementById('edit-itin-start').value = itin.startDate;
    document.getElementById('edit-itin-end').value = itin.endDate;

    const warningEl = document.getElementById('edit-itin-warning');
    if (warningEl) warningEl.style.display = 'none';

    modal.dataset.itinId = itineraryId;

    const checkWarning = () => {
        const newStartStr = document.getElementById('edit-itin-start').value;
        const newEndStr = document.getElementById('edit-itin-end').value;
        if (!newStartStr || !newEndStr) return;

        const newStart = new Date(newStartStr + 'T00:00:00');
        const newEnd = new Date(newEndStr + 'T00:00:00');
        const oldStart = new Date(itin.startDate + 'T00:00:00');

        if (!isNaN(newStart) && !isNaN(newEnd)) {
            const timeDiff = newStart.getTime() - oldStart.getTime();
            const dayShift = Math.round(timeDiff / (1000 * 60 * 60 * 24));

            const shiftedDates = itin.days.map(day => {
                const d = new Date(day.date + 'T00:00:00');
                d.setDate(d.getDate() + dayShift);
                return d.toISOString().split('T')[0];
            });

            const lostDays = itin.days.filter((day, idx) => {
                const shiftedDateStr = shiftedDates[idx];
                const shiftedDate = new Date(shiftedDateStr + 'T00:00:00');
                const isOutside = shiftedDate < newStart || shiftedDate > newEnd;
                
                const hasContent = day.title || day.notes || day.links.length > 0 || day.placeIds.length > 0 || day.gpxPlaceId;
                return isOutside && hasContent;
            });

            if (lostDays.length > 0) {
                warningEl.style.display = 'block';
            } else {
                warningEl.style.display = 'none';
            }
        }
    };

    document.getElementById('edit-itin-start').onchange = checkWarning;
    document.getElementById('edit-itin-end').onchange = checkWarning;

    modal.classList.add('active');
}

export function closeEditItineraryDatesModal() {
    const modal = document.getElementById('edit-itin-dates-modal-overlay');
    if (modal) modal.classList.remove('active');
}

export function submitEditItineraryDates() {
    const modal = document.getElementById('edit-itin-dates-modal-overlay');
    if (!modal) return;

    const itineraryId = modal.dataset.itinId;
    const newStart = document.getElementById('edit-itin-start').value;
    const newEnd = document.getElementById('edit-itin-end').value;

    if (!newStart || !newEnd) {
        showToast('נא להזין תאריכי התחלה וסיום', 'error');
        return;
    }
    if (new Date(newStart) > new Date(newEnd)) {
        showToast('תאריך ההתחלה חייב להיות לפני תאריך הסיום', 'error');
        return;
    }

    const daysDiff = Math.ceil((new Date(newEnd) - new Date(newStart)) / (1000 * 60 * 60 * 24)) + 1;
    if (daysDiff > 60) {
        showToast('לוח זמנים מוגבל ל-60 ימים מקסימום', 'error');
        return;
    }

    updateItineraryDates(itineraryId, newStart, newEnd);
    closeEditItineraryDatesModal();
    showToast('תאריכי הטיול עודקנו בהצלחה!', 'success');
}

// ============= iCalendar (.ics) Export =============
export function exportItineraryToICS(itin) {
    let icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Bialiks Travels//ItineraryPlanner//HE',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH'
    ];

    itin.days.forEach((day, idx) => {
        const dayNum = idx + 1;
        const summary = `יום ${dayNum}: ${day.title || itin.name}`;
        
        let descParts = [];
        if (day.notes) descParts.push(day.notes);
        
        if (day.placeIds && day.placeIds.length > 0 && places) {
            const placesNames = day.placeIds
                .map(pid => places.find(p => p.id === pid))
                .filter(Boolean)
                .map(p => p.name);
            if (placesNames.length > 0) {
                descParts.push(`מקומות: ${placesNames.join(', ')}`);
            }
        }
        
        if (day.links && day.links.length > 0) {
            descParts.push('קישורים:');
            day.links.forEach(lnk => {
                descParts.push(`- ${lnk.label || lnk.url}: ${lnk.url}`);
            });
        }
        
        const description = descParts.join('\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
        const dateRaw = day.date.replace(/-/g, '');
        
        const d = new Date(day.date + 'T00:00:00');
        d.setDate(d.getDate() + 1);
        const nextDateRaw = d.toISOString().split('T')[0].replace(/-/g, '');

        icsContent.push('BEGIN:VEVENT');
        icsContent.push(`UID:itin-${itin.id}-day-${dayNum}@bialikstravels.com`);
        icsContent.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`);
        icsContent.push(`DTSTART;VALUE=DATE:${dateRaw}`);
        icsContent.push(`DTEND;VALUE=DATE:${nextDateRaw}`);
        icsContent.push(`SUMMARY:${summary}`);
        icsContent.push(`DESCRIPTION:${description}`);
        icsContent.push('END:VEVENT');
    });

    icsContent.push('END:VCALENDAR');
    
    const blob = new Blob([icsContent.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `itinerary_${itin.name.replace(/\s+/g, '_')}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

export function toggleItineraryPanel() {
    const panel = document.getElementById('itinerary-panel');
    const btn = document.getElementById('btn-toggle-itinerary');
    const divider = document.getElementById('itin-map-divider');
    const container = document.querySelector('.app-container');
    if (!panel) return;
    
    const isVisible = panel.style.display === 'flex' || (window.innerWidth <= 900 && panel.style.display === 'block');
    if (isVisible) {
        panel.style.display = 'none';
        if (divider) divider.style.display = 'none';
        btn?.classList.remove('active');
        container?.classList.add('itin-hidden');
        localStorage.setItem('itinerary-panel-visible', 'false');
    } else {
        const isDesktop = window.innerWidth > 900;
        panel.style.display = isDesktop ? 'flex' : 'block';
        if (divider) divider.style.display = isDesktop ? 'block' : 'none';
        btn?.classList.add('active');
        container?.classList.remove('itin-hidden');
        localStorage.setItem('itinerary-panel-visible', 'true');
        renderItineraryList();
        if (activeItineraryId) {
            renderGanttView(activeItineraryId);
        }
    }
    if (typeof map !== 'undefined' && map) {
        setTimeout(() => google.maps.event.trigger(map, 'resize'), 50);
    }
}

// ============= Quick Add Place Logic inside Day Edit Modal =============
export async function handleQuickGmapsLinkImport() {
    const linkInput = document.getElementById('day-edit-quick-link');
    if (!linkInput) return;
    
    const urlText = linkInput.value.trim();
    if (!urlText) {
        showToast('אנא הדבק קישור תקין של Google Maps', 'error');
        return;
    }
    
    if (!urlText.startsWith('http://') && !urlText.startsWith('https://')) {
        showToast('קישור לא תקין, חייב להתחיל ב-http:// או https://', 'error');
        return;
    }
    
    showToast('מפענח את הקישור...', 'info');
    
    try {
        let longUrl = urlText;
        
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
        
        document.getElementById('day-edit-quick-url').value = urlText;
        
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
                    
                    document.getElementById('day-edit-quick-name').value = place.name;
                    document.getElementById('day-edit-quick-lat').value = placeLat.toFixed(6);
                    document.getElementById('day-edit-quick-lng').value = placeLng.toFixed(6);
                    
                    showToast('המיקום נטען בהצלחה!', 'success');
                    linkInput.value = '';
                } else {
                    if (lat && lng) {
                        reverseGeocodeQuickCoords(lat, lng, queryName);
                    } else {
                        showToast(`לא נמצאו תוצאות בגוגל עבור "${queryName}"`, 'error');
                    }
                }
            });
        } else if (lat && lng) {
            reverseGeocodeQuickCoords(lat, lng, null);
        }
    } catch (error) {
        showToast(`שגיאה בפענוח הקישור: ${error.message}`, 'error');
    }
}

export function reverseGeocodeQuickCoords(lat, lng, fallbackName) {
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
        if (status === 'OK' && results[0]) {
            const address = results[0].formatted_address;
            document.getElementById('day-edit-quick-name').value = fallbackName || results[0].address_components[0].long_name || address;
            document.getElementById('day-edit-quick-lat').value = lat.toFixed(6);
            document.getElementById('day-edit-quick-lng').value = lng.toFixed(6);
            showToast('המיקום נטען בהצלחה!', 'success');
            document.getElementById('day-edit-quick-link').value = '';
        } else {
            document.getElementById('day-edit-quick-name').value = fallbackName || `נקודה בציון דרך ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            document.getElementById('day-edit-quick-lat').value = lat.toFixed(6);
            document.getElementById('day-edit-quick-lng').value = lng.toFixed(6);
            showToast('המיקום נטען לפי קואורדינטות', 'success');
            document.getElementById('day-edit-quick-link').value = '';
        }
    });
}

export function submitQuickAddPlace() {
    const name = document.getElementById('day-edit-quick-name').value.trim();
    const lat = parseFloat(document.getElementById('day-edit-quick-lat').value);
    const lng = parseFloat(document.getElementById('day-edit-quick-lng').value);
    const googleUrl = document.getElementById('day-edit-quick-url').value.trim();

    if (!name) {
        showToast('נא לחפש מקום או להזין שם', 'error');
        return;
    }

    if (isNaN(lat) || isNaN(lng)) {
        showToast('נא לחפש מקום בגוגל או לטעון קישור', 'error');
        return;
    }

    const placeId = generateId();
    const links = [
        { url: googleUrl || `https://www.google.com/maps?q=${lat},${lng}`, label: 'Google Maps', type: 'google_maps' }
    ];

    const newPlace = {
        id: placeId,
        name,
        description: 'נוסף מהר דרך לוח הזמנים',
        lat,
        lng,
        customLabel: '',
        useCustomColor: false,
        customColor: '#E5B23A',
        images: [],
        links,
        groupId: '', 
        tags: ['לוח זמנים'],
        createdAt: Date.now()
    };

    places.push(newPlace);
    savePlaces();
    renderPlaces();
    if (window.renderMarkers) window.renderMarkers();

    if (window.IS_FIREBASE_CONFIGURED && window.db) {
        window.db.collection('places').doc(placeId).set(newPlace)
            .catch(err => console.error("Error syncing quick place to Firebase:", err));
    }

    const placesListContainer = document.getElementById('day-edit-places-list');
    if (placesListContainer) {
        const checkedBoxes = placesListContainer.querySelectorAll('input[type="checkbox"]:checked');
        const selectedIds = Array.from(checkedBoxes).map(cb => cb.value);
        selectedIds.push(placeId);
        renderDayPlacesSelector(selectedIds);
    }

    const sec = document.getElementById('quick-add-place-section');
    if (sec) sec.style.display = 'none';

    showToast(`המקום "${name}" נוצר בהצלחה ושויך ליום זה!`, 'success');
}

export function updateGpxRangeUI(placeId, currentStart, currentEnd) {
    const rangeContainer = document.getElementById('day-edit-gpx-range-container');
    const infoText = document.getElementById('day-edit-gpx-info-text');
    const startInput = document.getElementById('day-edit-gpx-start-km');
    const endInput = document.getElementById('day-edit-gpx-end-km');

    if (!rangeContainer || !infoText || !startInput || !endInput) return;

    if (!placeId) {
        rangeContainer.style.display = 'none';
        infoText.style.display = 'none';
        startInput.value = '';
        endInput.value = '';
        return;
    }

    const place = places.find(p => p.id === placeId);

    if (place && place.gpxData && place.gpxData.length > 0) {
        const totalDist = place.gpxData[place.gpxData.length - 1].dist || 0;
        
        rangeContainer.style.display = 'grid';
        infoText.style.display = 'block';

        let html = `<div style="margin-bottom:6px;">אורך המסלול הכולל בקובץ זה: <strong>${totalDist.toFixed(2)} ק"מ</strong>.</div>`;

        let otherDaysHtml = '';
        const itin = getItineraryById(activeItineraryId);
        if (itin) {
            itin.days.forEach((day, idx) => {
                if (day.date !== editingDayDate && day.gpxPlaceId === placeId) {
                    const dayNum = idx + 1;
                    const start = (day.gpxStartKm !== undefined && day.gpxStartKm !== null) ? day.gpxStartKm : 0;
                    const end = (day.gpxEndKm !== undefined && day.gpxEndKm !== null) ? day.gpxEndKm : totalDist;
                    otherDaysHtml += `<li style="margin-bottom:3px; font-weight:bold;">יום ${dayNum}: ק"מ ${start.toFixed(1)} עד ק"מ ${end.toFixed(1)}</li>`;
                }
            });
        }

        if (otherDaysHtml) {
            html += `
                <div style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--border-light);">
                    <div style="font-size:11.5px; color:var(--accent-gold); font-weight:bold; margin-bottom:4px;"><i class="fas fa-info-circle"></i> מקטעים שכבר חולקו בימים אחרים:</div>
                    <ul style="margin:0; padding-right:16px; font-size:11.5px; color:var(--text-secondary); list-style-type:disc;">
                        ${otherDaysHtml}
                    </ul>
                </div>
            `;
        } else {
            html += `<div style="font-size:11px; color:var(--text-muted); margin-top:4px;">טרם חילקת קילומטרים ממסלול זה לימים אחרים.</div>`;
        }

        infoText.innerHTML = html;

        startInput.value = currentStart !== undefined && currentStart !== null ? currentStart : '';
        endInput.value = currentEnd !== undefined && currentEnd !== null ? currentEnd : '';
    } else {
        rangeContainer.style.display = 'none';
        infoText.style.display = 'none';
        startInput.value = '';
        endInput.value = '';
    }
}

export function shiftItineraryDays(itineraryId, fromDateStr, shiftDays) {
    const itin = getItineraryById(itineraryId);
    if (!itin || !fromDateStr || shiftDays <= 0) return;

    itin.days.forEach(day => {
        if (day.date >= fromDateStr) {
            const d = new Date(day.date + 'T00:00:00');
            d.setDate(d.getDate() + shiftDays);
            day.date = d.toISOString().split('T')[0];
        }
    });

    const endD = new Date(itin.endDate + 'T00:00:00');
    endD.setDate(endD.getDate() + shiftDays);
    itin.endDate = endD.toISOString().split('T')[0];

    const startDate = new Date(itin.startDate + 'T00:00:00');
    const endDate = new Date(itin.endDate + 'T00:00:00');
    const existingDaysMap = {};
    itin.days.forEach(day => {
        existingDaysMap[day.date] = day;
    });

    const newDays = [];
    let current = new Date(startDate);
    while (current <= endDate) {
        const dateStr = current.toISOString().split('T')[0];
        if (existingDaysMap[dateStr]) {
            newDays.push(existingDaysMap[dateStr]);
        } else {
            newDays.push({
                date: dateStr,
                title: '',
                notes: '',
                links: [],
                placeIds: [],
                gpxPlaceId: '',
                gpxStartKm: null,
                gpxEndKm: null
            });
        }
        current.setDate(current.getDate() + 1);
    }

    itin.days = newDays;

    saveItineraries();
    syncItineraryToFirebase(itin);

    renderGanttView(itineraryId);
    showToast(`הימים הוזזו קדימה ב-${shiftDays} ימים בהצלחה!`, 'success');
}

export function swapItineraryDays(itineraryId, date1, date2) {
    const itin = getItineraryById(itineraryId);
    if (!itin || !date1 || !date2 || date1 === date2) return;

    const day1 = itin.days.find(d => d.date === date1);
    const day2 = itin.days.find(d => d.date === date2);

    if (!day1 || !day2) return;

    const temp = {
        title: day1.title,
        notes: day1.notes,
        links: JSON.parse(JSON.stringify(day1.links || [])),
        placeIds: JSON.parse(JSON.stringify(day1.placeIds || [])),
        gpxPlaceId: day1.gpxPlaceId,
        gpxStartKm: day1.gpxStartKm,
        gpxEndKm: day1.gpxEndKm
    };

    day1.title = day2.title;
    day1.notes = day2.notes;
    day1.links = JSON.parse(JSON.stringify(day2.links || []));
    day1.placeIds = JSON.parse(JSON.stringify(day2.placeIds || []));
    day1.gpxPlaceId = day2.gpxPlaceId;
    day1.gpxStartKm = day2.gpxStartKm;
    day1.gpxEndKm = day2.gpxEndKm;

    day2.title = temp.title;
    day2.notes = temp.notes;
    day2.links = temp.links;
    day2.placeIds = temp.placeIds;
    day2.gpxPlaceId = temp.gpxPlaceId;
    day2.gpxStartKm = temp.gpxStartKm;
    day2.gpxEndKm = temp.gpxEndKm;

    saveItineraries();
    syncItineraryToFirebase(itin);

    renderGanttView(itineraryId);
    showToast('התוכן של הימים הוחלף בהצלחה!', 'success');
}

export function initItinerary() {
    loadItineraries();
    renderItineraryList();

    document.getElementById('btn-create-itinerary')?.addEventListener('click', openCreateItineraryModal);
    document.getElementById('create-itin-modal-close')?.addEventListener('click', closeCreateItineraryModal);
    document.getElementById('create-itin-cancel')?.addEventListener('click', closeCreateItineraryModal);
    document.getElementById('create-itin-submit')?.addEventListener('click', submitCreateItinerary);
    document.getElementById('create-itin-modal-overlay')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeCreateItineraryModal();
    });

    document.querySelectorAll('#create-itin-modal-overlay .itin-color-option').forEach(opt => {
        opt.addEventListener('click', () => {
            document.querySelectorAll('#create-itin-modal-overlay .itin-color-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
        });
    });

    document.getElementById('day-edit-modal-close')?.addEventListener('click', closeDayEditModal);
    document.getElementById('day-edit-cancel')?.addEventListener('click', closeDayEditModal);
    document.getElementById('day-edit-save')?.addEventListener('click', saveDayEdit);
    document.getElementById('day-edit-modal-overlay')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeDayEditModal();
    });
    document.getElementById('day-edit-add-link')?.addEventListener('click', addDayLink);

    document.getElementById('edit-itin-dates-modal-close')?.addEventListener('click', closeEditItineraryDatesModal);
    document.getElementById('edit-itin-dates-cancel')?.addEventListener('click', closeEditItineraryDatesModal);
    document.getElementById('edit-itin-dates-submit')?.addEventListener('click', submitEditItineraryDates);
    document.getElementById('edit-itin-dates-modal-overlay')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeEditItineraryDatesModal();
    });

    document.getElementById('btn-toggle-itinerary')?.addEventListener('click', toggleItineraryPanel);
    document.getElementById('btn-close-itin-panel')?.addEventListener('click', () => {
        const panel = document.getElementById('itinerary-panel');
        const btn = document.getElementById('btn-toggle-itinerary');
        const divider = document.getElementById('itin-map-divider');
        const container = document.querySelector('.app-container');
        if (panel) {
            panel.style.display = 'none';
            if (divider) divider.style.display = 'none';
            btn?.classList.remove('active');
            container?.classList.add('itin-hidden');
            localStorage.setItem('itinerary-panel-visible', 'false');
            if (typeof map !== 'undefined' && map) google.maps.event.trigger(map, 'resize');
        }
    });

    const itinVisible = localStorage.getItem('itinerary-panel-visible') !== 'false';
    const container = document.querySelector('.app-container');
    if (window.innerWidth > 900 && activeItineraryId && itinVisible) {
        const panel = document.getElementById('itinerary-panel');
        const btn = document.getElementById('btn-toggle-itinerary');
        const divider = document.getElementById('itin-map-divider');
        if (panel) {
            panel.style.display = 'flex';
            if (divider) divider.style.display = 'block';
            btn?.classList.add('active');
            container?.classList.remove('itin-hidden');
            renderGanttView(activeItineraryId);
        }
    } else {
        container?.classList.add('itin-hidden');
    }

    document.getElementById('btn-toggle-quick-add-place')?.addEventListener('click', () => {
        const sec = document.getElementById('quick-add-place-section');
        if (sec) {
            const isHidden = sec.style.display === 'none';
            sec.style.display = isHidden ? 'block' : 'none';
            if (isHidden) {
                document.getElementById('day-edit-quick-search').value = '';
                document.getElementById('day-edit-quick-link').value = '';
                document.getElementById('day-edit-quick-name').value = '';
                document.getElementById('day-edit-quick-lat').value = '';
                document.getElementById('day-edit-quick-lng').value = '';
                document.getElementById('day-edit-quick-url').value = '';
            }
        }
    });

    document.getElementById('btn-day-edit-quick-load-link')?.addEventListener('click', handleQuickGmapsLinkImport);
    document.getElementById('btn-day-edit-quick-add-submit')?.addEventListener('click', submitQuickAddPlace);

    document.getElementById('day-edit-gpx-select')?.addEventListener('change', (e) => {
        updateGpxRangeUI(e.target.value, null, null);
    });

    document.getElementById('btn-day-edit-shift-submit')?.addEventListener('click', () => {
        const modal = document.getElementById('day-edit-modal-overlay');
        if (!modal) return;
        const itineraryId = modal.dataset.itinId;
        const dateStr = modal.dataset.date;
        const shiftCountInput = document.getElementById('day-edit-shift-count');
        const shiftCount = parseInt(shiftCountInput?.value || '1');

        if (itineraryId && dateStr && shiftCount > 0) {
            if (confirm(`האם אתה בטוח שברצונך לדחות את יום זה ואת כל הימים הבאים אחריו ב-${shiftCount} ימים?`)) {
                shiftItineraryDays(itineraryId, dateStr, shiftCount);
                closeDayEditModal();
            }
        }
    });

    document.getElementById('btn-day-edit-swap-submit')?.addEventListener('click', () => {
        const modal = document.getElementById('day-edit-modal-overlay');
        if (!modal) return;
        const itineraryId = modal.dataset.itinId;
        const dateStr = modal.dataset.date;
        const swapTargetSelect = document.getElementById('day-edit-swap-target');
        const targetDate = swapTargetSelect?.value;

        if (itineraryId && dateStr && targetDate) {
            if (confirm("האם אתה בטוח שברצונך להחליף את התוכן של שני הימים האלו?")) {
                swapItineraryDays(itineraryId, dateStr, targetDate);
                closeDayEditModal();
            }
        }
    });
}
