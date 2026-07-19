import {
    places, setPlaces,
    groups,
    activeGroupId, setActiveGroupId,
    activeSubGroupId, setActiveSubGroupId,
    additionalGroupIds,
    additionalSubGroupIds,
    map, setMap,
    markers, setMarkers,
    activeMarkerId, setActiveMarkerId,
    hoverMarker, setHoverMarker,
    kmMarkers, setKmMarkers,
    markerClustererInstance, setMarkerClustererInstance,
    slopeColoringEnabled, setSlopeColoringEnabled,
    slopePolylines, setSlopePolylines,
    kmMarkerMode,
    isTrackingUser, setIsTrackingUser,
    userLocationMarker, setUserLocationMarker,
    watchId, setWatchId,
    leafletMap, setLeafletMap,
    leafletPolylines, setLeafletPolylines,
    leafletMarkers, setLeafletMarkers,
    leafletUserMarker, setLeafletUserMarker,
    isOfflineMode, setIsOfflineMode,
    itineraries,
    getFilteredPlaces, getGroupById,
    DEFAULT_CENTER, DEFAULT_ZOOM
} from './state.js';

import { customMapStyle, darkMapStyle } from './map-styles.js';

import {
    showGooglePlaceDetails,
    closeGooglePlacePanel,
    renderPlaces,
    getPlaceColor,
    escapeHtml,
    getPoiEmoji,
    showToast
} from './ui.js';

