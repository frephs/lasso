// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import Clutter from 'gi://Clutter';
import Graphene from 'gi://Graphene';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { WindowPreview } from 'resource:///org/gnome/shell/ui/windowPreview.js';
import { Workspace } from 'resource:///org/gnome/shell/ui/workspace.js';
import { WorkspaceThumbnail, ThumbnailsBox } from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';
import { ControlsState } from 'resource:///org/gnome/shell/ui/overviewControls.js';

import { SelectionModel } from './selectionModel.js';
import { RubberbandActor } from './rubberband.js';
import { WindowHighlighter } from './windowHighlighter.js';
import { ActionToolbar } from './actionToolbar.js';
import { sortItemsVisually } from './geometry.js';
import { computeToolbarPosition } from './toolbarPosition.js';
import { canStartRubberband } from './targetFilter.js';
export { computeToolbarPosition };

const DRAG_THRESHOLD = 5;

/**
 * Manages overview integration, event capture, rubberband selection,
 * window highlights, and bulk actions.
 */
export class OverviewManager {
    constructor(settings = null) {
        this._settings = settings;
        this._selectionModel = new SelectionModel();
        this._highlighter = new WindowHighlighter(settings, this._selectionModel);
        this._rubberband = new RubberbandActor();
        this._toolbar = new ActionToolbar();

        this._dragPending = false;
        this._dragStartX = 0;
        this._dragStartY = 0;
        this._dragIsCtrl = false;
        this._dragIsShift = false;
        this._rubberbandActive = false;
        this._windowClickTarget = null;
        this._capturedEventId = 0;
        this._origWorkspaceAcceptDrop = null;
        this._origThumbnailAcceptDropInternal = null;
        this._origThumbnailsBoxAcceptDrop = null;
        this._activeDragSelectedIds = null;
        this._inDrop = false;

        this._highlighter.setDragCallbacks({
            onDragBegin: preview => this._onPreviewDragBegin(preview),
            onDragEnd: preview => this._onPreviewDragEnd(preview),
        });

        this._setupToolbar();
        this._setupDragAndDropHook();
        this._updateColorOverride();
        this._bindSignals();
    }

    _setupToolbar() {
        this._toolbar.setCallbacks({
            onClose: () => this.closeSelectedWindows(),
            onDeselect: () => this._selectionModel.clear(),
            onMoveToWorkspace: wsIndex => this.moveSelectedToWorkspace(wsIndex, wsIndex === 'new'),
        });

        // Add rubberband and toolbar to uiGroup
        Main.layoutManager.uiGroup.add_child(this._rubberband);
        Main.layoutManager.uiGroup.add_child(this._toolbar);

        // Position toolbar at bottom center above Dash
        this._toolbar.add_constraint(new Clutter.AlignConstraint({
            source: global.stage,
            align_axis: Clutter.AlignAxis.X_AXIS,
            pivot_point: new Graphene.Point({ x: 0.5, y: 0 }),
            factor: 0.5,
        }));
        this._toolbar.add_constraint(new Clutter.AlignConstraint({
            source: global.stage,
            align_axis: Clutter.AlignAxis.Y_AXIS,
            pivot_point: new Graphene.Point({ x: 0, y: 1 }),
            factor: 1,
        }));
        this._toolbar.margin_bottom = 96;

        this._updateToolbarPosition();
    }

    _updateToolbarPosition() {
        if (!this._toolbar)
            return;

        const monitor = Main.layoutManager?.primaryMonitor ?? {
            x: 0,
            y: 0,
            width: global.stage?.width ?? 1920,
            height: global.stage?.height ?? 1080,
        };

        const stageWidth = global.stage?.width ?? monitor.width;
        const stageHeight = global.stage?.height ?? monitor.height;

        let dashData = null;
        const dash = Main.overview?.dash;
        if (dash && dash.visible) {
            const [, dashY] = dash.get_transformed_position?.() ?? [0, 0];
            const [, dashHeight] = dash.get_transformed_size?.() ?? [0, dash.height ?? 0];
            dashData = {
                visible: true,
                y: dashY,
                height: dashHeight,
            };
        }

        let dockData = null;
        const dashToDock = dash?._dock || Main.layoutManager?._bottomPanel;
        if (dashToDock && dashToDock.visible) {
            const [, dockY] = dashToDock.get_transformed_position?.() ?? [0, 0];
            const [, dockHeight] = dashToDock.get_transformed_size?.() ?? [0, dashToDock.height ?? 0];
            dockData = {
                visible: true,
                y: dockY,
                height: dockHeight,
            };
        }

        const { marginBottom, translationX, translationY } = computeToolbarPosition({
            stageWidth,
            stageHeight,
            monitor,
            dash: dashData,
            dock: dockData,
        });

        this._toolbar.margin_bottom = marginBottom;
        this._toolbar.translation_x = translationX;
        this._toolbar.translation_y = translationY;
    }

