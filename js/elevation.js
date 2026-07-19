import { map, setMap, hoverMarker, setHoverMarker, places } from './state.js';
import { getPlaceColor, getPoiEmoji, escapeHtml, showToast } from './ui.js';
import { getDistance } from './map.js';

// Show helper marker on Google Map when hovering on chart
export function showHoverMarkerOnMap(lat, lng, color) {
    if (!map || typeof google === 'undefined' || !google.maps) return;

    const pos = { lat: lat, lng: lng };

    if (hoverMarker) {
        hoverMarker.setPosition(pos);
        hoverMarker.setMap(map);
    } else {
        const hMarker = new google.maps.Marker({
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
        setHoverMarker(hMarker);
    }
}

// Render dynamic elevation profile chart using Chart.js
export function renderElevationChart(place, canvasId, selectedSegmentId = 'full') {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;

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
                if (elements && elements.length > 0 && map) {
                    const idx = elements[0].index;
                    const pt = chartPoints[idx];
                    if (pt) {
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

    canvas.$chart = new Chart(ctx, chartConfig);

    canvas.addEventListener('mouseleave', () => {
        if (hoverMarker) hoverMarker.setMap(null);
    });
}
