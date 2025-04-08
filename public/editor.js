// editor.js - Course Editor Logic

console.log("Editor script loaded.");

// --- Socket.IO Connection (Add this at the top level) ---
let socket;
try {
    socket = io(); // Assumes server is serving socket.io client
    console.log("Socket.IO connection attempt initialized.");

    socket.on('connect', () => {
        console.log('Connected to editor backend!', socket.id);
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from editor backend.');
    });

    socket.on('connect_error', (err) => {
        console.error('Socket connection error:', err);
        // Optionally provide feedback to the user
        alert("Error connecting to the server. Saving might not work.");
    });

} catch (error) {
    console.error("Socket.IO client not available. Make sure server is running and script is loaded.", error);
    alert("Could not initialize server connection. Saving will not work.");
}

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('editor-canvas');
    const ctx = canvas.getContext('2d');
    const paletteContainer = document.getElementById('palette');
    const selectedTileDisplay = document.getElementById('selected-tile');
    const saveButton = document.getElementById('save-button');
    const courseNameInput = document.getElementById('course-name');

    if (!canvas || !ctx || !paletteContainer || !selectedTileDisplay || !saveButton || !courseNameInput) {
        console.error("Editor HTML elements not found!");
        return;
    }

    // --- Configuration ---
    const TILE_SIZE = 32; // pixels
    const GRID_WIDTH = 40; // tiles
    const GRID_HEIGHT = 30; // tiles
    const IMAGE_PATH_PREFIX = '/'; // Assuming textures/ and Sprites/ are relative to root
    canvas.width = TILE_SIZE * GRID_WIDTH;
    canvas.height = TILE_SIZE * GRID_HEIGHT;

    // --- State ---
    let selectedTileType = null;
    let courseData = {
        name: "Untitled Course",
        startPosition: { x: Math.floor(GRID_WIDTH / 2), y: Math.floor(GRID_HEIGHT - 2), direction: 0 }, // x, y in grid coords, direction 0=N, 1=E, 2=S, 3=W
        tiles: [], // Array of { x, y, type, variant? }
        elements: [] // Array of { x, y, type, rotation? }
    };
    let images = {}; // To store preloaded images
    let imagesLoaded = false;

    // Initialize grid data
    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            courseData.tiles.push({ x, y, type: 'grass' }); // Default to grass
        }
    }

    // --- Palette Definition ---
    const paletteItems = [
        { id: 'grass', label: 'Grass', type: 'tile' },
        { id: 'mud', label: 'Mud', type: 'tile' },
        { id: 'road_v', label: 'Road (V)', type: 'tile', texture: 'road', variant: 'v' },
        { id: 'road_h', label: 'Road (H)', type: 'tile', texture: 'road', variant: 'h' },
        // Road Curves (Names indicate direction: start_end)
        { id: 'road_ne', label: 'Road (NE)', type: 'tile', texture: 'road', variant: 'ne' }, // North to East
        { id: 'road_nw', label: 'Road (NW)', type: 'tile', texture: 'road', variant: 'nw' }, // North to West
        { id: 'road_se', label: 'Road (SE)', type: 'tile', texture: 'road', variant: 'se' }, // South to East
        { id: 'road_sw', label: 'Road (SW)', type: 'tile', texture: 'road', variant: 'sw' }, // South to West
        // 45 degree turns? Might need different assets or logic
        { id: 'startfinish', label: 'Start/Finish', type: 'tile', texture: 'startfinishline', variant:'h' },
        { id: 'startgate', label: 'Start Gate', type: 'element' },
        { id: 'blueblock', label: 'Blue Block', type: 'element' },
        { id: 'greenblock', label: 'Green Block', type: 'element' },
        { id: 'darkgreenblock', label: 'Dk Green Block', type: 'element' },
        { id: 'redblock', label: 'Red Block', type: 'element' },
        { id: 'yellowblock', label: 'Yellow Block', type: 'element' },
        { id: 'tiresred', label: 'Red Tires', type: 'element' },
        { id: 'tireswhite', label: 'White Tires', type: 'element' },
        { id: 'start_pos', label: 'Start Position', type: 'special' },
        { id: 'delete', label: 'Delete', type: 'special' }, // Added delete tool
    ];

    // --- Setup Functions ---
    async function preloadImages() {
        const imageSources = {
            // Ground Textures
            'grass': IMAGE_PATH_PREFIX + 'textures/grass.png',
            'mud': IMAGE_PATH_PREFIX + 'textures/mud.png',
            'road': IMAGE_PATH_PREFIX + 'textures/road.png',
            'stripedline': IMAGE_PATH_PREFIX + 'textures/stripedline.png',
            'startfinishline': IMAGE_PATH_PREFIX + 'textures/startfinishline.png',
            // Elements
            'startgate': IMAGE_PATH_PREFIX + 'Sprites/courseelements/startgate.png',
            'blueblock': IMAGE_PATH_PREFIX + 'Sprites/courseelements/blueblock.png',
            'greenblock': IMAGE_PATH_PREFIX + 'Sprites/courseelements/greenblock.png',
            'darkgreenblock': IMAGE_PATH_PREFIX + 'Sprites/courseelements/darkgreenblock.png',
            'redblock': IMAGE_PATH_PREFIX + 'Sprites/courseelements/redblock.png',
            'yellowblock': IMAGE_PATH_PREFIX + 'Sprites/courseelements/yellowblock.png',
            'tiresred': IMAGE_PATH_PREFIX + 'Sprites/courseelements/tiresred.png',
            'tireswhite': IMAGE_PATH_PREFIX + 'Sprites/courseelements/tireswhite.png'
            // Add curve textures if they are separate files, otherwise we rotate road.png
            // 'road_curve': IMAGE_PATH_PREFIX + 'textures/road_curve.png', // REMOVED - Assuming a single curve asset exists
        };

        const promises = Object.entries(imageSources).map(([id, src]) => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    images[id] = img;
                    console.log(`Loaded image: ${id}`);
                    resolve();
                };
                img.onerror = () => {
                    console.error(`Failed to load image: ${id} at ${src}`);
                    reject(new Error(`Failed to load ${id}`));
                };
                img.src = src;
            });
        });

        try {
            await Promise.all(promises);
            imagesLoaded = true;
            console.log("All editor images loaded.");
        } catch (error) {
            console.error("Error preloading images:", error);
            // Handle image loading failure (e.g., show error message)
            alert("Failed to load some editor assets. Editor may not work correctly.");
        }
    }

    function setupPalette() {
        paletteItems.forEach(item => {
            const div = document.createElement('div');
            div.classList.add('palette-item');
            div.textContent = item.label;
            div.dataset.id = item.id;
            div.dataset.type = item.type;
            div.addEventListener('click', () => {
                selectTile(item.id, div);
            });
            paletteContainer.insertBefore(div, selectedTileDisplay); // Insert before the display
        });
    }

    function selectTile(tileId, element) {
        selectedTileType = tileId;
        selectedTileDisplay.textContent = `Selected: ${tileId}`;
        // Update visual selection
        document.querySelectorAll('.palette-item.selected').forEach(el => el.classList.remove('selected'));
        if (element) {
            element.classList.add('selected');
        }
        console.log("Selected:", selectedTileType);
    }

    // --- Drawing Functions (Placeholders for now) ---
    function drawGrid() {
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 0.5;
        for (let x = 0; x <= GRID_WIDTH; x++) {
            ctx.beginPath();
            ctx.moveTo(x * TILE_SIZE, 0);
            ctx.lineTo(x * TILE_SIZE, canvas.height);
            ctx.stroke();
        }
        for (let y = 0; y <= GRID_HEIGHT; y++) {
            ctx.beginPath();
            ctx.moveTo(0, y * TILE_SIZE);
            ctx.lineTo(canvas.width, y * TILE_SIZE);
            ctx.stroke();
        }
    }

    function drawRotatedImage(img, x, y, angle) {
        ctx.save();
        ctx.translate(x + TILE_SIZE / 2, y + TILE_SIZE / 2);
        ctx.rotate(angle * Math.PI / 180); // Angle in degrees
        ctx.drawImage(img, -TILE_SIZE / 2, -TILE_SIZE / 2, TILE_SIZE, TILE_SIZE);
        ctx.restore();
    }

    // --- Helper to get tile data safely ---
    function getTile(x, y) {
        if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) {
            return null; // Out of bounds
        }
        // Find the tile in the flat array (could optimize with a 2D array later)
        return courseData.tiles.find(t => t.x === x && t.y === y);
    }

    function drawCourse() {
        if (!imagesLoaded) {
            console.log("Waiting for images to load...");
            // Optionally draw a loading indicator
            ctx.fillStyle = '#333';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#fff';
            ctx.font = '20px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText("Loading Assets...", canvas.width / 2, canvas.height / 2);
            return;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // --- Draw Ground Tiles First ---
        courseData.tiles.forEach(tile => {
            let img = null;
            if (tile.type === 'grass' && images.grass) img = images.grass;
            else if (tile.type === 'mud' && images.mud) img = images.mud;
            else img = images.grass; // Default to grass if unknown or road

            if (img) ctx.drawImage(img, tile.x * TILE_SIZE, tile.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        });

         // --- Draw Roads & Striped Lines ---
         courseData.tiles.forEach(tile => {
            // Skip non-road tiles
            if (tile.texture !== 'road' && tile.texture !== 'startfinishline') return;

            const tx_canvas = tile.x * TILE_SIZE;
            const ty_canvas = tile.y * TILE_SIZE;
            let roadImg = null;
            let angle = 0;
            let isCurve = false;
            // let curveImg = images.road_curve; // REMOVED

            // --- Determine Road Image and Angle ---
            if(tile.texture === 'startfinishline' && images.startfinishline) {
                roadImg = images.startfinishline;
                 if (tile.variant === 'h') angle = 0;
                 else if (tile.variant === 'v') angle = 90;
            }
            else if (tile.texture === 'road' && images.road) {
                roadImg = images.road;
                isCurve = tile.variant.length === 2; // ne, nw, se, sw

                if (tile.variant === 'h') angle = 0;
                else if (tile.variant === 'v') angle = 90;
                else if (tile.variant === 'ne') angle = 0;
                else if (tile.variant === 'nw') angle = 90;
                else if (tile.variant === 'se') angle = 270;
                else if (tile.variant === 'sw') angle = 180;
            }

            // --- Draw the Road Tile ---
            if (roadImg) {
                // if (isCurve && curveImg) { // OLD check for curveImg
                //     drawRotatedImage(curveImg, tx_canvas, ty_canvas, angle);
                // } else {
                // Always draw the roadImg (straight or rotated) for now
                    drawRotatedImage(roadImg, tx_canvas, ty_canvas, angle);
                // }
            }

            // --- Draw Striped Lines Based on Neighbors ---
            if (images.stripedline && tile.texture === 'road') {
                const stripeImg = images.stripedline;
                const x = tile.x;
                const y = tile.y;
                const neighbors = {
                    n: getTile(x, y - 1),
                    s: getTile(x, y + 1),
                    e: getTile(x + 1, y),
                    w: getTile(x - 1, y)
                };

                const isRoad = (t) => t && t.texture === 'road';

                // Check where stripes are needed (where there ISN'T adjacent road)
                if (!isRoad(neighbors.n)) { // Stripe on North side
                    drawRotatedImage(stripeImg, tx_canvas, ty_canvas - TILE_SIZE, 0); // Horizontal stripe above
                }
                 if (!isRoad(neighbors.s)) { // Stripe on South side
                    drawRotatedImage(stripeImg, tx_canvas, ty_canvas + TILE_SIZE, 0); // Horizontal stripe below
                }
                 if (!isRoad(neighbors.w)) { // Stripe on West side
                     drawRotatedImage(stripeImg, tx_canvas - TILE_SIZE, ty_canvas, 90); // Vertical stripe left
                 }
                 if (!isRoad(neighbors.e)) { // Stripe on East side
                     drawRotatedImage(stripeImg, tx_canvas + TILE_SIZE, ty_canvas, 90); // Vertical stripe right
                 }
                 // This logic is simplified and will draw overlapping/incorrect stripes at corners
                 // Proper corner handling would require checking diagonal neighbors or connection points.
                 // For now, let's remove stripes specifically IN the adjacent tile for curves to avoid bad overlaps.
                 if (isCurve) {
                     // Example: For 'ne' curve, don't draw stripes on the S or W sides directly adjacent
                     // This is still imperfect but reduces visual clutter.
                     // A more robust solution might involve custom corner stripe assets or complex masking.
                 }
            }
         });

        // --- Draw Elements Last ---
        courseData.elements.forEach(element => {
             if (images[element.type]) {
                 const img = images[element.type];
                 const drawXBase = element.x * TILE_SIZE;
                 const drawYBase = element.y * TILE_SIZE;

                 if(element.type === 'startgate') {
                     // Keep start gate potentially larger for now, or use its own size
                     const drawX = drawXBase + (TILE_SIZE - img.width) / 2;
                     const drawY = drawYBase + (TILE_SIZE - img.height) / 2;
                     let gateAngle = 0;
                     if(courseData.startPosition.direction === 1) gateAngle = 90;
                     else if (courseData.startPosition.direction === 2) gateAngle = 180;
                     else if (courseData.startPosition.direction === 3) gateAngle = 270;
                     // Use drawRotatedImage but don't scale it down yet
                     drawRotatedImage(img, drawXBase, drawYBase, gateAngle);
                 } else {
                     // Draw other elements smaller (e.g., half tile size)
                     const elementDrawSize = TILE_SIZE / 2;
                     const drawX = drawXBase + (TILE_SIZE - elementDrawSize) / 2; // Center the smaller size
                     const drawY = drawYBase + (TILE_SIZE - elementDrawSize) / 2;
                     ctx.drawImage(img, drawX, drawY, elementDrawSize, elementDrawSize); // Draw scaled down
                 }
             } else { // Placeholder
                 ctx.fillStyle = '#ff00ff'; ctx.beginPath(); ctx.arc((element.x + 0.5) * TILE_SIZE, (element.y + 0.5) * TILE_SIZE, TILE_SIZE * 0.4, 0, Math.PI * 2); ctx.fill();
             }
        });

        // Draw Start Position Indicator
        ctx.fillStyle = 'rgba(0, 255, 0, 0.5)'; // Semi-transparent green
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        const startAreaWidthTiles = 4; // Wide enough for 8 players approx
        const startAreaHeightTiles = 2;
        const startX = courseData.startPosition.x * TILE_SIZE;
        const startY = courseData.startPosition.y * TILE_SIZE;
        // Draw slightly larger rectangle for visibility
        ctx.strokeRect(startX - TILE_SIZE * (startAreaWidthTiles/2 - 0.5) , startY, TILE_SIZE * startAreaWidthTiles, TILE_SIZE * startAreaHeightTiles);
        ctx.fillRect(startX - TILE_SIZE * (startAreaWidthTiles/2 - 0.5) , startY, TILE_SIZE * startAreaWidthTiles, TILE_SIZE * startAreaHeightTiles);

        // Draw direction arrow
        ctx.fillStyle = '#00ff00';
        ctx.beginPath();
        const arrowCenterX = startX + TILE_SIZE / 2;
        const arrowCenterY = startY + TILE_SIZE * startAreaHeightTiles / 2; // Center of start area
        const arrowLength = TILE_SIZE * 0.8;
        // Assume direction 0 (North)
        ctx.moveTo(arrowCenterX, arrowCenterY - arrowLength / 2); // Arrow tip
        ctx.lineTo(arrowCenterX - TILE_SIZE * 0.2, arrowCenterY + arrowLength / 2); // Bottom left
        ctx.lineTo(arrowCenterX + TILE_SIZE * 0.2, arrowCenterY + arrowLength / 2); // Bottom right
        ctx.closePath();
        ctx.fill();

        drawGrid(); // Draw grid on top
    }

    // --- Event Listeners ---
    canvas.addEventListener('mousedown', (event) => {
        if (!selectedTileType) return;

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const mouseX = (event.clientX - rect.left) * scaleX;
        const mouseY = (event.clientY - rect.top) * scaleY;
        const gridX = Math.floor(mouseX / TILE_SIZE);
        const gridY = Math.floor(mouseY / TILE_SIZE);

        if (gridX >= 0 && gridX < GRID_WIDTH && gridY >= 0 && gridY < GRID_HEIGHT) {
            handlePlacement(gridX, gridY);
            drawCourse(); // Redraw after placement
        }
    });

     saveButton.addEventListener('click', () => {
        if (!socket || !socket.connected) {
            console.error("Cannot save: Not connected to server.");
            alert("Error: Not connected to the server. Cannot save.");
            return;
        }

        const courseName = courseNameInput.value.trim();
        if (!courseName) {
            alert("Please enter a name for the course.");
            return;
        }
        if (!/^[a-zA-Z0-9_\-]+$/.test(courseName)) {
            alert("Invalid course name. Use only letters, numbers, underscores, and hyphens.");
            return;
        }

        // Update the course data object with the current name
        courseData.name = courseName;

        // Optionally: Add validation (e.g., must have a start position)
        if (!courseData.startPosition) {
            alert("Please place a starting position before saving.");
            return;
        }

        console.log(`Saving course: ${courseName}`, courseData);
        socket.emit('editorSaveLevel', { name: courseName, data: courseData });

        // Optional: Provide feedback to user
        alert(`Course '${courseName}' save request sent!`);
        // Maybe disable save button temporarily?
    });

    // --- Placement Logic ---
    function handlePlacement(gridX, gridY) {
        const selectedItem = paletteItems.find(item => item.id === selectedTileType);
        if (!selectedItem) return;

        // Find existing tile/element
        const tileIndex = courseData.tiles.findIndex(t => t.x === gridX && t.y === gridY);
        const elementIndex = courseData.elements.findIndex(el => el.x === gridX && el.y === gridY);

        if (selectedItem.id === 'delete') {
            // Delete Tile (set back to grass)
            if (tileIndex !== -1) {
                courseData.tiles[tileIndex].type = 'grass';
                delete courseData.tiles[tileIndex].texture;
                delete courseData.tiles[tileIndex].variant;
            }
            // Delete Element
            if (elementIndex !== -1) {
                courseData.elements.splice(elementIndex, 1);
            }
            console.log(`Deleted content at (${gridX}, ${gridY})`);

        } else if (selectedItem.type === 'tile') {
            if (tileIndex !== -1) {
                // Place road/finish line OVER grass/mud
                courseData.tiles[tileIndex].type = selectedItem.id;
                courseData.tiles[tileIndex].texture = selectedItem.texture; // e.g., 'road'
                courseData.tiles[tileIndex].variant = selectedItem.variant; // e.g., 'h', 'ne'
                console.log(`Placed tile ${selectedItem.id} at (${gridX}, ${gridY})`);
                // Delete any element that might be underneath
                if (elementIndex !== -1) courseData.elements.splice(elementIndex, 1);
            }
        } else if (selectedItem.type === 'element') {
             // Allow placing elements only on non-road tiles?
            // Or just draw them on top? Currently draws on top.
            if (elementIndex !== -1) courseData.elements.splice(elementIndex, 1); // Remove existing element first
            courseData.elements.push({ x: gridX, y: gridY, type: selectedItem.id });
             console.log(`Placed element ${selectedItem.id} at (${gridX}, ${gridY})`);
        } else if (selectedItem.type === 'special' && selectedItem.id === 'start_pos') {
             courseData.startPosition.x = gridX;
             courseData.startPosition.y = gridY;
             // TODO: Add way to set startPosition.direction
             console.log(`Set start position to (${gridX}, ${gridY})`);
        }
    }

    // --- Initial Setup ---
    async function initializeEditor() {
        setupPalette();
        await preloadImages(); // Wait for images
        drawCourse(); // Initial draw after images are loaded
    }

    initializeEditor();

}); 