    _bindSignals() {
        this._selectionModel.addListener(() => this._onSelectionChanged());

        Main.overview.connectObject(
            'showing', () => this._onOverviewShowing(),
            'shown', () => this._updateToolbarPosition(),
            'hidden', () => this._onOverviewHidden(),
            this
        );

        const dash = Main.overview?.dash;
        if (dash) {
            dash.connectObject(
                'notify::allocation', () => this._updateToolbarPosition(),
                'notify::y', () => this._updateToolbarPosition(),
                this
            );
            if (dash.showAppsButton) {
                dash.showAppsButton.connectObject(
                    'notify::checked', () => {
                        if (!this._isWindowPickerActive())
                            this._resetSelectionState();
                    },
                    this
                );
            }
        }

        const controls = Main.overview._overview?._controls;
        if (controls) {
            if (controls._stateAdjustment) {
                controls._stateAdjustment.connectObject(
                    'notify::value', () => {
                        if (!this._isWindowPickerActive())
                            this._resetSelectionState();
                    },
                    this
                );
            }
            if (controls._searchController) {
                controls._searchController.connectObject(
                    'notify::search-active', () => {
                        if (!this._isWindowPickerActive())
                            this._resetSelectionState();
                    },
                    this
                );
            }
        }

        if (this._settings) {
            this._settings.connectObject(
                'changed::use-color-override', () => this._updateColorOverride(),
                'changed::color-override', () => this._updateColorOverride(),
                this
            );
        }

        global.workspace_manager.connectObject(
            'workspace-switched', () => this._onSelectionChanged(),
            'workspaces-reordered', () => this._onSelectionChanged(),
            this
        );

        if (Main.overview.visible) {
            this._onOverviewShowing();
            this._updateToolbarPosition();
        }
    }

    _onOverviewShowing() {
        this._selectionModel.clear();
        this._enableEventCapture();
    }

    _onOverviewHidden() {
        this._disableEventCapture();
        this._resetSelectionState();
    }

    _resetSelectionState() {
        this._rubberband?.finish?.();
        this._rubberbandActive = false;
        this._dragPending = false;
        this._windowClickTarget = null;
        this._activeDragSelectedIds = null;
        this._toolbar?.closeWorkspacePopup?.();
        this._selectionModel.clear();
        this._setOtherSelectedPreviewsDimmed(null, false);
    }

    _isWindowPickerActive() {
        if (!Main.overview.visible)
            return false;

        const controls = Main.overview._overview?._controls;
        if (controls) {
            if (controls._searchController?.searchActive)
                return false;

            if (controls._stateAdjustment) {
                const params = controls._stateAdjustment.getStateTransitionParams?.();
                const pickerState = ControlsState?.WINDOW_PICKER ?? 1;
                if (params) {
                    if (params.currentState !== pickerState || params.finalState !== pickerState)
                        return false;
                } else if (controls._stateAdjustment.value !== pickerState) {
                    return false;
                }
            }

            if (controls._appDisplay?.visible)
                return false;
        }

        const dash = Main.overview?.dash;
        if (dash?.showAppsButton?.checked)
            return false;

        return true;
    }

