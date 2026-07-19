# Project Overview
Travel Web App & Route Planner based on Google Maps and Leaflet.

# Architecture
The codebase is structured using Vanilla ES6 Modules directly in the browser. 
- **NO** Node.js or NPM build tools are used.
- Main entry point in `index.html`: `<script type="module" src="js/app.js"></script>`

# Directory Structure & Separation of Concerns (`js/` folder)
- `js/state.js`: Central state management, global variables, helper functions, and reactive setters.
- `js/db.js`: Data layer - Firebase Firestore integration, LocalStorage management, and places/groups synchronization.
- `js/map.js`: Map engine operations, markers, polygon layers (GPX), GPS navigation, and offline tile management.
- `js/map-styles.js`: Map styling configurations (Day mode / Dark Mode).
- `js/elevation.js`: Elevation profile graph rendering (utilizing Chart.js).
- `js/roadbook.js`: Roadbook management, Points of Interest (POIs) handling, route segments, and PDF export functionality.
- `js/animation.js`: Route analysis, movement simulation, and track recordings.
- `js/ui.js`: UI layer - rendering UI components, cards, menus, modals, and drag-and-drop logic (SortableJS).
- `js/itinerary.js`: Daily planning management, trip days handling, and scheduling.
- `js/app.js`: Application entry point, system initialization (`init` function), and global event listeners registration.
- `sw.js`: Service Worker (v6) responsible for caching all module files (`js/*.js`) to ensure offline capabilities.

# Development Guidelines & Rules
1. **Strict ES Modules:** When adding new functionality, variables, or functions, strictly use proper ES6 `export` and `import` syntax between files. Avoid polluting the global window object.
2. **Local Environment:** Local testing must always be executed through a local HTTP server (e.g., `http://localhost:8080`) to prevent CORS issues with ES modules.
3. **Language:** Provide explanations and write code comments in English to prevent RTL (Right-to-Left) text display issues in the terminal.