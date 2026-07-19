// ============================================================
// Firebase Configuration
// ============================================================
// To connect to Firebase:
// 1. Go to https://console.firebase.google.com
// 2. Create a new project
// 3. Add a Web App and copy the config below
// 4. Enable Firestore Database (test mode)
// 5. Enable Firebase Storage (test mode)
// ============================================================

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyColqkBBX0M7bBfXH2yf7-jslmHTxpiIu4",
    authDomain: "bialik-s-travels.firebaseapp.com",
    projectId: "bialik-s-travels",
    storageBucket: "bialik-s-travels.firebasestorage.app",
    messagingSenderId: "419202995735",
    appId: "1:419202995735:web:90f923170f4f9d7a58ae52",
    measurementId: "G-8DNKN9FBJL"
};

// Do not modify below this line
window.FIREBASE_CONFIG = FIREBASE_CONFIG;
window.IS_FIREBASE_CONFIGURED = FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY" && FIREBASE_CONFIG.apiKey !== "";

if (window.IS_FIREBASE_CONFIGURED) {
    try {
        firebase.initializeApp(FIREBASE_CONFIG);
        window.db = firebase.firestore();
        
        // Enable Firestore Offline Persistence
        window.db.enablePersistence()
            .then(() => console.log("%c💾 Firebase Persistence: שמירת נתונים מקומית פעילה!", "color: #0D9488; font-weight: bold;"))
            .catch(err => {
                if (err.code == 'failed-precondition') {
                    console.warn("Firebase persistence failed: multiple tabs open");
                } else if (err.code == 'unimplemented') {
                    console.warn("Firebase persistence is not supported in this browser");
                }
            });

        window.storage = firebase.storage();
        console.log("%c🔥 Firebase: מחובר בהצלחה לענן!", "color: #0D9488; font-weight: bold; font-size: 13px;");
    } catch (e) {
        console.error("Firebase initialization failed:", e);
        window.db = null;
        window.storage = null;
        window.IS_FIREBASE_CONFIGURED = false;
    }
} else {
    window.db = null;
    window.storage = null;
}