    _getExcludedActors() {
        const controls = Main.overview._overview?._controls;
        const dash = Main.overview?.dash;
        const bottomPanel = Main.layoutManager?._bottomPanel;
        const dock = dash?._dock || bottomPanel;

        const actors = [
            this._toolbar,
            Main.panel,
            Main.layoutManager?.panelBox,
            dash,
            dock,
        ];

        if (controls) {
            if (controls._searchEntry)
                actors.push(controls._searchEntry);
            if (controls._searchController?.searchEntry)
                actors.push(controls._searchController.searchEntry);
            if (controls._thumbnailsBox)
                actors.push(controls._thumbnailsBox);
            if (controls._workspacesThumbnails)
                actors.push(controls._workspacesThumbnails);
            if (controls._appDisplay)
                actors.push(controls._appDisplay);
        }

        return actors.filter(Boolean);
    }

    _getExcludedBoxes() {
        const boxes = [];
        const excludedActors = this._getExcludedActors();

        for (const actor of excludedActors) {
            if (!actor || !actor.visible || actor.mapped === false)
                continue;

            const [x, y] = actor.get_transformed_position?.() ?? [actor.x ?? 0, actor.y ?? 0];
            const [width, height] = actor.get_transformed_size?.() ?? [actor.width ?? 0, actor.height ?? 0];

            if (width > 0 && height > 0)
                boxes.push({x, y, width, height});
        }

        return boxes;
    }

    _enableEventCapture() {
        if (this._capturedEventId !== 0)
            return;

        this._capturedEventId = global.stage.connect(
            'captured-event',
            (stage, event) => this._onCapturedEvent(event)
        );
    }

    _disableEventCapture() {
        if (this._capturedEventId !== 0) {
            global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = 0;
        }
    }

    /**
     * Sorts an array of WindowPreviews into visual reading order (top-to-bottom, left-to-right).
     * @param {Array<WindowPreview>} previews
     * @returns {Array<WindowPreview>}
     */
    _sortPreviewsVisually(previews) {
        if (!previews || previews.length <= 1)
            return previews ? [...previews] : [];

        return sortItemsVisually(previews, p => {
            const [x, y] = p.get_transformed_position?.() ?? [p.x ?? 0, p.y ?? 0];
            const [width, height] = p.get_transformed_size?.() ?? [p.width ?? 0, p.height ?? 0];
            return { x, y, width, height };
        });
    }

    /**
     * Finds all WindowPreviews across all workspaces and monitors in visual reading order.
     * @returns {Array<WindowPreview>}
     */
    getAllWindowPreviews() {
        const previews = [];
        const workspacesDisplay = Main.overview._overview?._controls?._workspacesDisplay;
        if (!workspacesDisplay?._workspacesViews)
            return previews;

        for (const view of workspacesDisplay._workspacesViews) {
            const workspaces = view._workspaces || (view._workspace ? [view._workspace] : []);
            for (const ws of workspaces) {
                if (ws?._windows) {
                    const wsPreviews = [];
                    for (const preview of ws._windows) {
                        if (preview.metaWindow && !preview._destroyed)
                            wsPreviews.push(preview);
                    }
                    previews.push(...this._sortPreviewsVisually(wsPreviews));
                }
            }
        }
        return previews;
    }

    /**
     * Finds active WindowPreviews across monitors in the current workspace in visual reading order.
     * @returns {Array<WindowPreview>}
     */
    getActiveWindowPreviews() {
        const previews = [];
        const workspacesDisplay = Main.overview._overview?._controls?._workspacesDisplay;
        if (!workspacesDisplay?._workspacesViews)
            return previews;

        for (const view of workspacesDisplay._workspacesViews) {
            const ws = view.getActiveWorkspace?.();
            if (ws?._windows) {
                const wsPreviews = [];
                for (const preview of ws._windows) {
                    if (preview.metaWindow && !preview._destroyed)
                        wsPreviews.push(preview);
                }
                previews.push(...this._sortPreviewsVisually(wsPreviews));
            }
        }
        return previews;
    }



    /**
     * Walks actor hierarchy to find if the clicked target belongs to a WindowPreview.
     *
     * @param {Clutter.Actor} actor
     * @returns {WindowPreview|null}
     */
    _findWindowPreview(actor) {
        let current = actor;
        while (current) {
            if (current._delegate instanceof WindowPreview)
                return current._delegate;
            if (current instanceof WindowPreview)
                return current;
            if (current.constructor?.name === 'WindowPreview')
                return current;
            current = current.get_parent();
        }
        return null;
    }

