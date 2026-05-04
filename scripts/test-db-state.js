// Paste this into your browser console while in a multiplayer game
// It will check if the games row exists and show the current state

async function testDBState() {
  const { data, error } = await window.supabaseClient
    .from('games')
    .select('id, version, updated_at')
    .eq('id', g_gameId)
    .single();
  
  if (error) {
    console.error('DB Error:', error);
    return;
  }
  
  console.log('Game row found:', data);
  console.log('DB Version:', data.version);
  console.log('Local g_dbVersion:', g_dbVersion);
  console.log('Updated at:', new Date(data.updated_at).toLocaleTimeString());
}

testDBState();
