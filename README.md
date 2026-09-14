# <img src="assets/lasso.svg" alt="Lasso Icon" width="64" height="64" valign="middle"> Lasso: window overview manager extension for GNOME 48+

[![GNOME Shell 50](https://img.shields.io/badge/GNOME%20Shell-48+-3584e4?logo=gnome&logoColor=white)](https://gitlab.gnome.org/GNOME/gnome-shell)
[![Version](https://img.shields.io/badge/version-1.0.0-orange)](metadata.json)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

Multi-window marquee selection, range picking, and batch actions for the GNOME 48+ overview.

<div align="center">
  <img src="assets/demo.gif" alt="Lasso Demo" width="850">
</div>


## Features

- **Rubberband Selection**: Click and drag on the overview workspace background to select multiple windows with a marquee box.
- **Discontinuous Selection**: Hold <kbd>Ctrl</kbd> + click (or click when selection mode is active) to toggle individual windows.
- **Range Selection**: Hold <kbd>Shift</kbd> + click to select all windows between the active anchor and the clicked window.
- **Floating Action Toolbar**: Shows the selected window count with quick actions:
  - **Move to Workspace ▾**: Move selected windows to any active workspace or a new one.
  - **Close Windows**: Batch-close all selected windows.
  - **Deselect**: Clear the selection.
- **Batch Drag & Drop**: Drag any selected window to another workspace thumbnail to move all selected windows together. Shows a badge with the selection count.
- **Accent Color Matching**: Uses GNOME's system accent color by default, with custom color overrides in preferences.


## Shortcuts

| Action | Shortcut / Trigger | Description |
| :--- | :--- | :--- |
| **Marquee Select** | Click + Drag on background | Draw rubberband selection box |
| **Toggle Select** | <kbd>Ctrl</kbd> + Click / Click | Toggle individual window selection |
| **Range Select** | <kbd>Shift</kbd> + Click | Select range from last selected window |
| **Select All** | <kbd>Ctrl</kbd> + <kbd>A</kbd> | Select all windows on active workspace |
| **Close Selected** | <kbd>Delete</kbd>, <kbd>Backspace</kbd>, or <kbd>Ctrl</kbd> + <kbd>W</kbd> | Close all selected windows |
| **Clear Selection** | <kbd>Escape</kbd> or click background | Deselect all windows |
| **Move to Workspace** | Toolbar `Move to Workspace ▾` | Move selection to another workspace |
| **Batch Drag** | Drag any selected window | Move all selected windows to target workspace |


## Installation & Packaging

### Pack
```bash
npm run pack
# or:
gnome-extensions pack --force --extra-source=lib --extra-source=schemas --extra-source=stylesheet.css --extra-source=prefs.js
```

### Install locally
```bash
npm run install-local
# or:
gnome-extensions install --force lasso@frephs.github.io.shell-extension.zip
```

### Enable
```bash
gnome-extensions enable lasso@frephs.github.io
```

### Preferences
```bash
gnome-extensions prefs lasso@frephs.github.io
```


## Testing

Run unit tests with the Node.js test runner:

```bash
npm test
```


## License

GPL-3.0-or-later. See [LICENSE](LICENSE) for details.
