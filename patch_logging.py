with open("src/multiplayer.js", "r") as f:
    content = f.read()

import re

search = """function localizeDragPosition(payload) {
  if (!payload || typeof payload.x !== 'number' || typeof payload.y !== 'number') return null;

  var x = payload.x;
  var y = payload.y;
  var sourceId = payload.sourceId;

  if (typeof sourceId === 'string' && (sourceId.startsWith('pl') || sourceId.startsWith('op') || sourceId.charAt(0) === 'b')) {
    var localSourceId = mapRemoteRackCellId(sourceId);
    var localSourceCell = el(localSourceId);
    var isBoard = sourceId.charAt(0) === 'b';

    if (localSourceCell && typeof payload.sourceCenterX === 'number' && typeof payload.sourceCenterY === 'number') {
      var localRect = localSourceCell.getBoundingClientRect();
      var offsetX = payload.x - payload.sourceCenterX;
      var offsetY = payload.y - payload.sourceCenterY;

      if (isBoard) {
        x = localRect.left + localRect.width / 2 + offsetX;
        y = localRect.top + localRect.height / 2 + offsetY;
      } else {
        x = localRect.left + localRect.width / 2 - offsetX;
        y = localRect.top + localRect.height / 2 - offsetY;
      }
    } else {
      var dragArea = el('drag');
      if (dragArea) {
        var dragRect = dragArea.getBoundingClientRect();
        if (isBoard) {
          x = payload.x;
          y = payload.y;
        } else {
          x = dragRect.left + dragRect.width - (payload.x - dragRect.left);
          y = dragRect.top + dragRect.height - (payload.y - dragRect.top);
        }
      }
    }
  }

  return { x: x, y: y };
}"""

replace = """function localizeDragPosition(payload) {
  if (!payload || typeof payload.x !== 'number' || typeof payload.y !== 'number') return null;

  var x = payload.x;
  var y = payload.y;
  var sourceId = payload.sourceId;

  console.log("localizeDragPosition START:", JSON.stringify(payload));

  if (typeof sourceId === 'string' && (sourceId.startsWith('pl') || sourceId.startsWith('op') || sourceId.charAt(0) === 'b')) {
    var localSourceId = mapRemoteRackCellId(sourceId);
    var localSourceCell = el(localSourceId);
    var isBoard = sourceId.charAt(0) === 'b';

    console.log("localizeDragPosition source mapped:", sourceId, "->", localSourceId, "isBoard:", isBoard);

    if (localSourceCell && typeof payload.sourceCenterX === 'number' && typeof payload.sourceCenterY === 'number') {
      var localRect = localSourceCell.getBoundingClientRect();
      var offsetX = payload.x - payload.sourceCenterX;
      var offsetY = payload.y - payload.sourceCenterY;

      console.log("localizeDragPosition localCell:", localRect.left, localRect.top, localRect.width, localRect.height);
      console.log("localizeDragPosition offsets:", offsetX, offsetY);

      if (isBoard) {
        x = localRect.left + localRect.width / 2 + offsetX;
        y = localRect.top + localRect.height / 2 + offsetY;
      } else {
        x = localRect.left + localRect.width / 2 - offsetX;
        y = localRect.top + localRect.height / 2 - offsetY;
      }
    } else {
      console.log("localizeDragPosition fallback (no cell or no sourceCenter)");
      var dragArea = el('drag');
      if (dragArea) {
        var dragRect = dragArea.getBoundingClientRect();
        if (isBoard) {
          x = payload.x;
          y = payload.y;
        } else {
          x = dragRect.left + dragRect.width - (payload.x - dragRect.left);
          y = dragRect.top + dragRect.height - (payload.y - dragRect.top);
        }
      }
    }
  }

  console.log("localizeDragPosition END:", x, y);
  return { x: x, y: y };
}"""

if search in content:
    content = content.replace(search, replace)
    with open("src/multiplayer.js", "w") as f:
        f.write(content)
    print("Patched localizeDragPosition with logging")
else:
    print("Could not find block to replace")
