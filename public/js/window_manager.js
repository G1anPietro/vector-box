// public/js/window_manager.js
document.addEventListener("DOMContentLoaded", () => {
    let topZIndex = 100;

    const readSavedWindowState = (winId) => {
        if (typeof window.getSystemCookie === 'function') {
            const cookieVal = window.getSystemCookie(`win_state_${winId}`);
            if (cookieVal) {
                try { return JSON.parse(cookieVal); } catch (e) {}
            }
        }
        try {
            const localVal = localStorage.getItem(`win_state_${winId}`);
            if (localVal) return JSON.parse(localVal);
        } catch (e) {}
        return null;
    };

    const writeSavedWindowState = (winId, state) => {
        const jsonStr = JSON.stringify(state);
        if (typeof window.setSystemCookie === 'function') {
            window.setSystemCookie(`win_state_${winId}`, jsonStr, 30);
        }
        try {
            localStorage.setItem(`win_state_${winId}`, jsonStr);
        } catch (e) {}
    };

    const saveWindowState = (winEl) => {
        const id = winEl.id;
        if (!id) return;
        const isHidden = winEl.classList.contains('hidden') || winEl.style.display === 'none';
        const isMaximized = winEl.classList.contains('maximized');
        
        const state = {
            left: winEl.style.left,
            top: winEl.style.top,
            width: winEl.style.width,
            height: winEl.style.height,
            zIndex: winEl.style.zIndex || 100,
            isOpen: !isHidden,
            isMaximized: isMaximized
        };
        writeSavedWindowState(id, state);
    };

    window.bringToFront = (winEl) => {
        if (!winEl) return;
        topZIndex++;
        winEl.style.zIndex = topZIndex;
        winEl.classList.remove('hidden');
        winEl.style.display = 'flex';

        const tbBtn = document.getElementById('tb-' + winEl.id);
        if (tbBtn) tbBtn.classList.add('active');

        saveWindowState(winEl);
    };

    window.openWindow = (winId) => {
        const win = document.getElementById(winId);
        if (win) {
            window.bringToFront(win);
        }
    };

    window.closeWindow = (winId) => {
        const win = document.getElementById(winId);
        const tbBtn = document.getElementById('tb-' + winId);
        if (win) {
            win.classList.add('hidden');
            win.style.display = 'none';
            saveWindowState(win);
        }
        if (tbBtn) tbBtn.classList.remove('active');
    };

    window.toggleMinimize = (winId) => {
        const win = document.getElementById(winId);
        const tbBtn = document.getElementById('tb-' + winId);
        if (win) {
            if (win.style.display === 'none' || win.classList.contains('hidden')) {
                window.openWindow(winId);
            } else {
                win.style.display = 'none';
                if (tbBtn) tbBtn.classList.remove('active');
                saveWindowState(win);
            }
        }
    };

    window.toggleMaximize = (winId) => {
        const win = document.getElementById(winId);
        if (win) {
            win.classList.toggle('maximized');
            window.bringToFront(win);
            saveWindowState(win);
        }
    };

    window.toggleTaskbarWindow = (winId) => {
        const win = document.getElementById(winId);
        if (win) {
            if (win.classList.contains('hidden') || win.style.display === 'none') {
                window.openWindow(winId);
            } else {
                window.toggleMinimize(winId);
            }
        }
    };

    document.querySelectorAll('.win-btn-min').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const win = e.target.closest('.draggable-window');
            if (win) window.toggleMinimize(win.id);
        });
    });

    document.querySelectorAll('.win-btn-max').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const win = e.target.closest('.draggable-window');
            if (win) window.toggleMaximize(win.id);
        });
    });

    document.querySelectorAll('.win-btn-close').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const win = e.target.closest('.draggable-window');
            if (win) window.closeWindow(win.id);
        });
    });

    document.querySelectorAll('.taskbar-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const winId = btn.id.replace('tb-', '');
            window.toggleTaskbarWindow(winId);
        });
    });

    const makeWindowInteractive = (winEl, id) => {
        winEl.style.position = 'absolute';

        const savedState = readSavedWindowState(id);
        if (savedState) {
            if (savedState.left) winEl.style.left = savedState.left;
            if (savedState.top) winEl.style.top = savedState.top;
            if (savedState.width) winEl.style.width = savedState.width;
            if (savedState.height) winEl.style.height = savedState.height;
            if (savedState.zIndex) {
                winEl.style.zIndex = savedState.zIndex;
                topZIndex = Math.max(topZIndex, parseInt(savedState.zIndex, 10));
            }
            if (savedState.isMaximized) winEl.classList.add('maximized');

            if (savedState.isOpen === false) {
                winEl.classList.add('hidden');
                winEl.style.display = 'none';
                const tbBtn = document.getElementById('tb-' + id);
                if (tbBtn) tbBtn.classList.remove('active');
            } else if (savedState.isOpen === true) {
                winEl.classList.remove('hidden');
                winEl.style.display = 'flex';
                const tbBtn = document.getElementById('tb-' + id);
                if (tbBtn) tbBtn.classList.add('active');
            }
        }

        winEl.addEventListener('mousedown', () => {
            window.bringToFront(winEl);
        });

        const header = winEl.querySelector('.window-header') || winEl.firstElementChild;
        if (header) {
            header.style.cursor = 'move';
            header.style.userSelect = 'none';

            let isDragging = false;
            let startX, startY, startLeft, startTop;

            header.addEventListener('mousedown', (e) => {
                if (['INPUT', 'BUTTON', 'A', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                startLeft = winEl.offsetLeft;
                startTop = winEl.offsetTop;

                const onMouseMove = (moveEvent) => {
                    if (!isDragging) return;
                    const dx = moveEvent.clientX - startX;
                    const dy = moveEvent.clientY - startY;
                    winEl.style.left = `${startLeft + dx}px`;
                    winEl.style.top = `${startTop + dy}px`;
                };

                const onMouseUp = () => {
                    isDragging = false;
                    saveWindowState(winEl);
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        }

        const handles = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
        handles.forEach(dir => {
            const handle = document.createElement('div');
            handle.className = `resize-handle resize-${dir}`;
            winEl.appendChild(handle);

            handle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();

                window.bringToFront(winEl);

                const startX = e.clientX;
                const startY = e.clientY;
                const startW = winEl.offsetWidth;
                const startH = winEl.offsetHeight;
                const startLeft = winEl.offsetLeft;
                const startTop = winEl.offsetTop;

                const onResize = (moveEvent) => {
                    const dx = moveEvent.clientX - startX;
                    const dy = moveEvent.clientY - startY;

                    if (dir.includes('e')) winEl.style.width = `${Math.max(280, startW + dx)}px`;
                    if (dir.includes('s')) winEl.style.height = `${Math.max(180, startH + dy)}px`;
                    
                    if (dir.includes('w')) {
                        const newW = Math.max(280, startW - dx);
                        winEl.style.width = `${newW}px`;
                        winEl.style.left = `${startLeft + (startW - newW)}px`;
                    }
                    if (dir.includes('n')) {
                        const newH = Math.max(180, startH - dy);
                        winEl.style.height = `${newH}px`;
                        winEl.style.top = `${startTop + (startH - newH)}px`;
                    }
                };

                const stopResize = () => {
                    saveWindowState(winEl);
                    document.removeEventListener('mousemove', onResize);
                    document.removeEventListener('mouseup', stopResize);
                };

                document.addEventListener('mousemove', onResize);
                document.addEventListener('mouseup', stopResize);
            });
        });
    };

    document.querySelectorAll('.draggable-window').forEach((el, index) => {
        const windowId = el.id || `win_${index}`;
        makeWindowInteractive(el, windowId);
    });
});