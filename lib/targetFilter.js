// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import {pointInRect} from './geometry.js';

const EXCLUDED_STYLE_CLASSES = new Set([
    'panel',
    'panel-box',
    'dash',
    'dock',
    'dashtodock',
    'dash-item-container',
    'workspace-thumbnails',
    'workspace-thumbnail',
    'search-entry',
    'app-display',
    'app-grid',
    'app-well-app',
    'show-apps',
    'overview-action-toolbar',
    'overview-action-toolbar-container',
    'overview-workspace-popup',
]);

/**
 * Checks if an actor or any of its ancestors is an excluded actor
 * (such as top panel, dash/dock, search entry, thumbnails, app grid, or toolbar).
 *
 * @param {object} actor - The actor to test
 * @param {Array<object>} excludedActors - Explicit list of excluded actors
 * @returns {boolean} True if the actor belongs to an excluded component
 */
export function isExcludedActor(actor, excludedActors = []) {
    if (!actor)
        return false;

    // Direct reference or containment check on excludedActors
    for (const excluded of excludedActors) {
        if (!excluded)
            continue;
        if (actor === excluded)
            return true;
        if (typeof excluded.contains === 'function' && excluded.contains(actor))
            return true;
    }

    // Walk ancestor chain checking references and style class names
    let current = actor;
    while (current) {
        for (const excluded of excludedActors) {
            if (excluded && current === excluded)
                return true;
        }

        // Check has_style_class_name
        if (typeof current.has_style_class_name === 'function') {
            for (const cls of EXCLUDED_STYLE_CLASSES) {
                if (current.has_style_class_name(cls))
                    return true;
            }
        }

        // Also check style_class string if present
        if (typeof current.style_class === 'string') {
            const classes = current.style_class.split(/\s+/);
            for (const cls of classes) {
                if (EXCLUDED_STYLE_CLASSES.has(cls))
                    return true;
            }
        }

        current = typeof current.get_parent === 'function' ? current.get_parent() : null;
    }

    return false;
}

/**
 * Evaluates whether rubberband selection is allowed to start at a given target/point.
 *
 * @param {object} options
 * @param {boolean} [options.isWindowPicker=true] - Whether overview is in window picker mode
 * @param {boolean} [options.hasWindowPreviews=true] - Whether current workspace has open window previews
 * @param {{x: number, y: number}|null} [options.point=null] - Stage coordinates of mouse click
 * @param {object|null} [options.actor=null] - Actor picked under mouse cursor
 * @param {Array<object>} [options.excludedActors=[]] - Excluded actor instances
 * @param {Array<{x: number, y: number, width: number, height: number}>} [options.excludedBoxes=[]] - Bounding boxes of excluded UI bars
 * @returns {boolean} True if rubberband drag selection can be initiated
 */
export function canStartRubberband({
    isWindowPicker = true,
    hasWindowPreviews = true,
    point = null,
    actor = null,
    excludedActors = [],
    excludedBoxes = [],
} = {}) {
    // 1. Must be in active Window Picker mode (not App Grid or Search)
    if (!isWindowPicker)
        return false;

    // 2. Must have at least one window preview on the workspace to select
    if (!hasWindowPreviews)
        return false;

    // 3. Must not belong to an excluded actor hierarchy (Panel, Dash/Dock, Search, etc.)
    if (actor && isExcludedActor(actor, excludedActors))
        return false;

    // 4. Must not be within an excluded bounding box (Top Panel, Dash/Dock, Search Entry, Thumbnails, Toolbar)
    if (point && excludedBoxes && excludedBoxes.length > 0) {
        for (const box of excludedBoxes) {
            if (box && pointInRect(point.x, point.y, box))
                return false;
        }
    }

    return true;
}
