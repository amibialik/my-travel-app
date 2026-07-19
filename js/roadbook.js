import {
    map, setMap,
    places,
    activeMarkerId,
    savePlaces
} from './state.js';

import {
    getPlaceColor,
    getPoiEmoji,
    getPoiLabel,
    escapeHtml,
    showToast,
    renderPlaces
} from './ui.js';

import { getDistance } from './map.js';
import { syncPlaceToFirebase } from './db.js';

// ============= Roadbook & Measurement State =============
export let measureActivePlace = null;
export let measurePoints = []; // [{ lat, lng, index, label }]
export let measureMarkers = []; // Marker instances
export let measurePreviewPolylines = []; // Polyline instances
export let measureResections = []; // [{ fromPointIndex, landmarkName, lat, lng, azimuth, distanceMeters }]
export let measureResectionMarkers = []; // Resection landmark markers
export let measureResectionLines = []; // Resection dotted lines
export let measureLegsData = []; // [{ description, notes }]
export let isResectionActive = false;
export let activeResectionFromIndex = -1;
export let measureMapClickListener = null;
export let editingRoadbookId = null;

// Helpers to modify state values (since ES modules don't allow modifying imports directly)
export function setMeasureActivePlace(val) { measureActivePlace = val; }
export function setMeasurePoints(val) { measurePoints = val; }
export function setMeasureMarkers(val) { measureMarkers = val; }
export function setMeasurePreviewPolylines(val) { measurePreviewPolylines = val; }
export function setMeasureResections(val) { measureResections = val; }
export function setMeasureResectionMarkers(val) { measureResectionMarkers = val; }
export function setMeasureResectionLines(val) { measureResectionLines = val; }
export function setMeasureLegsData(val) { measureLegsData = val; }
export function setIsResectionActive(val) { isResectionActive = val; }
export function setActiveResectionFromIndex(val) { activeResectionFromIndex = val; }
export function setMeasureMapClickListener(val) { measureMapClickListener = val; }
export function setEditingRoadbookId(val) { editingRoadbookId = val; }

