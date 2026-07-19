import { map } from './state.js';
import { getPlaceColor, escapeHtml, showToast } from './ui.js';
import { panToPlace } from './map.js';

// ============= Animation & Recording State =============
export let animPlayState = 'idle'; // 'idle', 'playing', 'paused'
export let animCurrentIndex = 0;
export let animPoints = [];
export let animWalkerMarker = null;
export let animAnimationFrameId = null;
export let animSpeed = 10;
export let animDirection = 'forward'; // 'forward', 'reverse'
export let animActivePlace = null;

export let recordStream = null;
export let recordMediaRecorder = null;
export let recordChunks = [];
export let isRecordingActive = false;
export let isCinematicModeActive = false;

// Helpers to modify state values (since ES modules don't allow modifying imports directly)
export function setAnimPlayState(val) { animPlayState = val; }
export function setAnimCurrentIndex(val) { animCurrentIndex = val; }
export function setAnimPoints(val) { animPoints = val; }
export function setAnimWalkerMarker(val) { animWalkerMarker = val; }
export function setAnimAnimationFrameId(val) { animAnimationFrameId = val; }
export function setAnimSpeed(val) { animSpeed = val; }
export function setAnimDirection(val) { animDirection = val; }
export function setAnimActivePlace(val) { animActivePlace = val; }

export function setRecordStream(val) { recordStream = val; }
export function setRecordMediaRecorder(val) { recordMediaRecorder = val; }
export function setRecordChunks(val) { recordChunks = val; }
export function setIsRecordingActive(val) { isRecordingActive = val; }
export function setIsCinematicModeActive(val) { isCinematicModeActive = val; }

