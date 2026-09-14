import test from 'node:test';
import assert from 'node:assert/strict';
import {isExcludedActor, canStartRubberband} from '../lib/targetFilter.js';

test('isExcludedActor returns false for null or normal workspace background actor', () => {
    assert.equal(isExcludedActor(null), false);

    const normalActor = {
        style_class: 'window-picker',
        get_parent: () => null,
    };
    assert.equal(isExcludedActor(normalActor), false);
});

test('isExcludedActor detects direct match and contains() match', () => {
    const dashActor = {name: 'dash'};
    const dashChild = {
        name: 'dashChild',
        get_parent: () => dashActor,
    };
    dashActor.contains = child => child === dashChild;

    assert.equal(isExcludedActor(dashActor, [dashActor]), true);
    assert.equal(isExcludedActor(dashChild, [dashActor]), true);
});

test('isExcludedActor detects excluded style classes across ancestor chain', () => {
    const panelActor = {
        has_style_class_name: cls => cls === 'panel',
        get_parent: () => null,
    };
    const panelIndicator = {
        has_style_class_name: () => false,
        get_parent: () => panelActor,
    };

    assert.equal(isExcludedActor(panelIndicator), true);

    const dockIcon = {
        style_class: 'dash-item-container app-well-app',
        get_parent: () => null,
    };
    assert.equal(isExcludedActor(dockIcon), true);
});

test('canStartRubberband rejects when not in window picker mode (e.g. App Grid)', () => {
    const result = canStartRubberband({
        isWindowPicker: false,
        hasWindowPreviews: true,
        point: {x: 500, y: 500},
    });
    assert.equal(result, false);
});

test('canStartRubberband rejects when workspace has no window previews', () => {
    const result = canStartRubberband({
        isWindowPicker: true,
        hasWindowPreviews: false,
        point: {x: 500, y: 500},
    });
    assert.equal(result, false);
});

test('canStartRubberband rejects clicks on excluded actors (e.g. Dash icons or Panel)', () => {
    const dashActor = {name: 'dash'};
    const iconActor = {
        name: 'icon',
        get_parent: () => dashActor,
    };
    dashActor.contains = a => a === iconActor;

    const result = canStartRubberband({
        isWindowPicker: true,
        hasWindowPreviews: true,
        actor: iconActor,
        excludedActors: [dashActor],
    });
    assert.equal(result, false);
});

test('canStartRubberband rejects clicks inside excluded bounding boxes (e.g. Top Panel or Dock)', () => {
    const panelBox = {x: 0, y: 0, width: 1920, height: 40};
    const dockBox = {x: 600, y: 1000, width: 720, height: 80};

    // Click inside Top Panel
    assert.equal(canStartRubberband({
        isWindowPicker: true,
        hasWindowPreviews: true,
        point: {x: 500, y: 20},
        excludedBoxes: [panelBox, dockBox],
    }), false);

    // Click inside Dash / Dock
    assert.equal(canStartRubberband({
        isWindowPicker: true,
        hasWindowPreviews: true,
        point: {x: 800, y: 1020},
        excludedBoxes: [panelBox, dockBox],
    }), false);
});

test('canStartRubberband allows clicks in overview workspace and surrounding margins', () => {
    const panelBox = {x: 0, y: 0, width: 1920, height: 40};
    const dockBox = {x: 600, y: 1000, width: 720, height: 80};
    const thumbnailsBox = {x: 300, y: 50, width: 1320, height: 120};

    const normalWorkspaceActor = {
        style_class: 'workspaces-view',
        get_parent: () => null,
    };

    // Center of workspace between windows
    assert.equal(canStartRubberband({
        isWindowPicker: true,
        hasWindowPreviews: true,
        point: {x: 960, y: 600},
        actor: normalWorkspaceActor,
        excludedBoxes: [panelBox, dockBox, thumbnailsBox],
    }), true);

    // Left margin of overview (far left near screen edge)
    assert.equal(canStartRubberband({
        isWindowPicker: true,
        hasWindowPreviews: true,
        point: {x: 50, y: 500},
        actor: normalWorkspaceActor,
        excludedBoxes: [panelBox, dockBox, thumbnailsBox],
    }), true);

    // Margin below window previews but above Dash
    assert.equal(canStartRubberband({
        isWindowPicker: true,
        hasWindowPreviews: true,
        point: {x: 960, y: 920},
        actor: normalWorkspaceActor,
        excludedBoxes: [panelBox, dockBox, thumbnailsBox],
    }), true);

    // Corner region (to the left of centered Dash at the bottom)
    assert.equal(canStartRubberband({
        isWindowPicker: true,
        hasWindowPreviews: true,
        point: {x: 100, y: 1040},
        actor: normalWorkspaceActor,
        excludedBoxes: [panelBox, dockBox, thumbnailsBox],
    }), true);
});
