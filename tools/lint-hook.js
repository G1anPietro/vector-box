// Hook PostToolUse: dopo Edit/Write controlla la sintassi del file (php -l / node --check).
// Exit 2 = l'errore torna a Claude, che lo corregge subito.
const { execFileSync } = require('child_process');
let raw = ''; process.stdin.on('data', d => raw += d).on('end', () => {
  const f = (JSON.parse(raw || '{}').tool_input || {}).file_path || '';
  const cmd = f.endsWith('.php') ? ['php', ['-l', f]] : f.endsWith('.js') ? ['node', ['--check', f]] : null;
  if (!cmd) return;
  try { execFileSync(cmd[0], cmd[1], { stdio: 'pipe' }); }
  catch (e) { console.error(String(e.stderr || e.stdout || e.message)); process.exit(2); }
});