export function calculateAzimuth(lat1, lng1, lat2, lng2) {
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

export function getDirectionString(azimuth) {
    const directions = [
        'צפון', 'צפון-צפון-מזרח', 'צפון-מזרח', 'מזרח-צפון-מזרח',
        'מזרח', 'מזרח-דרום-מזרח', 'דרום-מזרח', 'דרום-דרום-מזרח',
        'דרום', 'דרום-דרום-מערב', 'דרום-מערב', 'מערב-דרום-מערב',
        'מערב', 'מערב-צפון-מערב', 'צפון-מערב', 'צפון-צפון-מערב'
    ];
    const index = Math.round(azimuth / 22.5) % 16;
    return directions[index];
}

export function getMeasureMarkerIcon(pt, place) {
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

export function updateMeasureMarkers(place) {
    measureMarkers.forEach((marker, idx) => {
        const pt = measurePoints[idx];
        if (pt) {
            marker.setIcon(getMeasureMarkerIcon(pt, place));
        }
    });
}

// Open measurement / roadbook creation bar
export function openMeasurementControlBar(place, skipReset = false) {
    if (!skipReset) {
        closeMeasurementControlBar();
        if (window.closeRecordingControlBar) window.closeRecordingControlBar();

        setMeasureActivePlace(place);
        setEditingRoadbookId(null);

        setMeasurePoints([]);
        setMeasureMarkers([]);
        setMeasurePreviewPolylines([]);
        setMeasureResections([]);
        setMeasureResectionMarkers([]);
        setMeasureResectionLines([]);
        setMeasureLegsData([]);
        setIsResectionActive(false);
        setActiveResectionFromIndex(-1);
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
    const listener = map.addListener('click', (e) => {
        if (isResectionActive && activeResectionFromIndex !== -1) {
            const landmarkName = prompt("הזן את שם האלמנט הבולט בשטח (למשל: אנטנה ראשית, מגדל מים, פסגה):");
            if (!landmarkName) {
                setIsResectionActive(false);
                setActiveResectionFromIndex(-1);
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

            setIsResectionActive(false);
            setActiveResectionFromIndex(-1);

            updateMeasureLegsList(place);
            showToast('נקודת הזדטרות נדגמה בהצלחה!', 'success');
            return;
        }

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

        const marker = new google.maps.Marker({
            position: { lat: pt.lat, lng: pt.lng },
            map: map,
            zIndex: 3000,
            draggable: true,
            icon: getMeasureMarkerIcon(newPoint, place)
        });

        measureMarkers.push(marker);

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

    setMeasureMapClickListener(listener);

    const bounds = new google.maps.LatLngBounds();
    gpxPoints.forEach(pt => bounds.extend(pt));
    map.fitBounds(bounds);
    showToast('כלי המדידה וסיפור הדרך פעיל! בחר נקודות על המפה לאורך המסלול.', 'info');
}

export function updateMeasurePreviewLines(gpxPoints) {
    measurePreviewPolylines.forEach(p => p.setMap(null));
    setMeasurePreviewPolylines([]);

    if (measurePoints.length < 2) return;
    const newPolys = [];

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

        newPolys.push(poly);
    }
    setMeasurePreviewPolylines(newPolys);
}

export function startResectionLandmarkSelection(pointIdx) {
    setIsResectionActive(true);
    setActiveResectionFromIndex(pointIdx);

    const inst = document.getElementById('measure-instructions');
    if (inst) {
        inst.innerHTML = `<i class="fas fa-crosshairs fa-spin" style="color:var(--accent-rose);"></i> <strong>מצב הזדטרות פעיל:</strong> לחץ על המפה לסימון אלמנט בולט בשטח מהסיכה ה-${pointIdx + 1}.`;
        inst.style.background = 'rgba(244, 63, 94, 0.08)';
        inst.style.borderRightColor = 'var(--accent-rose)';
    }
    showToast('בחר אלמנט בולט במפה (בית, מגדל, אנטנה וכו\')', 'info');
}

export function drawResectionOnMap(ptFrom, ptTo, resectionItem) {
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

export function redrawAllResections() {
    measureResectionLines.forEach(l => l.setMap(null));
    measureResectionMarkers.forEach(m => m.setMap(null));
    setMeasureResectionLines([]);
    setMeasureResectionMarkers([]);

    measureResections.forEach(res => {
        const ptFrom = measurePoints[res.fromPointIndex];
        const ptTo = { lat: res.lat, lng: res.lng };
        if (ptFrom) {
            drawResectionOnMap(ptFrom, ptTo, res);
        }
    });
}

export function deleteResectionLandmark(pointIdx, resIdx) {
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

export function updateMeasureLegsList(place) {
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

    // Event binding helpers
    bindLegEvents(listDiv, place);
}

function bindLegEvents(listDiv, place) {
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
                    if (window.compressImage) {
                        window.compressImage(re.target.result, (compressed) => {
                            pt.poi.image = compressed;
                            updateMeasureLegsList(place);
                            showToast("תמונת נקודת העניין נוספה בהצלחה!", "success");
                        });
                    } else {
                        pt.poi.image = re.target.result;
                        updateMeasureLegsList(place);
                        showToast("תמונת נקודת העניין נוספה בהצלחה!", "success");
                    }
                };
                reader.readAsDataURL(file);
                document.body.removeChild(fileInput);
            };

            fileInput.click();
        };
    });

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

    listDiv.querySelectorAll('.btn-add-resection').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const ptIdx = parseInt(btn.dataset.pointIdx);
            startResectionLandmarkSelection(ptIdx);
        };
    });

    listDiv.querySelectorAll('.btn-delete-resection').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const ptIdx = parseInt(btn.dataset.pointIdx);
            const resIdx = parseInt(btn.dataset.resIdx);

            const ptResections = measureResections.filter(r => r.fromPointIndex === ptIdx);
            const targetRes = ptResections[resIdx];
            if (targetRes) {
                const index = measureResections.indexOf(targetRes);
                if (index > -1) {
                    measureResections.splice(index, 1);
                    redrawAllResections();
                    updateMeasureLegsList(place);
                    showToast('נקודת הזדטרות נמחקה', 'info');
                }
            }
        };
    });

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
                setEditingRoadbookId(null);
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

