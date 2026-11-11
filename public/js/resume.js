// public/js/resume.js — "Print or save as PDF" button (inline handlers would be blocked by the CSP).
document.getElementById('print')?.addEventListener('click', () => window.print());
