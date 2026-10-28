// public/js/window_manager.js
document.addEventListener("DOMContentLoaded", () => {
    let topZIndex = 100;

    const makeWindowInteractive = (winEl, id) => {
        // Ensure absolute positioning
        winEl.style.position = 'absolute';

        // Restore saved position/size if available
        const savedState = localStorage.getItem(`win_state_${id}`);
        if (savedState) {
            try {
                const state = JSON.parse(savedState);
                if (state.left) winEl.style.left = state.left;
                if (state.top) winEl.style.top = state.top;
                if (state.width) winEl.style.width = state.width;
                if (state.height) winEl.style.height = state.height;
            } catch (e) {}
        }

        const saveState = () => {
            const state = {
                left: winEl.style.left,
                top: winEl.style.top,
                width: winEl.style.width,
                height: winEl.style.height
            };
            localStorage.setItem(`win_state_${id}`, JSON.stringify(state));
        };

        // Bring window to top on click
        winEl.addEventListener('mousedown', () => {
            topZIndex++;
            winEl.style.zIndex = topZIndex;
        });

        // Add drag handle targeting top header bar
        const header = winEl.querySelector('.window-header') || winEl.firstElementChild;
        if (header) {
            header.style.cursor = 'move';
            header.style.userSelect = 'none';

            let isDragging = false;
            let startX, startY, startLeft, startTop;

            header.addEventListener('mousedown', (e) => {
                // Ignore if clicked on buttons or input elements
                if (['INPUT', 'BUTTON', 'A', 'TEXTAREA'].includes(e.target.tagName)) return;

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
                    saveState();
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        }

        // Add 8-direction resize handles
        const handles = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
        handles.forEach(dir => {
            const handle = document.createElement('div');
            handle.className = `resize-handle resize-${dir}`;
            winEl.appendChild(handle);

            handle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();

                topZIndex++;
                winEl.style.zIndex = topZIndex;

                const startX = e.clientX;
                const startY = e.clientY;
                const startW = winEl.offsetWidth;
                const startH = winEl.offsetHeight;
                const startLeft = winEl.offsetLeft;
                const startTop = winEl.offsetTop;

                const onResize = (moveEvent) => {
                    const dx = moveEvent.clientX - startX;
                    const dy = moveEvent.clientY - startY;

                    if (dir.includes('e')) winEl.style.width = `${Math.max(250, startW + dx)}px`;
                    if (dir.includes('s')) winEl.style.height = `${Math.max(150, startH + dy)}px`;
                    
                    if (dir.includes('w')) {
                        const newW = Math.max(250, startW - dx);
                        winEl.style.width = `${newW}px`;
                        winEl.style.left = `${startLeft + (startW - newW)}px`;
                    }
                    if (dir.includes('n')) {
                        const newH = Math.max(150, startH - dy);
                        winEl.style.height = `${newH}px`;
                        winEl.style.top = `${startTop + (startH - newH)}px`;
                    }
                };

                const stopResize = () => {
                    saveState();
                    document.removeEventListener('mousemove', onResize);
                    document.removeEventListener('mouseup', stopResize);
                };

                document.addEventListener('mousemove', onResize);
                document.addEventListener('mouseup', stopResize);
            });
        });
    };

    // Initialize all elements marked with .draggable-window
    document.querySelectorAll('.draggable-window').forEach((el, index) => {
        const windowId = el.id || `win_${index}`;
        makeWindowInteractive(el, windowId);
    });
});