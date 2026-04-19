with open("src/multiplayer.js", "r") as f:
    content = f.read()

import re

search = """function handleDragBroadcast(payload) {
  if (!g_isMultiplayer || !payload) return;

  if (typeof payload.seq === 'number') {
    if (payload.seq <= g_lastRemoteDragSeq) return;
    g_lastRemoteDragSeq = payload.seq;
  }

  if (payload.action === 'preview') {
    applyDragPreview(payload);
    return;
  }

  if (payload.action === 'clear') {
    applyDragSourceClear(payload);
    return;
  }

  if (payload.end) {
    if (g_dragGhost) {
      g_dragGhost.remove();
      g_dragGhost = null;
    }
    return;
  }"""

replace = """function handleDragBroadcast(payload) {
  if (!g_isMultiplayer || !payload) return;

  if (typeof payload.seq === 'number') {
    if (payload.seq <= g_lastRemoteDragSeq) return;
    g_lastRemoteDragSeq = payload.seq;
  }

  if (payload.end) {
    console.log("handleDragBroadcast END payload received");
  } else if (payload.action) {
    console.log("handleDragBroadcast ACTION payload received", payload.action);
  }

  if (payload.action === 'preview') {
    applyDragPreview(payload);
    return;
  }

  if (payload.action === 'clear') {
    applyDragSourceClear(payload);
    return;
  }

  if (payload.end) {
    if (g_dragGhost) {
      g_dragGhost.remove();
      g_dragGhost = null;
    }
    return;
  }"""

if search in content:
    content = content.replace(search, replace)
    with open("src/multiplayer.js", "w") as f:
        f.write(content)
    print("Patched handleDragBroadcast with logging")
else:
    print("Could not find handleDragBroadcast")