// ============= Map Initialization =============
export function initMap() {
    if (typeof google === 'undefined' || !google.maps) return;

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
    
    const newMap = new google.maps.Map(document.getElementById('map'), mapOptions);
    setMap(newMap);

    newMap.addListener('zoom_changed', () => {
        if (kmMarkerMode === 'dynamic') {
            drawKmMarkers();
        }
    });

    // Disable CSS sepia filter in satellite or hybrid views
    newMap.addListener('maptypeid_changed', () => {
        const type = newMap.getMapTypeId();
        const mapEl = document.getElementById('map');
        if (type === 'satellite' || type === 'hybrid') {
            mapEl.classList.add('no-filter');
        } else {
            mapEl.classList.remove('no-filter');
        }
    });

    // Disable CSS sepia filter in Street View mode
    const panorama = newMap.getStreetView();
    if (panorama) {
        panorama.addListener('visible_changed', () => {
            const mapEl = document.getElementById('map');
            if (panorama.getVisible()) {
                mapEl.classList.add('no-filter');
            } else {
                const type = newMap.getMapTypeId();
                if (type !== 'satellite' && type !== 'hybrid') {
                    mapEl.classList.remove('no-filter');
                }
            }
        });
    }

    // Initialize PlacesService
    const placesService = new google.maps.places.PlacesService(newMap);
    // Export globally for compatibility or local state
    window.placesService = placesService;

    // Click on map to show rich Google Place details for POIs
    newMap.addListener('click', (e) => {
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
    newMap.mapTypes.set('osm', osmMapType);

    const ihmMapType = new google.maps.ImageMapType({
        getTileUrl: function(coord, zoom) {
            return "https://tiles.israelhiking.osm.org.il/hiking/" + zoom + "/" + coord.x + "/" + coord.y + ".png";
        },
        tileSize: new google.maps.Size(256, 256),
        name: "IHM",
        maxZoom: 17
    });
    newMap.mapTypes.set('israel-hiking', ihmMapType);

    const topoMapType = new google.maps.ImageMapType({
        getTileUrl: function(coord, zoom) {
            return "https://a.tile.opentopomap.org/" + zoom + "/" + coord.x + "/" + coord.y + ".png";
        },
        tileSize: new google.maps.Size(256, 256),
        name: "Topo",
        maxZoom: 17
    });
    newMap.mapTypes.set('opentopo', topoMapType);

    const cyclOsmMapType = new google.maps.ImageMapType({
        getTileUrl: function(coord, zoom) {
            const servers = ['a', 'b', 'c'];
            const s = servers[Math.abs(coord.x + coord.y) % servers.length];
            return `https://${s}.tile-cyclosm.openstreetmap.fr/cyclosm/${zoom}/${coord.x}/${coord.y}.png`;
        },
        tileSize: new google.maps.Size(256, 256),
        name: 'CyclOSM',
        maxZoom: 20,
        attribution: '\u00a9 CyclOSM contributors, \u00a9 OpenStreetMap contributors'
    });
    newMap.mapTypes.set('cyclosm', cyclOsmMapType);

    // Waymarked Trails Hiking overlay
    const waymarkedHikingOverlay = new google.maps.ImageMapType({
        getTileUrl: function(coord, zoom) {
            return `https://tile.waymarkedtrails.org/hiking/${zoom}/${coord.x}/${coord.y}.png`;
        },
        tileSize: new google.maps.Size(256, 256),
        name: 'Waymarked Hiking',
        maxZoom: 19,
        opacity: 0.85
    });
    newMap._waymarkedHikingOverlay = waymarkedHikingOverlay;

    // Bind map layer UI controls
    bindMapLayerUIControls(newMap);
}

function bindMapLayerUIControls(gMap) {
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
                    setSlopeColoringEnabled(!slopeColoringEnabled);
                    const toggleLabel = opt.querySelector('.overlay-toggle-label');
                    if (slopeColoringEnabled) {
                        opt.classList.add('active');
                        if (toggleLabel) toggleLabel.textContent = 'פעיל';
                        drawSlopeColoredTracks();
                    } else {
                        opt.classList.remove('active');
                        if (toggleLabel) toggleLabel.textContent = 'כבוי';
                        slopePolylines.forEach(p => p.setMap(null));
                        setSlopePolylines([]);
                    }
                    return;
                }
                
                options.forEach(o => {
                    if (o.dataset.layer !== 'slope-colors' && o.dataset.layer !== 'waymarked-hiking') {
                        o.classList.remove('active');
                    }
                });
                opt.classList.add('active');
                
                if (layer === 'roadmap') {
                    gMap.setMapTypeId(google.maps.MapTypeId.ROADMAP);
                } else if (layer === 'terrain') {
                    gMap.setMapTypeId(google.maps.MapTypeId.TERRAIN);
                } else if (layer === 'satellite') {
                    gMap.setMapTypeId(google.maps.MapTypeId.SATELLITE);
                } else if (layer === 'hybrid') {
                    gMap.setMapTypeId(google.maps.MapTypeId.HYBRID);
                } else if (layer === 'osm') {
                    gMap.setMapTypeId('osm');
                } else if (layer === 'israel-hiking') {
                    gMap.setMapTypeId('israel-hiking');
                } else if (layer === 'opentopo') {
                    gMap.setMapTypeId('opentopo');
                } else if (layer === 'cyclosm') {
                    gMap.setMapTypeId('cyclosm');
                } else if (layer === 'waymarked-hiking') {
                    const overlays = gMap.overlayMapTypes;
                    const existingIdx = overlays.getArray().findIndex(
                        o => o && o.name === 'Waymarked Hiking'
                    );
                    const toggleLabel = opt.querySelector('.overlay-toggle-label');
                    if (existingIdx !== -1) {
                        overlays.removeAt(existingIdx);
                        opt.classList.remove('active');
                        if (toggleLabel) toggleLabel.textContent = 'כבוי';
                    } else {
                        overlays.push(gMap._waymarkedHikingOverlay);
                        opt.classList.add('active');
                        if (toggleLabel) toggleLabel.textContent = 'פעיל';
                    }
                    return;
                }
                layerController.classList.remove('active');
            });
        });
    }
}

