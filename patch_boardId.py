with open("src/multiplayer.js", "r") as f:
    content = f.read()

# Replace hardcoded 'b' with g_bui.boardId where applicable
# For string literals handling the board prefix
content = content.replace("sourceId.charAt(0) === 'b'", "sourceId.charAt(0) === (typeof g_bui !== 'undefined' ? g_bui.boardId : 'c')")
content = content.replace("sourceId.charAt(0) !== 'b'", "sourceId.charAt(0) !== (typeof g_bui !== 'undefined' ? g_bui.boardId : 'c')")
content = content.replace("fromId.charAt(0) === 'b'", "fromId.charAt(0) === (typeof g_bui !== 'undefined' ? g_bui.boardId : 'c')")
content = content.replace("toId.charAt(0) === 'b'", "toId.charAt(0) === (typeof g_bui !== 'undefined' ? g_bui.boardId : 'c')")

# Also replace hardcoded 'b' in el('b' + y + '_' + x) to use the boardId
content = content.replace("el('b' + y + '_' + x)", "el((typeof g_bui !== 'undefined' ? g_bui.boardId : 'c') + y + '_' + x)")

with open("src/multiplayer.js", "w") as f:
    f.write(content)
print("Patched board ID checks in multiplayer.js")