export function openRecordingControlBar(place) {
    closeRecordingControlBar();
    if (window.closeMeasurementControlBar) window.closeRecordingControlBar();
    
    setAnimActivePlace(place);
    setAnimPoints(place.isReversed ? [...(place.gpxData || [])].reverse() : (place.gpxData || []));
    if (animPoints.length === 0) {
        showToast('אין נקודות מסלול להנפשה', 'error');
        return;
    }
    
    setAnimCurrentIndex(0);
    setAnimPlayState('idle');
    setAnimSpeed(10);
    setAnimDirection('forward');
    
    const placeColor = getPlaceColor(place);
    
    const bar = document.createElement('div');
    bar.className = 'recording-control-bar';
    bar.id = 'recording-control-bar';
    
    bar.innerHTML = `
        <div class="control-section">
            <span class="control-title">
                <i class="fas fa-route" style="color: ${placeColor}; animation: recordPulse 2s infinite;"></i>
                <span>${escapeHtml(place.name)}</span>
            </span>
        </div>
        
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
        
        <div class="control-section">
            <label for="anim-dir" style="font-size:12px; font-weight:bold; color:var(--text-secondary);">כיוון:</label>
            <select id="anim-dir">
                <option value="forward" selected>קדימה ➔</option>
                <option value="reverse">הפוך 🚶‍♂️ ➔ 🏃‍♂️</option>
            </select>
        </div>
        
        <button class="control-btn control-btn-play" id="btn-anim-play">
            <i class="fas fa-play"></i> <span>הפעל</span>
        </button>
        
        <button class="control-btn control-btn-record" id="btn-anim-record">
            <i class="fas fa-circle"></i> <span>הקלט מסך</span>
        </button>
        
        <div class="control-section" style="margin-right: 8px;">
            <label style="display:flex; align-items:center; gap:6px; font-size:12.5px; font-weight:bold; color:var(--text-secondary); cursor:pointer;">
                <input type="checkbox" id="chk-cinematic" style="cursor:pointer;">
                <span>מצב קולנועי (נקי)</span>
            </label>
        </div>
        
        <button class="control-btn control-btn-close" id="btn-anim-close">
            <i class="fas fa-times"></i> <span>סגור</span>
        </button>
        
        <div class="recording-progress-container">
            <div class="recording-progress-fill" id="anim-progress-fill"></div>
        </div>
    `;
    
    document.getElementById('map-panel').appendChild(bar);
    
    bar.querySelector('#anim-speed').addEventListener('change', (e) => {
        setAnimSpeed(parseInt(e.target.value) || 10);
    });
    
    bar.querySelector('#anim-dir').addEventListener('change', (e) => {
        setAnimDirection(e.target.value);
        if (animPlayState === 'idle') {
            setAnimCurrentIndex((animDirection === 'forward') ? 0 : animPoints.length - 1);
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
    
    const startPoint = animPoints[0];
    setAnimCurrentIndex(0);
    
    const marker = new google.maps.Marker({
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
    setAnimWalkerMarker(marker);
    
    panToPlace(startPoint.lat, startPoint.lng);
    map.setZoom(15);
}

export function closeRecordingControlBar() {
    if (animAnimationFrameId) {
        cancelAnimationFrame(animAnimationFrameId);
        setAnimAnimationFrameId(null);
    }
    
    if (isRecordingActive) {
        stopScreenRecording();
    }
    
    if (isCinematicModeActive) {
        toggleCinematicMode(false);
    }
    
    if (animWalkerMarker) {
        animWalkerMarker.setMap(null);
        setAnimWalkerMarker(null);
    }
    
    const bar = document.getElementById('recording-control-bar');
    if (bar) {
        bar.remove();
    }
    
    setAnimActivePlace(null);
    setAnimPoints([]);
    setAnimPlayState('idle');
}

export function updateWalkerPosition() {
    if (!animWalkerMarker || animPoints.length === 0) return;
    const pt = animPoints[animCurrentIndex];
    if (pt) {
        const pos = { lat: pt.lat, lng: pt.lng };
        animWalkerMarker.setPosition(pos);
        
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
        
        const progressFill = document.getElementById('anim-progress-fill');
        if (progressFill) {
            const total = animPoints.length - 1;
            const current = animDirection === 'forward' ? animCurrentIndex : (total - animCurrentIndex);
            const percentage = total > 0 ? (current / total) * 100 : 0;
            progressFill.style.width = `${percentage}%`;
        }
    }
}

export function toggleAnimPlay() {
    const playBtn = document.getElementById('btn-anim-play');
    if (!playBtn) return;
    
    if (animPlayState === 'playing') {
        setAnimPlayState('paused');
        playBtn.innerHTML = `<i class="fas fa-play"></i> <span>הפעל</span>`;
        if (animAnimationFrameId) {
            cancelAnimationFrame(animAnimationFrameId);
            setAnimAnimationFrameId(null);
        }
        showToast('ההנפשה מושהית', 'info');
    } else {
        if (animPlayState === 'idle') {
            setAnimCurrentIndex((animDirection === 'forward') ? 0 : animPoints.length - 1);
        }
        
        setAnimPlayState('playing');
        playBtn.innerHTML = `<i class="fas fa-pause"></i> <span>השהה</span>`;
        showToast('ההנפשה מופעלת', 'success');
        
        const frameId = requestAnimationFrame(animateStep);
        setAnimAnimationFrameId(frameId);
    }
}

export function animateStep() {
    if (animPlayState !== 'playing' || animPoints.length === 0) return;
    
    if (animDirection === 'forward') {
        setAnimCurrentIndex(animCurrentIndex + animSpeed);
        if (animCurrentIndex >= animPoints.length - 1) {
            setAnimCurrentIndex(animPoints.length - 1);
            setAnimPlayState('idle');
            finishAnimation();
            return;
        }
    } else {
        setAnimCurrentIndex(animCurrentIndex - animSpeed);
        if (animCurrentIndex <= 0) {
            setAnimCurrentIndex(0);
            setAnimPlayState('idle');
            finishAnimation();
            return;
        }
    }
    
    updateWalkerPosition();
    
    const pt = animPoints[animCurrentIndex];
    if (pt && map) {
        map.panTo({ lat: pt.lat, lng: pt.lng });
    }
    
    const frameId = requestAnimationFrame(animateStep);
    setAnimAnimationFrameId(frameId);
}

export function finishAnimation() {
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
        setAnimAnimationFrameId(null);
    }
}

export function toggleScreenRecording() {
    if (isRecordingActive) {
        stopScreenRecording();
    } else {
        startScreenRecording();
    }
}

export function startScreenRecording() {
    const recordBtn = document.getElementById('btn-anim-record');
    if (!recordBtn) return;
    
    setRecordChunks([]);
    
    navigator.mediaDevices.getDisplayMedia({
        video: {
            displaySurface: "browser",
            logicalSurface: true
        },
        audio: false
    }).then(stream => {
        setRecordStream(stream);
        setIsRecordingActive(true);
        
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
        
        const mediaRecorder = new MediaRecorder(stream, options);
        setRecordMediaRecorder(mediaRecorder);
        
        mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                recordChunks.push(e.data);
            }
        };
        
        mediaRecorder.onstop = () => {
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
        
        mediaRecorder.start();
    }).catch(err => {
        console.error("Screen capture failed:", err);
        showToast('הקלטת מסך בוטלה או לא נתמכת בדפדפן זה', 'error');
    });
}

export function stopScreenRecording() {
    const recordBtn = document.getElementById('btn-anim-record');
    if (recordBtn) {
        recordBtn.className = 'control-btn control-btn-record';
        recordBtn.innerHTML = `<i class="fas fa-circle"></i> <span>הקלט מסך</span>`;
    }
    
    setIsRecordingActive(false);
    
    if (recordMediaRecorder && recordMediaRecorder.state !== 'inactive') {
        recordMediaRecorder.stop();
    }
    
    if (recordStream) {
        recordStream.getTracks().forEach(track => track.stop());
        setRecordStream(null);
    }
    
    showToast('הקלטת הווידאו נעצרה', 'info');
}

export function toggleCinematicMode(enable) {
    setIsCinematicModeActive(enable);
    const body = document.body;
    const chk = document.getElementById('chk-cinematic');
    
    if (chk) chk.checked = enable;
    
    if (enable) {
        body.classList.add('cinematic-active');
        showToast('מצב קולנועי מופעל! לוח הבקרה זמין בתחתית.', 'info');
        
        setTimeout(() => {
            if (typeof google !== 'undefined' && google.maps && map) {
                google.maps.event.trigger(map, 'resize');
            }
        }, 500);
    } else {
        body.classList.remove('cinematic-active');
        showToast('מצב קולנועי כבוי', 'info');
        
        setTimeout(() => {
            if (typeof google !== 'undefined' && google.maps && map) {
                google.maps.event.trigger(map, 'resize');
            }
        }, 500);
    }
}

// Bind globally for elements created in dynamic templates
window.closeRecordingControlBar = closeRecordingControlBar;
window.openRecordingControlBar = openRecordingControlBar;