// ============= Markers Rendering =============
export function renderMarkers() {
    if (typeof google === 'undefined' || !google.maps || !map) return;
    
    // Clear existing markers
    markers.forEach(m => m.setMap(null));
    setMarkers([]);

    if (markerClustererInstance) {
        markerClustererInstance.clearMarkers();
    }

    const filtered = getFilteredPlaces();
    const hasClusterer = typeof markerClusterer !== 'undefined' && markerClusterer.MarkerClusterer;
    const newMarkersList = [];

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
                setActiveSubGroupId(placeGroup.id);
                // Dispatch event or call tab render
                const tab = document.querySelector(`.group-tab[data-group-id="${placeGroup.id}"]`);
                if (tab) tab.click();
            }
            scrollToCard(place.id);
            setActiveMarker(place.id, true);
            infoWindow.open(map, marker);
        });

        marker.placeId = place.id;
        newMarkersList.push(marker);
    });

    setMarkers(newMarkersList);

    if (hasClusterer && newMarkersList.length > 0) {
        const clusterer = new markerClusterer.MarkerClusterer({
            map: map,
            markers: newMarkersList,
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
        setMarkerClustererInstance(clusterer);
    }
}

export function fitMapBounds() {
    if (!map) return;
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

export function panToPlace(latOrPlace, lng) {
    let lat, lngVal, place;
    
    if (typeof latOrPlace === 'object' && latOrPlace !== null) {
        place = latOrPlace;
        lat = place.lat;
        lngVal = place.lng;
    } else {
        lat = latOrPlace;
        lngVal = lng;
        place = places.find(p => p.lat === lat && p.lng === lngVal);
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

// ============= GPX Tracks Drawing =============
export function drawAllGpxTracks() {
    if (typeof google === 'undefined' || !google.maps) return;
    
    if (activePolylines) {
        activePolylines.forEach(p => p.setMap(null));
        setActivePolylines([]);
    }

    kmMarkers.forEach(m => m.setMap(null));
    setKmMarkers([]);

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

            // Draw active itinerary day specific GPX segments (if activeItineraryId is set)
            let activeItineraryIdVal = window.activeItineraryId || null;
            let activeItinerary = null;
            if (activeItineraryIdVal && itineraries) {
                activeItinerary = itineraries.find(itin => itin.id === activeItineraryIdVal);
            }

            if (activeItinerary) {
                activeItinerary.days.forEach((day, dayIdx) => {
                    if (day.gpxPlaceId === place.id && (day.gpxStartKm !== null || day.gpxEndKm !== null)) {
                        const startKm = day.gpxStartKm !== null ? day.gpxStartKm : 0;
                        const endKm = day.gpxEndKm !== null ? day.gpxEndKm : 99999;
                        
                        const segmentPath = place.gpxData.filter(pt => pt.dist >= startKm && pt.dist <= endKm);
                        
                        if (segmentPath.length > 1) {
                            const dayColor = day.color || activeItinerary.color || '#E5B23A';
                            const dayPoly = new google.maps.Polyline({
                                path: segmentPath,
                                geodesic: true,
                                strokeColor: dayColor,
                                strokeOpacity: 0.9,
                                strokeWeight: 7,
                                map: map,
                                zIndex: 1600
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

            // Draw custom GPX segments
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

            place.gpxData.forEach(pt => bounds.extend(pt));
        }
    });

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
        setSlopePolylines([]);
    }

    drawKmMarkers();
}

export function drawSlopeColoredTracks() {
    slopePolylines.forEach(p => p.setMap(null));
    setSlopePolylines([]);
    
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
                color = '#22c55e'; // Flat
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

export function drawKmMarkers() {
    kmMarkers.forEach(m => m.setMap(null));
    setKmMarkers([]);
    
    if (!map || kmMarkerMode === 'off') return;
    
    const activePlace = places.find(p => p.id === activeMarkerId);
    if (!activePlace || !activePlace.gpxData || activePlace.gpxData.length <= 1) return;
    
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
    const newKmMarkersList = [];
    
    if (activePlace.isReversed) {
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
                            newKmMarkersList.push(kmMk);
                        }
                    }
                    lastKm = currentKm;
                }
            }
        }
    } else {
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
                            newKmMarkersList.push(kmMk);
                        }
                    }
                    lastKm = currentKm;
                }
            }
        }
    }
    setKmMarkers(newKmMarkersList);
}

// Distance calculator helper
export function getDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// ============= GPS Geolocation Tracking =============
export function setupGpsTracking() {
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
                // Turn off
                if (watchId !== null) {
                    navigator.geolocation.clearWatch(watchId);
                    setWatchId(null);
                }
                if (userLocationMarker) {
                    userLocationMarker.setMap(null);
                    setUserLocationMarker(null);
                }
                if (leafletUserMarker) {
                    if (leafletMap) leafletMap.removeLayer(leafletUserMarker);
                    setLeafletUserMarker(null);
                }
                gpsBtn.classList.remove('tracking');
                setIsTrackingUser(false);
                showToast('מעקב GPS הופסק', 'info');
            } else {
                // Turn on
                if (!navigator.geolocation) {
                    showToast('דפדפן זה אינו תומך במיקום GPS', 'error');
                    return;
                }
                
                showToast('מפעיל GPS ומאתר מיקום...', 'info');
                gpsBtn.classList.add('tracking');
                setIsTrackingUser(true);

                const wId = navigator.geolocation.watchPosition(
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
                                    const lMarker = L.marker(pos, { icon: userIcon, zIndexOffset: 9999 }).addTo(leafletMap);
                                    setLeafletUserMarker(lMarker);
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
                                const gMarker = new google.maps.Marker({
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
                                setUserLocationMarker(gMarker);
                            } else {
                                userLocationMarker.setPosition(pos);
                            }
                            
                            map.panTo(pos);
                            if (map.getZoom() < 15) {
                                map.setZoom(16);
                            }
                        }
                    },
                    (err) => {
                        console.error('Geolocation error:', err);
                        showToast('שגיאה בקבלת מיקום GPS. ודא שהרשאות המיקום פעילות במכשיר.', 'error');
                        
                        if (watchId !== null) {
                            navigator.geolocation.clearWatch(watchId);
                            setWatchId(null);
                        }
                        if (userLocationMarker) {
                            userLocationMarker.setMap(null);
                            setUserLocationMarker(null);
                        }
                        if (leafletUserMarker) {
                            if (leafletMap) leafletMap.removeLayer(leafletUserMarker);
                            setLeafletUserMarker(null);
                        }
                        gpsBtn.classList.remove('tracking');
                        setIsTrackingUser(false);
                    },
                    {
                        enableHighAccuracy: true,
                        timeout: 10000,
                        maximumAge: 0
                    }
                );
                setWatchId(wId);
            }
        });
    }
}

