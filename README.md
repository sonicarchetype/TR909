# TR-909 RHYTHM COMPOSER (Web Edition)

> **A labor of love for the classic Roland TR-909.  
> Now in your browser, with modern power and vintage soul.**

---

## Foreword

The Roland TR-909 is more than a drum machine—it's a legend that shaped the sound of electronic music for decades. This project is a faithful, software-based reimagining of the 909, designed for musicians, producers, and tinkerers who crave that iconic workflow and sound, but with the convenience and flexibility of the web.

**Why this project?**  
We love the 909. We wanted to capture its unique feel, quirks, and immediacy—while adding new features, modern UI, and the ability to run anywhere. This is not just a clone; it's a tribute, an upgrade, and a playground for rhythm lovers.

---

## Features

- 🎛️ **Authentic 909 Workflow**: Step sequencing, pattern memory, and hands-on controls, just like the original.
- 🔊 **Authentic Drum Sounds**: Carefully crafted for punch and character.
- 🖥️ **Modern Web UI**: Responsive, interactive, and touch-friendly, works on all devices.
- 💾 **Pattern & Bank Management**: Save, recall, and export your beats.
- 🔄 **Real-Time Audio Sequencing**: Tight timing, near-zero latency, and smooth playback.
- 🌐 **Offline Support**: Download once, play offline.
- 🚀 **Performance-Oriented**: Custom engine gives web-assembly a smoke with ultra fast user experience and UI updates. 
- 🧩 **Extensible**: Designed for future features like MIDI, Ableton Link, and more.
- 🛠️ **Open Source**: Hackable, inspectable, and ready for your contributions.
- 🎹 **Preset Library**: Comes with a collection of ready-to-use patterns and banks.

---

## Quick Start

```bash
git clone https://github.com/yourusername/TR909.git
cd TR909
npm install
npm run dev
```

## Build for Production

```bash
npm run build
```

Open [http://localhost:16](http://localhost:16) in your browser. (You should probably change the port in `vite.config.js` to something that fits your network environment.)

---

## Screenshots

![TR-909 Web UI Screenshot](public/SA-TR909-UI.jpg)

---

## High-Level Architecture

**Main Components:**

- **React UI**: Renders the drum machine interface, controls, and displays. Handles user interaction and communicates with the Engine via a global singleton.
- **Engine**: A large, stateful singleton class that manages pattern and bank memory, audio sequencing, playback, UI state, persistence, and business logic for all controls.
- **Service Worker**: Handles caching of sound data and app assets for offline use, with custom update and cache invalidation logic.

**Data Flow:**
- UI events call methods on the `engine` singleton.
- The Engine updates its internal state and calls registered React state setters to update the UI.
- Engine also handles audio playback directly.

---

## Engine API Overview

The `Engine` class is the core of the application. It is responsible for:

- Managing all pattern, preset, and bank data
- Handling playback, sequencing, and audio logic
- Managing UI state and propagating updates to React components
- Handling persistence (localStorage, file import/export)
- Providing a registry of state setters (`StateSetters`) for UI updates
- Exposing methods for all user actions (play, stop, save, recall, edit, etc.)

**Interaction Pattern:**
- UI components call methods on the global `engine` instance.
- UI components register their React state setters in `engine.StateSetters` for updates.
- Engine methods update state and call the appropriate setters to trigger UI changes.

---

## Design Paradigm: Data-Oriented Design (DOD) in JS/React

- **Centralized State:** All application state is managed in the Engine singleton. React components are mostly "dumb views" that render state and forward events to the Engine.
- **StateSetters Registry:** Instead of React Context or Redux, the Engine holds references to all React state setters. When state changes, the Engine calls these setters to update the UI.
- **Event Routing:** All user actions are routed through Engine methods, which update state and trigger UI updates.
- **Contrast with Idiomatic React:** This project uses a DOD-inspired, centralized, imperative approach for performance and control, at the cost of React best practices. This can be more familiar to those from embedded, game, or DOD backgrounds, but may be surprising to typical React/JS developers.

---

## Service Worker

- Caches large sound data and app assets for offline use.
- Uses custom strategies for sound file caching, update checks, and cache invalidation.
- Handles fetch events for sound data, app assets, and versioning.
- Ensures the app works offline and loads quickly.

---

## Roadmap

**Planned/Nice-to-Have Features:**
- *Easy*
  - A comprehensive manual for TR-909
- *Medium:*
  - Keyboard shortcuts for missing features. At the moment, key commands are performer-oriented, not editor-oriented.
  - Requires carefull planning and actuall testing. People with experience needed, but it's not obvious for newcomers. It's like Vim.
- *Rather Medium-to-Hard:*
  - Full MIDI support:
      - Import MIDI files and convert to engine format
      - Export to MIDI files
      - MIDI sync
  - Ableton Link support (for Ableton Push)
  - Multi-out support (maybe)

---

## Contribution Notes

- **Where to Start:**  
  - UI components (React) are a good entry point for new contributors if you have spotted a bug or know how to improve the UI.
  - Engine internals, state management, and service worker require experience.
  - Check the [Roadmap](#roadmap) for planned features.
- **Strict no dependencies policy:**
  - This is all and let's keep it that way.
```json
{
  "devDependencies": {
    {/* react-vite boilerplate */}

    {/* future manual, maybe? Currently unused. */}
    "react-markdown": "^9.0.3",

    {/* native json works as same, but we like zipson */}
    "zipson": "^0.2.12"
  }
}  
```
- **About tests and adding a testing framework:**  
  - Please don't. Your time is valuable as our's. Test by using TR-909.
- **Tips:**  
  - Read through `src/App.jsx` and `src/features/Engine.js` to understand the data flow.
  - Real-time debugging the Engine is hard. Use the console. Reload to reset the Engine state.
  - Pay attention to the `StateSetters` pattern for UI updates. This is a DOD-inspired, centralized, imperative approach for performance and control. TR909 feels as it has been written in C. Learn why studying the code.
  - Document any new features or changes to the Engine API.

---

## License

MIT

---

**Enjoy making rhythms!**  