    _isToolbarActor(actor) {
        let current = actor;
        while (current) {
            if (current === this._toolbar)
                return true;
            current = current.get_parent();
        }
        return false;
    }

    _isCloseButton(actor, preview) {
        let current = actor;
        while (current && current !== preview) {
            if (preview && current === preview._closeButton)
                return true;
            if (current.has_style_class_name && current.has_style_class_name('window-close'))
                return true;
            current = current.get_parent();
        }
        return false;
    }

    _onCapturedEvent(event) {
        if (!this._isWindowPickerActive())
            return Clutter.EVENT_PROPAGATE;

        const type = event.type();

        if (type === Clutter.EventType.KEY_PRESS)
            return this._onKeyPress(event);

        if (type === Clutter.EventType.BUTTON_PRESS)
            return this._onButtonPress(event);

        if (type === Clutter.EventType.MOTION)
            return this._onMotion(event);

        if (type === Clutter.EventType.BUTTON_RELEASE)
            return this._onButtonRelease(event);

        return Clutter.EVENT_PROPAGATE;
    }

    _onKeyPress(event) {
        const symbol = event.get_key_symbol();
        const state = event.get_state();
        const isCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;

        if (this._selectionModel.hasSelection) {
            if (symbol === Clutter.KEY_Escape) {
                if (this._toolbar?.isWorkspacePopupOpen?.()) {
                    this._toolbar.closeWorkspacePopup();
                    return Clutter.EVENT_STOP;
                }
                this._selectionModel.clear();
                return Clutter.EVENT_STOP;
            }

            const closeOnDelete = this._settings ? this._settings.get_boolean('close-on-delete-key') : true;
            const isDeleteKey = symbol === Clutter.KEY_Delete || symbol === Clutter.KEY_BackSpace;
            const isCtrlW = isCtrl && (symbol === Clutter.KEY_w || symbol === Clutter.KEY_W);

            if (closeOnDelete && (isDeleteKey || isCtrlW)) {
                this.closeSelectedWindows();
                return Clutter.EVENT_STOP;
            }
        }

        if (isCtrl && (symbol === Clutter.KEY_a || symbol === Clutter.KEY_A)) {
            const previews = this.getAllWindowPreviews();
            const ids = previews.map(p => p.metaWindow.get_id());
            this._selectionModel.selectAll(ids);
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onButtonPress(event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        const [stageX, stageY] = event.get_coords();
        const state = event.get_state();
        const isCtrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const isShift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;

        const actor = global.stage.get_actor_at_pos(
            Clutter.PickMode.REACTIVE,
            stageX,
            stageY
        );

        if (this._isToolbarActor(actor))
            return Clutter.EVENT_PROPAGATE;

        if (this._toolbar?.isWorkspacePopupOpen?.())
            this._toolbar.closeWorkspacePopup();

        const preview = this._findWindowPreview(actor);

        if (preview) {
            const winId = preview.metaWindow.get_id();

            // Native window close button handling
            if (this._isCloseButton(actor, preview)) {
                if (this._selectionModel.isSelected(winId)) {
                    this.closeSelectedWindows();
                    return Clutter.EVENT_STOP;
                }

                if (this._selectionModel.hasSelection) {
                    if (typeof preview._deleteAll === 'function')
                        preview._deleteAll();
                    else
                        preview.metaWindow.delete(global.get_current_time());
                    return Clutter.EVENT_STOP;
                }

                return Clutter.EVENT_PROPAGATE;
            }

            if (isShift) {
                // Continuous range
                const previews = this.getActiveWindowPreviews();
                const orderedIds = previews.map(p => p.metaWindow.get_id());
                this._selectionModel.selectRange(orderedIds, winId);
                return Clutter.EVENT_STOP;
            }

            if (isCtrl || this._selectionModel.hasSelection) {
                // Clicking when there are selected windows behaves the same as Ctrl+click (toggle)
                const isSelected = this._selectionModel.isSelected(winId);
                if (!isSelected) {
                    this._selectionModel.select(winId);
                    this._windowClickTarget = {
                        winId,
                        wasSelected: false,
                        dragged: false,
                        startX: stageX,
                        startY: stageY,
                    };
                } else {
                    // Window already selected: update anchor and defer deselect to button release
                    this._selectionModel.setAnchor(winId);
                    this._windowClickTarget = {
                        winId,
                        wasSelected: true,
                        dragged: false,
                        startX: stageX,
                        startY: stageY,
                    };
                }
                // Allow event to propagate so GNOME Shell DND can initiate drag if pointer moves
                return Clutter.EVENT_PROPAGATE;
            }

            // Normal click with no selection active: propagate to open window
            return Clutter.EVENT_PROPAGATE;
        }

        // Check if target is excluded from initiating rubberband selection
        const previews = this.getActiveWindowPreviews();
        const excludedActors = this._getExcludedActors();
        const excludedBoxes = this._getExcludedBoxes();

        if (!canStartRubberband({
            isWindowPicker: this._isWindowPickerActive(),
            hasWindowPreviews: previews.length > 0,
            point: {x: stageX, y: stageY},
            actor,
            excludedActors,
            excludedBoxes,
        })) {
            return Clutter.EVENT_PROPAGATE;
        }

        // Clicked outside any window preview, in valid overview region
        this._dragPending = true;
        this._dragStartX = stageX;
        this._dragStartY = stageY;
        this._dragIsCtrl = isCtrl;
        this._dragIsShift = isShift;

        return Clutter.EVENT_PROPAGATE;
    }

    _onMotion(event) {
        const [stageX, stageY] = event.get_coords();

        if (this._windowClickTarget && !this._windowClickTarget.dragged) {
            const dx = stageX - this._windowClickTarget.startX;
            const dy = stageY - this._windowClickTarget.startY;
            const threshold = this._settings ? this._settings.get_int('drag-threshold') : DRAG_THRESHOLD;
            if (dx * dx + dy * dy >= threshold * threshold)
                this._windowClickTarget.dragged = true;
        }

        if (this._dragPending && !this._rubberbandActive) {
            const dx = stageX - this._dragStartX;
            const dy = stageY - this._dragStartY;
            const threshold = this._settings ? this._settings.get_int('drag-threshold') : DRAG_THRESHOLD;
            if (dx * dx + dy * dy >= threshold * threshold) {
                this._dragPending = false;
                this._rubberbandActive = true;
                Main.layoutManager.uiGroup.set_child_above_sibling(this._rubberband, null);
                if (this._toolbar && this._toolbar.get_parent() === Main.layoutManager.uiGroup)
                    Main.layoutManager.uiGroup.set_child_above_sibling(this._toolbar, null);
                this._rubberband.start(this._dragStartX, this._dragStartY);
            }
        }

        if (this._rubberbandActive) {
            this._rubberband.update(stageX, stageY);

            const previews = this.getActiveWindowPreviews();
            const items = previews.map(p => {
                const [x, y] = p.get_transformed_position();
                const [width, height] = p.get_transformed_size();
                return {
                    id: p.metaWindow.get_id(),
                    bounds: { x, y, width, height },
                };
            });

            this._selectionModel.selectBox(
                items,
                this._rubberband.getGeometry(),
                { addToSelection: this._dragIsCtrl || this._dragIsShift }
            );

            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onButtonRelease(event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        if (this._windowClickTarget) {
            const target = this._windowClickTarget;
            this._windowClickTarget = null;

            if (!target.dragged) {
                if (target.wasSelected) {
                    // Clicked on an already selected window without dragging: deselect it (toggle)
                    this._selectionModel.deselect(target.winId);
                }
                // Selection mode click: stop event so GNOME Shell does not activate the window preview
                return Clutter.EVENT_STOP;
            }
        }

        if (this._rubberbandActive) {
            this._rubberband.finish();
            this._rubberbandActive = false;
            this._dragPending = false;
            return Clutter.EVENT_STOP;
        }

        if (this._dragPending) {
            this._dragPending = false;
            // Simple click on empty workspace background
            if (this._selectionModel.hasSelection) {
                this._selectionModel.clear();
                return Clutter.EVENT_STOP;
            }
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onSelectionChanged() {
        const previews = this.getAllWindowPreviews();
        for (const preview of previews) {
            const isSelected = this._selectionModel.isSelected(preview.metaWindow.get_id());
            this._highlighter.setHighlighted(preview, isSelected);
        }

        this._updateToolbarPosition();
        this._toolbar.updateSelection(this._selectionModel.count);
    }

    /**
     * Closes all selected windows across all workspaces.
     */
    closeSelectedWindows() {
        const selectedIds = new Set(this._selectionModel.getSelectedIds());
        if (selectedIds.size === 0)
            return;

        const previews = this.getAllWindowPreviews();
        for (const preview of previews) {
            if (selectedIds.has(preview.metaWindow.get_id())) {
                if (typeof preview._deleteAll === 'function')
                    preview._deleteAll();
                else
                    preview.metaWindow.delete(global.get_current_time());
            }
        }

        const nWorkspaces = global.workspace_manager?.get_n_workspaces?.() ?? 0;
        for (let i = 0; i < nWorkspaces; i++) {
            const ws = global.workspace_manager.get_workspace_by_index(i);
            for (const win of ws.list_windows()) {
                if (selectedIds.has(win.get_id()))
                    win.delete(global.get_current_time());
            }
        }

        this._selectionModel.clear();
    }

    /**
     * Moves all selected windows across all workspaces to target workspace.
     *
     * @param {number|string} targetIndex
     * @param {boolean} [isNew=false]
     */
    moveSelectedToWorkspace(targetIndex, isNew = false) {
        const selectedIds = new Set(this._selectionModel.getSelectedIds());
        if (selectedIds.size === 0)
            return;

        const workspaceManager = global.workspace_manager;
        let targetWorkspace;

        if (isNew || targetIndex === 'new') {
            targetWorkspace = workspaceManager.append_new_workspace(
                false,
                global.get_current_time()
            );
        } else if (typeof targetIndex === 'number') {
            targetWorkspace = workspaceManager.get_workspace_by_index(targetIndex);
        }

        if (!targetWorkspace)
            return;

        const targetWsIndex = targetWorkspace.index ? targetWorkspace.index() : targetIndex;
        const movedIds = new Set();

        try {
            this._inDrop = true;
            this._highlighter?.setInDrop?.(true);

            // 1. Move previews on current overview views
            const previews = this.getAllWindowPreviews();
            for (const preview of previews) {
                const win = preview.metaWindow;
                const id = win?.get_id?.();
                if (id && selectedIds.has(id) && !movedIds.has(id)) {
                    movedIds.add(id);
                    if (!win.is_on_all_workspaces?.()) {
                        const monitorIndex = win.get_monitor?.() ?? global.display.get_primary_monitor();
                        if (Main.moveWindowToMonitorAndWorkspace)
                            Main.moveWindowToMonitorAndWorkspace(win, monitorIndex, targetWsIndex, false);
                        else
                            win.change_workspace(targetWorkspace);
                    }
                }
            }

            // 2. Also move selected windows not currently in previews (multi-workspace selection)
            const nWorkspaces = workspaceManager.get_n_workspaces?.() ?? 0;
            for (let i = 0; i < nWorkspaces; i++) {
                const ws = workspaceManager.get_workspace_by_index(i);
                for (const win of ws.list_windows()) {
                    const id = win?.get_id?.();
                    if (id && selectedIds.has(id) && !movedIds.has(id)) {
                        movedIds.add(id);
                        if (!win.is_on_all_workspaces?.()) {
                            const monitorIndex = win.get_monitor?.() ?? global.display.get_primary_monitor();
                            if (Main.moveWindowToMonitorAndWorkspace)
                                Main.moveWindowToMonitorAndWorkspace(win, monitorIndex, targetWsIndex, false);
                            else
                                win.change_workspace(targetWorkspace);
                        }
                    }
                }
            }
        } finally {
            this._inDrop = false;
            this._highlighter?.setInDrop?.(false);
            this._selectionModel.clear();
            this._toolbar?.closeWorkspacePopup?.();
        }
    }

    _onPreviewDragBegin(preview) {
        if (this._windowClickTarget)
            this._windowClickTarget.dragged = true;

        const winId = preview.metaWindow?.get_id?.();
        if (winId && this._selectionModel.isSelected(winId)) {
            this._activeDragSelectedIds = new Set(this._selectionModel.getSelectedIds());
            this._setOtherSelectedPreviewsDimmed(winId, true);
        }
    }

    _onPreviewDragEnd(_preview) {
        this._setOtherSelectedPreviewsDimmed(null, false);
        if (!this._inDrop)
            this._activeDragSelectedIds = null;
    }

    _setOtherSelectedPreviewsDimmed(excludeWinId, dimmed) {
        const previews = this.getAllWindowPreviews();
        for (const preview of previews) {
            const id = preview.metaWindow?.get_id?.();
            if (id && this._activeDragSelectedIds?.has(id) && id !== excludeWinId) {
                preview.opacity = dimmed ? 140 : 255;
            } else if (!dimmed && preview.opacity !== 255) {
                preview.opacity = 255;
            }
        }
    }

    _captureSelectedIdsForDrop(winId) {
        if (!winId)
            return null;

        if (this._activeDragSelectedIds && this._activeDragSelectedIds.has(winId))
            return new Set(this._activeDragSelectedIds);

        if (this._selectionModel.isSelected(winId))
            return new Set(this._selectionModel.getSelectedIds());

        return null;
    }

    /**
     * Hooks overview drop targets (Workspace, WorkspaceThumbnail, and ThumbnailsBox)
     * so that dragging any selected window to another workspace moves all selected windows across all workspaces.
     */
    _setupDragAndDropHook() {
        const self = this;

        this._origWorkspaceAcceptDrop = Workspace.prototype.acceptDrop;
        Workspace.prototype.acceptDrop = function (source, actor, x, y, time) {
            const window = source?.metaWindow;
            const winId = window?.get_id?.();
            const workspaceManager = global.workspace_manager;
            const workspaceIndex = this.metaWorkspace
                ? this.metaWorkspace.index()
                : workspaceManager.get_active_workspace_index();
            const monitorIndex = this.monitorIndex;

            const selectedIds = self._captureSelectedIdsForDrop(winId);

            let accepted = false;
            try {
                self._inDrop = true;
                self._highlighter?.setInDrop?.(true);
                accepted = self._origWorkspaceAcceptDrop.call(this, source, actor, x, y, time);
                if (accepted && selectedIds)
                    self._moveOtherSelectedWindows(winId, selectedIds, monitorIndex, workspaceIndex, false);
            } finally {
                self._inDrop = false;
                self._highlighter?.setInDrop?.(false);
            }
            return accepted;
        };

        this._origThumbnailAcceptDropInternal = WorkspaceThumbnail.prototype.acceptDropInternal;
        WorkspaceThumbnail.prototype.acceptDropInternal = function (source, actor, time) {
            let metaWindow = null;
            if (source?.metaWindow) {
                const win = source.metaWindow.get_compositor_private();
                metaWindow = win?.get_meta_window ? win.get_meta_window() : source.metaWindow;
            }
            const winId = metaWindow?.get_id?.();
            const workspaceIndex = this.metaWorkspace ? this.metaWorkspace.index() : 0;
            const monitorIndex = this.monitorIndex;

            const selectedIds = self._captureSelectedIdsForDrop(winId);

            let accepted = false;
            try {
                self._inDrop = true;
                self._highlighter?.setInDrop?.(true);
                accepted = self._origThumbnailAcceptDropInternal.call(this, source, actor, time);
                if (accepted && selectedIds)
                    self._moveOtherSelectedWindows(winId, selectedIds, monitorIndex, workspaceIndex, false);
            } finally {
                self._inDrop = false;
                self._highlighter?.setInDrop?.(false);
            }
            return accepted;
        };

        this._origThumbnailsBoxAcceptDrop = ThumbnailsBox.prototype.acceptDrop;
        ThumbnailsBox.prototype.acceptDrop = function (source, actor, x, y, time) {
            const dropPlaceholderPos = this._dropPlaceholderPos;
            const metaWindow = source?.metaWindow;
            const winId = metaWindow?.get_id?.();

            const selectedIds = self._captureSelectedIdsForDrop(winId);

            let accepted = false;
            try {
                self._inDrop = true;
                self._highlighter?.setInDrop?.(true);
                accepted = self._origThumbnailsBoxAcceptDrop.call(this, source, actor, x, y, time);
                if (accepted && selectedIds && dropPlaceholderPos !== -1) {
                    const thumbMonitor = this._thumbnails?.[dropPlaceholderPos]?.monitorIndex ?? global.display.get_primary_monitor();
                    self._moveOtherSelectedWindows(winId, selectedIds, thumbMonitor, dropPlaceholderPos, true);
                }
            } finally {
                self._inDrop = false;
                self._highlighter?.setInDrop?.(false);
            }
            return accepted;
        };
    }

    _moveOtherSelectedWindows(winId, selectedIds, monitorIndex, workspaceIndex, append = false) {
        this._setOtherSelectedPreviewsDimmed(null, false);

        const idsToMove = new Set(selectedIds);
        if (winId)
            idsToMove.delete(winId);

        if (idsToMove.size === 0) {
            this._selectionModel.clear();
            this._activeDragSelectedIds = null;
            return;
        }

        const movedIds = new Set();

        // 1. Move all other selected windows across all window previews
        const previews = this.getAllWindowPreviews();
        for (const preview of previews) {
            const pWin = preview.metaWindow;
            const id = pWin?.get_id?.();
            if (id && idsToMove.has(id) && !movedIds.has(id)) {
                movedIds.add(id);
                if (!pWin.is_on_all_workspaces?.())
                    Main.moveWindowToMonitorAndWorkspace(pWin, monitorIndex, workspaceIndex, append);
            }
        }

        // 2. Also check if any selected window was not covered by previews
        const workspaceManager = global.workspace_manager;
        const nWorkspaces = workspaceManager?.get_n_workspaces?.() ?? 0;
        for (let i = 0; i < nWorkspaces; i++) {
            const ws = workspaceManager.get_workspace_by_index(i);
            for (const win of ws.list_windows()) {
                const id = win?.get_id?.();
                if (id && idsToMove.has(id) && !movedIds.has(id)) {
                    movedIds.add(id);
                    if (!win.is_on_all_workspaces?.())
                        Main.moveWindowToMonitorAndWorkspace(win, monitorIndex, workspaceIndex, append);
                }
            }
        }

        this._selectionModel.clear();
        this._activeDragSelectedIds = null;
    }

    _updateColorOverride() {
        const color = this._highlighter.colorOverride;
        this._rubberband.setColorOverride(color);
        this._toolbar.setColorOverride(color);
    }

    /**
     * Cleans up all resources, event listeners, and actors.
     */
    destroy() {
        this._setOtherSelectedPreviewsDimmed(null, false);
        this._activeDragSelectedIds = null;

        global.workspace_manager.disconnectObject(this);

        if (this._settings)
            this._settings.disconnectObject(this);

        if (this._origWorkspaceAcceptDrop) {
            Workspace.prototype.acceptDrop = this._origWorkspaceAcceptDrop;
            this._origWorkspaceAcceptDrop = null;
        }

        if (this._origThumbnailAcceptDropInternal) {
            WorkspaceThumbnail.prototype.acceptDropInternal = this._origThumbnailAcceptDropInternal;
            this._origThumbnailAcceptDropInternal = null;
        }

        if (this._origThumbnailsBoxAcceptDrop) {
            ThumbnailsBox.prototype.acceptDrop = this._origThumbnailsBoxAcceptDrop;
            this._origThumbnailsBoxAcceptDrop = null;
        }

        this._disableEventCapture();
        Main.overview.disconnectObject(this);

        const dash = Main.overview?.dash;
        if (dash) {
            dash.showAppsButton?.disconnectObject?.(this);
            dash.disconnectObject(this);
        }

        const controls = Main.overview._overview?._controls;
        if (controls) {
            controls._stateAdjustment?.disconnectObject?.(this);
            controls._searchController?.disconnectObject?.(this);
        }

        this._selectionModel.clear();
        this._highlighter.destroy();

        if (this._rubberband.get_parent())
            this._rubberband.get_parent().remove_child(this._rubberband);
        this._rubberband.destroy();
        this._toolbar.destroy();
    }
}