// ============= Offline Leaflet Maps =============
export function initLeafletMap() {
    if (leafletMap || typeof L === 'undefined') return;
    
    const newLeafletMap = L.map('leaflet-map', {
        zoomControl: false,
        attributionControl: false
    }).setView([31.5, 34.8], 9);
    setLeafletMap(newLeafletMap);
    
    const isMobile = window.innerWidth <= 900;
    if (!isMobile) {
        L.control.zoom({
            position: 'bottomleft'
        }).addTo(newLeafletMap);
    }
    
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 20,
        maxNativeZoom: 17
    });
    
    const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 20,
        maxNativeZoom: 17
    });
    
    osmLayer.addTo(newLeafletMap);
    
    L.control.layers({
        "מפת כבישים (OSM)": osmLayer,
        "מפת שטח (OpenTopo)": topoLayer
    }, null, {
        position: 'topleft'
    }).addTo(newLeafletMap);
}

export function syncLeafletView() {
    if (typeof L === 'undefined') return;
    if (!leafletMap) {
        initLeafletMap();
    }
    
    leafletPolylines.forEach(p => leafletMap.removeLayer(p));
    setLeafletPolylines([]);
    
    leafletMarkers.forEach(m => leafletMap.removeLayer(m));
    setLeafletMarkers([]);
    
    const visiblePlaces = getFilteredPlaces();
    if (visiblePlaces.length === 0) return;
    
    const bounds = L.latLngBounds();
    const newPolys = [];
    const newMarkers = [];
    
    // Draw tracks in Leaflet
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
            
            newPolys.push(poly);
            
            // Draw active itinerary day specific GPX segments in Leaflet
            let activeItineraryIdVal = window.activeItineraryId || null;
            let activeItinerary = null;
            if (activeItineraryIdVal && itineraries) {
                activeItinerary = itineraries.find(itin => itin.id === activeItineraryIdVal);
            }

            if (activeItinerary) {
                activeItinerary.days.forEach((day, dayIdx) => {
                    if (day.gpxPlaceId === place.id && (day.gpxStartKm !== null || day.gpxEndKm !== null)) {
                        const startKm = day.gpxStartKm !== null ? day.gpxStartKm : 0;
                        const endKm = day.gpxEndKm !== null ? day.gpxEndKm : 99999;
                        
                        const segmentPoints = place.gpxData.filter(pt => pt.dist >= startKm && pt.dist <= endKm);
                        
                        if (segmentPoints.length > 1) {
                            const dayColor = day.color || activeItinerary.color || '#E5B23A';
                            const leafLatLngs = segmentPoints.map(pt => [pt.lat, pt.lng]);
                            
                            const dayPoly = L.polyline(leafLatLngs, {
                                color: dayColor,
                                weight: 7,
                                opacity: 0.95
                            }).addTo(leafletMap);
                            
                            const dayNum = dayIdx + 1;
                            dayPoly.bindPopup(`
                                <div style="direction: rtl; text-align: right; font-family: 'Varela Round', sans-serif; padding: 2px;">
                                    <strong>יום ${dayNum}: ${escapeHtml(day.title || 'יום טיול')}</strong><br>
                                    <span style="font-size:11px; color:#555;">מקטע מסלול: ק"מ ${startKm.toFixed(1)} עד ק"מ ${endKm.toFixed(1)}</span>
                                </div>
                            `);
                            
                            newPolys.push(dayPoly);
                        }
                    }
                });
            }
            
            latlngs.forEach(ll => bounds.extend(ll));
        }
    });
    
    // Draw Markers in Leaflet
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
                setActiveMarkerId(place.id);
                syncLeafletView();
                renderPlaces();
                const card = document.querySelector(`.place-card[data-place-id="${place.id}"]`);
                if (card) {
                    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    card.classList.add('pulse-highlight');
                    setTimeout(() => card.classList.remove('pulse-highlight'), 1500);
                }
            });
        marker.placeId = place.id;
        newMarkers.push(marker);
        bounds.extend([place.lat, place.lng]);
    });
    
    setLeafletPolylines(newPolys);
    setLeafletMarkers(newMarkers);

    if (isTrackingUser && leafletUserMarker) {
        leafletUserMarker.addTo(leafletMap);
    }
    
    if (bounds.isValid()) {
        leafletMap.fitBounds(bounds, { padding: [40, 40] });
    }
}

