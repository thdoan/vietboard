with open("src/multiplayer.js", "r") as f:
    content = f.read()

import re

search = """function applyDragPreview(payload) {
  if (!payload || !payload.fromId || !payload.toId) return;

  var fromId = mapRemoteRackCellId(payload.fromId);
  var toId = mapRemoteRackCellId(payload.toId);
  if (fromId === toId) return;

  // Phase 3: Prevent stale previews from leaving revealed opponent letters in rack.
  // If source is board and target is opponent rack, verify the tile is actually being returned
  // (not a stale preview trying to move it to a wrong location).
  if (fromId.charAt(0) === 'b' && toId.indexOf('op') === 0) {
    var fromCell = el(fromId);
    if (fromCell && fromCell.holds && fromCell.holds.letter) {
      // Tile is on board: allow the preview to move it back to rack
    } else {
      return;
    }
  }

  var fromCell = el(fromId);
  var toCell = el(toId);

  if (fromId && fromId.charAt(0) === 'b' && fromCell) {
    fromCell.innerHTML = '';
  }

  if (!toCell) return;

  if (toId && toId.charAt(0) === 'b') {
    renderOpponentRackTileBack(toCell);
    // Explicitly re-initialize REDIPS drag so the newly created innerHTML element is properly recognized by the drag system
    if (g_bui && g_bui.rd && typeof g_bui.rd.init === 'function') {
      // Pass the cell so we don't re-init the whole page
      g_bui.rd.init();
      g_bui.rd.enableDrag(false, toCell.firstChild);
    }
  } else if (toId && toId.indexOf('op') === 0) {
    renderOpponentRackTileBack(toCell);
  }
}"""

replace = """function applyDragPreview(payload) {
  console.log("applyDragPreview START", JSON.stringify(payload));
  if (!payload || !payload.fromId || !payload.toId) return;

  var fromId = mapRemoteRackCellId(payload.fromId);
  var toId = mapRemoteRackCellId(payload.toId);
  if (fromId === toId) return;

  // Phase 3: Prevent stale previews from leaving revealed opponent letters in rack.
  // If source is board and target is opponent rack, verify the tile is actually being returned
  // (not a stale preview trying to move it to a wrong location).
  if (fromId.charAt(0) === 'b' && toId.indexOf('op') === 0) {
    var fromCell = el(fromId);
    if (fromCell && fromCell.holds && fromCell.holds.letter) {
      // Tile is on board: allow the preview to move it back to rack
    } else {
      return;
    }
  }

  var fromCell = el(fromId);
  var toCell = el(toId);

  if (fromId && fromId.charAt(0) === 'b' && fromCell) {
    fromCell.innerHTML = '';
  }

  if (!toCell) return;

  if (toId && toId.charAt(0) === 'b') {
    renderOpponentRackTileBack(toCell);
    console.log("applyDragPreview: rendered back tile on board", toId);
    // Explicitly re-initialize REDIPS drag so the newly created innerHTML element is properly recognized by the drag system
    if (g_bui && g_bui.rd && typeof g_bui.rd.init === 'function') {
      // Pass the cell so we don't re-init the whole page
      g_bui.rd.init();
      g_bui.rd.enableDrag(false, toCell.firstChild);
    }
  } else if (toId && toId.indexOf('op') === 0) {
    renderOpponentRackTileBack(toCell);
  }
}"""

if search in content:
    content = content.replace(search, replace)
    with open("src/multiplayer.js", "w") as f:
        f.write(content)
    print("Patched applyDragPreview with logging")
else:
    print("Could not find applyDragPreview")