export function resetMeasurementSelection() {
    measureMarkers.forEach(m => m.setMap(null));
    setMeasureMarkers([]);
    measurePreviewPolylines.forEach(p => p.setMap(null));
    setMeasurePreviewPolylines([]);
    measureResectionLines.forEach(l => l.setMap(null));
    setMeasureResectionLines([]);
    measureResectionMarkers.forEach(m => m.setMap(null));
    setMeasureResectionMarkers([]);

    setMeasurePoints([]);
    setMeasureResections([]);
    setMeasureLegsData([]);
    setIsResectionActive(false);
    setActiveResectionFromIndex(-1);

    const inst = document.getElementById('measure-instructions');
    if (inst) {
        inst.style.background = 'var(--primary-bg)';
        inst.style.borderRightColor = 'var(--primary)';
        inst.innerHTML = '<i class="fas fa-mouse-pointer" style="margin-left:5px;"></i> לחץ על המפה סמוך למסלול לקביעת נקודת התחלה';
    }

    updateMeasureLegsList(measureActivePlace);
}

export function closeMeasurementControlBar() {
    resetMeasurementSelection();

    if (measureMapClickListener) {
        google.maps.event.removeListener(measureMapClickListener);
        setMeasureMapClickListener(null);
    }

    const bar = document.getElementById('measurement-control-bar');
    if (bar) bar.remove();

    setMeasureActivePlace(null);
}

export function findNearestGpxPoint(latLng, gpxPoints) {
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

// Get elevation profile segment stats (gain / loss)
export function getSegmentStats(place, startIdx, endIdx) {
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

// ============= Roadbook Modal Display & Exports =============
export function openRoadbookModal(place, roadbook) {
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

export function closeRoadbookModal() {
    const modal = document.getElementById('roadbook-modal');
    if (modal) modal.classList.remove('active');
}

export function deleteRoadbook(placeId, rbId) {
    const place = places.find(p => p.id === placeId);
    if (!place || !place.roadbooks) return;

    place.roadbooks = place.roadbooks.filter(r => r.id !== rbId);
    savePlaces();
    syncPlaceToFirebase(place);
    renderPlaces();
    showToast('סיפור הדרך נמחק בהצלחה', 'success');
}

export function loadRoadbookToEditor(place, roadbook) {
    closeMeasurementControlBar();
    if (window.closeRecordingControlBar) window.closeRecordingControlBar();

    setMeasureActivePlace(place);
    setEditingRoadbookId(roadbook.id);

    setMeasurePoints(JSON.parse(JSON.stringify(roadbook.points || [])));
    setMeasureResections(JSON.parse(JSON.stringify(roadbook.resections || [])));
    setMeasureLegsData(JSON.parse(JSON.stringify(roadbook.legs || [])));

    openMeasurementControlBar(place, true);

    const nameInput = document.getElementById('measure-roadbook-name');
    if (nameInput) {
        nameInput.value = roadbook.name;
    }

    const gpxPoints = place.gpxData || [];
    const newMarkersList = [];

    measurePoints.forEach((pt) => {
        const marker = new google.maps.Marker({
            position: { lat: pt.lat, lng: pt.lng },
            map: map,
            zIndex: 3000,
            draggable: true,
            icon: getMeasureMarkerIcon(pt, place)
        });
        newMarkersList.push(marker);

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
    setMeasureMarkers(newMarkersList);

    updateMeasurePreviewLines(gpxPoints);
    redrawAllResections();
    updateMeasureLegsList(place);
    showToast(`טוען את סיפור הדרך "${roadbook.name}" לעריכה!`, 'info');
}

export function downloadRoadbookCsv(roadbook, place) {
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

export function exportPlaceToGpx(place) {
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