export function toggleOfflineMode(enable) {
    setIsOfflineMode(enable);
    if (enable) {
        document.body.classList.add('offline-map-active');
        syncLeafletView();
    } else {
        document.body.classList.remove('offline-map-active');
        if (map) {
            google.maps.event.trigger(map, 'resize');
        }
    }
}

export function getTileXY(lat, lon, zoom) {
    const x = Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
    const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
    return { x, y, z: zoom };
}

export function getTilesForTrack(gpxData, layerType) {
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

export async function downloadOfflineTiles(urls, mapKey, mapName, layerType) {
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
        if (window.updateSavedMapsList) window.updateSavedMapsList();
    }
}

export async function deleteSavedMap(mapKey) {
    const savedList = JSON.parse(localStorage.getItem('savedOfflineMaps') || '[]');
    const mapItem = savedList.find(item => item.id === mapKey);
    if (!mapItem) return;
    
    const updatedList = savedList.filter(item => item.id !== mapKey);
    localStorage.setItem('savedOfflineMaps', JSON.stringify(updatedList));
    
    try {
        const cache = await caches.open('offline-tiles-cache');
        let urlsToDelete = [];
        if (mapItem.id.startsWith('all')) {
            const allPoints = [];
            places.forEach(p => {
                if (p.gpxData) allPoints.push(...p.gpxData);
            });
            urlsToDelete = getTilesForTrack(allPoints, mapItem.layer);
        } else {
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
        if (window.updateSavedMapsList) window.updateSavedMapsList();
    }
}

// Global scope bindings for focusPlaceOnMap
window.focusPlaceOnMap = function(placeId) {
    const place = places.find(p => p.id === placeId);
    if (!place) return;

    panToPlace(place);

    if (isOfflineMode) {
        if (typeof L !== 'undefined' && leafletMap && leafletMarkers) {
            const marker = leafletMarkers.find(m => m.placeId === placeId);
            if (marker) {
                marker.fire('click');
            }
        }
    } else {
        if (typeof google !== 'undefined' && google.maps && map && markers) {
            const marker = markers.find(m => m.placeId === placeId);
            if (marker) {
                google.maps.event.trigger(marker, 'click');
            }
        }
    }

    if (window.innerWidth <= 900) {
        if (typeof window.switchToMobileMapTab === 'function') {
            window.switchToMobileMapTab();
        } else {
            const tabMap = document.getElementById('mobile-tab-map');
            if (tabMap) tabMap.click();
        }
    }
};

window.switchToMobileMapTab = function() {
    const tabList = document.getElementById('mobile-tab-list');
    const tabMap = document.getElementById('mobile-tab-map');
    if (tabList && tabMap) {
        document.body.classList.remove('mobile-view-list');
        document.body.classList.add('mobile-view-map');
        tabList.classList.remove('active');
        tabMap.classList.add('active');
        
        if (isOfflineMode) {
            if (leafletMap) {
                setTimeout(() => leafletMap.invalidateSize(), 50);
            }
        } else if (typeof google !== 'undefined' && google.maps && map) {
            setTimeout(() => google.maps.event.trigger(map, 'resize'), 50);
        }
    }
};

// ============= GPX File Parsing =============
export function parseGpxFile(file, callback) {
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
                    points.push({ lat, lng, ele });
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
                        points.push({ lat, lng, ele });
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
                        points.push({ lat, lng, ele });
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

export function processGpxData(points) {
    if (!points || points.length === 0) return [];
    
    let cumulativeDist = 0;
    const processed = [];
    
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
            if (dDist > 1) {
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
