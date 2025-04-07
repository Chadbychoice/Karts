// server.js (Restored)
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);

// <<< ADDED: Set Keep-Alive Timeouts >>>
const KEEP_ALIVE_TIMEOUT_MS = 120000; // 120 seconds based on Render suggestion
server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
server.headersTimeout = KEEP_ALIVE_TIMEOUT_MS + 5000; // Standard practice: slightly longer than keepAlive

const COURSES_DIR = join(__dirname, 'courses');

// Define mapping and constants (could be moved to a config file later)
const EDITOR_TILE_SIZE = 5; // Size of one editor grid tile in world units
const EDITOR_GRID_WIDTH = 40; // Match editor.js (needed for centering?)
const EDITOR_GRID_HEIGHT = 40; // Example value, ensure consistency

const editorToClientTypeMap = {
    // Tiles -> Terrain/Road
    grass: { clientType: 'grass', category: 'terrain' },
    mud: { clientType: 'mud', category: 'obstacles' }, // Mud is an obstacle
    road_v: { clientType: 'road', category: 'road' },
    road_h: { clientType: 'road', category: 'road' },
    road_ne: { clientType: 'road', category: 'road' }, 
    road_nw: { clientType: 'road', category: 'road' },
    road_se: { clientType: 'road', category: 'road' },
    road_sw: { clientType: 'road', category: 'road' },
    startfinish: { clientType: 'startfinishline', category: 'decorations' }, // Start/Finish is a decoration
    // Elements -> Obstacles/Decorations
    startgate: { clientType: 'startgate', category: 'decorations' },
    blueblock: { clientType: 'blueblock', category: 'obstacles' },
    greenblock: { clientType: 'greenblock', category: 'obstacles' },
    darkgreenblock: { clientType: 'darkgreenblock', category: 'obstacles' },
    redblock: { clientType: 'redblock', category: 'obstacles' },
    yellowblock: { clientType: 'yellowblock', category: 'obstacles' },
    tiresred: { clientType: 'tiresred', category: 'obstacles' },
    tireswhite: { clientType: 'tireswhite', category: 'obstacles' }
    // Add mappings for any other editor types
};

// --- Translation Function ---
function translateEditorDataToCourseData(editorData) {
    if (!editorData || !Array.isArray(editorData.tiles)) {
        console.error("Invalid editor data structure passed to translation.", editorData);
        return null; // Or return a default structure
    }

    const courseData = {
        id: editorData.name, // Use the name as the ID
        name: editorData.name,
        startPositions: [], // Will be derived from startPosition
        startRotation: { y: 0 }, // Default, can be derived from startPosition direction
        terrain: [],
        road: [],
        obstacles: [],
        decorations: [],
        checkpoints: [] // Checkpoints not handled by editor yet
    };

    // --- Translate Start Position --- 
    if (editorData.startPosition) {
        // TODO: Define multiple start positions based on the editor's single point and direction?
        // For now, just use the single point.
        const startX = (editorData.startPosition.x - EDITOR_GRID_WIDTH / 2) * EDITOR_TILE_SIZE;
        const startZ = (editorData.startPosition.y - EDITOR_GRID_HEIGHT / 2) * EDITOR_TILE_SIZE;
        courseData.startPositions.push({ x: startX, y: 0, z: startZ });
        // Convert direction (0=N, 1=E, 2=S, 3=W) to rotation around Y
        // Assuming N=0, E= -PI/2, S = PI, W = PI/2 (adjust if camera is different)
        if (editorData.startPosition.direction === 1) courseData.startRotation.y = -Math.PI / 2;
        else if (editorData.startPosition.direction === 2) courseData.startRotation.y = Math.PI;
        else if (editorData.startPosition.direction === 3) courseData.startRotation.y = Math.PI / 2;
        else courseData.startRotation.y = 0; // Default North
    } else {
        // Default start position if missing
        courseData.startPositions.push({ x: 0, y: 0, z: 0 });
    }

    // --- Translate Tiles --- 
    editorData.tiles.forEach(tile => {
        const mapping = editorToClientTypeMap[tile.type];
        if (!mapping) {
            console.warn(`No mapping found for editor tile type: ${tile.type}`);
            // Default to grass terrain if unknown
            if (!editorToClientTypeMap.grass) return; // Prevent error if grass is also missing
             courseData.terrain.push({
                type: editorToClientTypeMap.grass.clientType,
                x: (tile.x - EDITOR_GRID_WIDTH / 2) * EDITOR_TILE_SIZE,
                y: 0, // Assuming flat ground for tiles
                z: (tile.y - EDITOR_GRID_HEIGHT / 2) * EDITOR_TILE_SIZE,
                width: EDITOR_TILE_SIZE,
                length: EDITOR_TILE_SIZE
            });
            return;
        }

        const item = {
            type: mapping.clientType,
            // Convert grid coords (origin top-left) to world coords (origin center)
            x: (tile.x - EDITOR_GRID_WIDTH / 2) * EDITOR_TILE_SIZE,
            y: 0, // Assuming flat ground for tiles
            z: (tile.y - EDITOR_GRID_HEIGHT / 2) * EDITOR_TILE_SIZE,
            width: EDITOR_TILE_SIZE,
            length: EDITOR_TILE_SIZE
            // Rotation might be needed for road variants?
        };
        
        // Assign to the correct category
        if (mapping.category === 'terrain') courseData.terrain.push(item);
        else if (mapping.category === 'road') courseData.road.push(item);
        else if (mapping.category === 'obstacles') courseData.obstacles.push(item);
        else if (mapping.category === 'decorations') courseData.decorations.push(item);
        else console.warn(`Unknown category '${mapping.category}' for type ${tile.type}`);
    });

    // --- Translate Elements --- 
     if (Array.isArray(editorData.elements)) { // Check if elements array exists
        editorData.elements.forEach(element => {
            const mapping = editorToClientTypeMap[element.type];
            if (!mapping) {
                console.warn(`No mapping found for editor element type: ${element.type}`);
                return;
            }

            const item = {
                type: mapping.clientType,
                x: (element.x - EDITOR_GRID_WIDTH / 2) * EDITOR_TILE_SIZE,
                y: 0, // Elements are placed on the ground
                z: (element.y - EDITOR_GRID_HEIGHT / 2) * EDITOR_TILE_SIZE,
                width: EDITOR_TILE_SIZE, // Default size, maybe adjust per type?
                length: EDITOR_TILE_SIZE,
                rotation: element.rotation || { y: 0 } // Use saved rotation or default
            };

            if (mapping.category === 'obstacles') courseData.obstacles.push(item);
            else if (mapping.category === 'decorations') courseData.decorations.push(item);
            else console.warn(`Element type ${element.type} mapped to invalid category ${mapping.category}`);
        });
     } else {
          console.log(`Course ${editorData.name} has no elements array.`);
     }

    console.log(`Translated course ${courseData.name}: T:${courseData.terrain.length}, R:${courseData.road.length}, O:${courseData.obstacles.length}, D:${courseData.decorations.length}`);
    return courseData;
}

// --- End Translation Function ---

// Course data (Load existing courses on startup)
let courses = {};

async function loadCourses() {
    try {
        await fs.mkdir(COURSES_DIR, { recursive: true });
        const files = await fs.readdir(COURSES_DIR);
        for (const file of files) {
            if (file.endsWith('.json')) {
                const filePath = join(COURSES_DIR, file);
                const courseId = basename(file, '.json');
                try {
                    const rawData = await fs.readFile(filePath, 'utf-8');
                    const editorData = JSON.parse(rawData);
                    const translatedData = translateEditorDataToCourseData(editorData);
                    if (translatedData) {
                        // Store original tiles with translated data
                        translatedData.rawEditorTiles = editorData.tiles;
                        courses[courseId] = translatedData; 
                        console.log(`Loaded and translated course: ${courseId}`);
                    } else {
                         console.error(`Failed to translate course data for ${file}`);
                    }
                } catch (parseError) {
                    console.error(`Error parsing or translating course file ${file}:`, parseError);
                }
            }
        }
    } catch (error) {
        console.error("Error loading courses:", error);
        if (Object.keys(courses).length === 0) {
            console.warn("No courses loaded, ensure courses directory exists and is readable.");
            courses['test'] = {
                id: 'test',
                name: "Default Test Track",
                planeSize: { width: 100, height: 100 },
                startPositions: [{ x: 0, y: 0, z: 0 }],
                startRotation: { y: 0 },
                terrain: [{ type: 'grass', x: 0, y: 0, z: 0, width: 100, length: 100 }],
                obstacles: [], decorations: [], checkpoints: []
            };
            console.log("Created default 'test' course.");
        }
    }
    if (!courses['test']) {
        courses['test'] = {
            id: 'test',
            name: "Default Test Track",
            planeSize: { width: 100, height: 100 },
            startPositions: [{ x: 0, y: 0, z: 0 }],
            startRotation: { y: 0 },
            terrain: [{ type: 'grass', x: 0, y: 0, z: 0, width: 100, length: 100 }],
            obstacles: [], decorations: [], checkpoints: []
        };
        console.log("Created default 'test' course.");
    }
    // Ensure 'test' course exists if nothing else loaded (create a default translated structure)
    if (Object.keys(courses).length === 0 || !courses['test']) {
        console.warn("No valid courses loaded or 'test' missing, creating default.");
         const defaultEditorData = {
            name: 'test',
            startPosition: { x: EDITOR_GRID_WIDTH / 2, y: EDITOR_GRID_HEIGHT - 2, direction: 0 },
            tiles: Array.from({ length: EDITOR_GRID_WIDTH * EDITOR_GRID_HEIGHT }, (_, i) => ({
                x: i % EDITOR_GRID_WIDTH,
                y: Math.floor(i / EDITOR_GRID_WIDTH),
                type: 'grass'
            })),
            elements: []
        };
        const defaultTranslated = translateEditorDataToCourseData(defaultEditorData);
         if (defaultTranslated) {
             // Store original default tiles
             defaultTranslated.rawEditorTiles = defaultEditorData.tiles;
             courses['test'] = defaultTranslated;
             console.log("Created default 'test' course from translated structure.");
         } else {
              console.error("CRITICAL: Failed to create default translated 'test' course!");
               // If even default fails, create a super minimal fallback
               courses['test'] = {
                  id: 'test', name: 'Minimal Fallback', startPositions: [{x:0,y:0,z:0}], startRotation: {y:0},
                  terrain: [{type:'grass', x:0, y:0, z:0, width: 20, length: 20}], road:[], obstacles:[], decorations:[], checkpoints:[]
               };
         }
    }
}

// Configure Socket.IO
const io = new Server(server, {
    cors: {
        origin: process.env.NODE_ENV === 'production' 
            ? [
                "https://*.vercel.app",
                "https://*.onrender.com"
              ] 
            : "*",
        methods: ["GET", "POST", "OPTIONS"],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    path: '/socket.io/',
    pingTimeout: 10000,
    pingInterval: 5000
});

// Basic middleware
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Editor route
app.get('/editor', (req, res) => {
    res.sendFile(join(__dirname, 'public', 'editor.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV
    });
});

// Course data endpoint
app.get('/api/courses/:id', (req, res) => {
    const courseId = req.params.id;
    const course = courses[courseId];
    if (course) {
        res.json(course);
    } else {
        res.status(404).json({ error: 'Course not found' });
    }
});

// Game state
const gameState = {
    state: 'character-selection',
    players: {},
    readyPlayers: new Set(),
    currentCourse: 'rushing'
};

// Add collision detection
function checkCollisions(gameState) {
    const players = Object.values(gameState.players);
    const collisions = [];
    
    for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
            const playerA = players[i];
            const playerB = players[j];
            
            // --- ADDED: Stricter Validation --- 
            if (!playerA || !playerB) {
                 console.warn('Skipping collision check - player object missing');
                 continue;
            }
            if (!playerA.position || typeof playerA.position.x !== 'number' || typeof playerA.position.z !== 'number' || isNaN(playerA.position.x) || isNaN(playerA.position.z)) {
                console.warn(`Skipping collision check - Invalid position for player A (${playerA.id}):`, playerA.position);
                continue;
            }
             if (!playerB.position || typeof playerB.position.x !== 'number' || typeof playerB.position.z !== 'number' || isNaN(playerB.position.x) || isNaN(playerB.position.z)) {
                console.warn(`Skipping collision check - Invalid position for player B (${playerB.id}):`, playerB.position);
                continue;
            }
            // --- END ADDED Validation ---
            
            // Calculate distance between players
            const dx = playerA.position.x - playerB.position.x;
            const dz = playerA.position.z - playerB.position.z;
            // Add check before sqrt
            const distanceSquared = dx * dx + dz * dz;
            if (isNaN(distanceSquared) || distanceSquared < 0) {
                 console.warn(`Skipping collision - Invalid distanceSquared (${distanceSquared}) between ${playerA.id} and ${playerB.id}`);
                 continue;
            }
            const distance = Math.sqrt(distanceSquared);
            
            // Log distance for debugging (only if valid)
            // console.log(`Distance between players ${playerA.id} and ${playerB.id}: ${distance}`); // Reduce verbose logging
            
            // Collision radius (sum of both kart radii)
            const collisionThreshold = 2.5; // Adjusted for better detection
            
            if (distance < collisionThreshold && distance > 0) { // Add distance > 0 check
                console.log(`Collision detected! Distance: ${distance}`);
                
                // Calculate collision point (midpoint between players)
                const collisionPoint = {
                    x: (playerA.position.x + playerB.position.x) / 2,
                    y: 1.0, // Fixed height for sparks
                    z: (playerA.position.z + playerB.position.z) / 2
                };
                
                // Calculate collision response
                const overlap = collisionThreshold - distance;
                
                // Normalize collision vector
                const nx = dx / distance;
                const nz = dz / distance;
                
                // Strong immediate separation to prevent passing through
                const separationForce = overlap * 3.0;
                
                // Ensure separation doesn't introduce NaN
                if (!isNaN(nx) && !isNaN(nz) && !isNaN(separationForce)) {
                    playerA.position.x += nx * separationForce;
                    playerA.position.z += nz * separationForce;
                    playerB.position.x -= nx * separationForce;
                    playerB.position.z -= nz * separationForce;
    } else {
                    console.warn("Skipping position separation due to NaN values.");
                }
                
                // Ensure velocity exchange doesn't introduce NaN
                const restitution = 0.8;
                const tempVel = playerA.velocity || 0;
                const playerBVel = playerB.velocity || 0;
                if (!isNaN(tempVel) && !isNaN(playerBVel)) {
                    playerA.velocity = playerBVel * restitution;
                    playerB.velocity = tempVel * restitution;
                } else {
                     console.warn("Skipping velocity exchange due to NaN values.");
                }
                
                // Add some sideways velocity for more dynamic collisions
                const sideForce = Math.abs((playerA.velocity || 0) - (playerB.velocity || 0)) * 0.5;
                playerA.sideVelocity = (Math.random() - 0.5) * sideForce;
                playerB.sideVelocity = (Math.random() - 0.5) * sideForce;
                
                // Create collision event data
                const collisionData = {
                    playerA_id: playerA.id,
                    playerB_id: playerB.id,
                    collisionPoint: collisionPoint,
                    intensity: Math.min(Math.max(Math.abs((playerA.velocity || 0) - (playerB.velocity || 0)) / 2, 0.3), 1.0),
                    sparkRange: Math.min(Math.max(Math.abs((playerA.velocity || 0) - (playerB.velocity || 0)) * 0.8, 0), 2.0)
                };
                
                // Log collision details
                console.log('Collision details:', collisionData);
                
                // Emit collision event
                io.emit('collisionDetected', collisionData);
                
                collisions.push(collisionData);
            }
        }
    }
    
    return collisions.length > 0 ? collisions : null;
}

// *** NEW FUNCTION: Obstacle Collision Check & Resolution ***
function checkAndResolveObstacleCollision(player, courseObstacles) {
    if (!player || !player.position || !courseObstacles || courseObstacles.length === 0) {
        return false; // No player, position, or obstacles
    }
    // Ensure velocity exists and is a number, default to 0 if not
    if (player.velocity === undefined || player.velocity === null || isNaN(player.velocity)) {
        player.velocity = 0;
    }


    const PLAYER_HALF_WIDTH = 1.0; // Approximate player half-width for AABB
    const OBSTACLE_HALF_WIDTH = EDITOR_TILE_SIZE / 2.0; // Obstacle half-width

    const playerMinX = player.position.x - PLAYER_HALF_WIDTH;
    const playerMaxX = player.position.x + PLAYER_HALF_WIDTH;
    const playerMinZ = player.position.z - PLAYER_HALF_WIDTH;
    const playerMaxZ = player.position.z + PLAYER_HALF_WIDTH;

    let collisionOccurred = false;

    for (const obstacle of courseObstacles) {
        // Ensure obstacle has valid position and dimensions (using defaults if missing, though they should exist)
        const obsX = obstacle.x ?? 0;
        const obsZ = obstacle.z ?? 0;
        const obsHalfWidth = (obstacle.width ?? EDITOR_TILE_SIZE) / 2.0; // Use specific width if available, else default
        const obsHalfLength = (obstacle.length ?? EDITOR_TILE_SIZE) / 2.0; // Use specific length if available, else default

        // For simplicity, use the largest dimension for radius if needed, or stick to AABB
        // Sticking to AABB based on EDITOR_TILE_SIZE for now as obstacles seem standardized
        const obsMinX = obsX - OBSTACLE_HALF_WIDTH;
        const obsMaxX = obsX + OBSTACLE_HALF_WIDTH;
        const obsMinZ = obsZ - OBSTACLE_HALF_WIDTH;
        const obsMaxZ = obsZ + OBSTACLE_HALF_WIDTH;


        // AABB Collision Check
        const collisionX = playerMaxX > obsMinX && playerMinX < obsMaxX;
        const collisionZ = playerMaxZ > obsMinZ && playerMinZ < obsMaxZ;

        if (collisionX && collisionZ) {
            collisionOccurred = true;
            console.log(`Obstacle collision detected for ${player.id} with obstacle at (${obsX}, ${obsZ}) type: ${obstacle.type}`);

            // Calculate overlap (Minimum Translation Vector - MTV)
            const overlapX1 = playerMaxX - obsMinX; // Positive value
            const overlapX2 = obsMaxX - playerMinX; // Positive value
            const overlapZ1 = playerMaxZ - obsMinZ; // Positive value
            const overlapZ2 = obsMaxZ - playerMinZ; // Positive value

            // Find the smallest positive overlap
            const overlapX = Math.min(overlapX1, overlapX2);
            const overlapZ = Math.min(overlapZ1, overlapZ2);

            // Determine push direction and apply correction
            if (overlapX < overlapZ) {
                // Push horizontally
                const pushDirectionX = player.position.x < obsX ? -1 : 1; // Push away from obstacle center X
                player.position.x += pushDirectionX * overlapX;
                console.log(`  Pushing player ${player.id} X by ${pushDirectionX * overlapX}`);
                // Reduce velocity mainly in the perpendicular direction (Z) ? Or just overall?
                // Let's simplify: dampen overall velocity, maybe more if hitting head-on
                // player.velocity *= 0.1; // Reduce speed significantly (moved below)

            } else {
                // Push vertically (on Z axis)
                 const pushDirectionZ = player.position.z < obsZ ? -1 : 1; // Push away from obstacle center Z
                player.position.z += pushDirectionZ * overlapZ;
                 console.log(`  Pushing player ${player.id} Z by ${pushDirectionZ * overlapZ}`);
                 // Reduce velocity mainly in the perpendicular direction (X) ?
                 // player.velocity *= 0.1; // Reduce speed significantly (moved below)
            }

             // Apply bounce effect (reduce speed) - Apply regardless of push axis
             const oldVelocity = player.velocity;
             player.velocity *= 0.1; // Significantly reduce speed on impact
             // Prevent reversing if speed was positive
             if (oldVelocity > 0 && player.velocity < 0) {
                 player.velocity = 0;
             }
             // Ensure velocity doesn't become NaN
             if (isNaN(player.velocity)) {
                 console.warn(`Player ${player.id} velocity became NaN after obstacle collision! Resetting to 0.`);
                 player.velocity = 0;
             }

             console.log(`  Player ${player.id} velocity changed from ${oldVelocity} to ${player.velocity}`);


            // Optionally emit an event to the specific player
            // io.to(player.id).emit('obstacleCollision', { obstacleType: obstacle.type, position: {x: obstacle.x, z: obstacle.z} });

            // Assume collision with one obstacle is enough resolution for this frame
            break;
        }
    }
    // Return true if a collision was detected and resolved
    return collisionOccurred;
}

// Socket.IO event handlers
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    if (!courses[gameState.currentCourse]) {
        console.warn(`Current course '${gameState.currentCourse}' not found, switching to 'test'.`);
        gameState.currentCourse = 'test';
    }

    const currentValidCourse = courses[gameState.currentCourse];
    const startPos = currentValidCourse.startPositions[
        Object.keys(gameState.players).length % currentValidCourse.startPositions.length
    ];
    
    // Initialize player in character selection state
    gameState.players[socket.id] = {
        id: socket.id,
        connected: true,
        timestamp: Date.now(),
        characterId: null,
        position: { ...startPos },
        rotation: { ...currentValidCourse.startRotation },
        velocity: 0,
        lap: 1,
        nextCheckpoint: 0,
        finishedRace: false,
        isSpectator: false
    };

    // Send initial state to new player
    socket.emit('updateGameState', gameState.state, gameState.players, {
        courseId: gameState.currentCourse,
        courseData: currentValidCourse,
        editorTiles: courses[gameState.currentCourse]?.rawEditorTiles
    });

    // Handle character selection
    socket.on('playerSelectCharacter', (characterId) => {
        console.log(`Player ${socket.id} selected character ${characterId}`);
        if (gameState.players[socket.id]) {
            gameState.players[socket.id].characterId = characterId;
            gameState.readyPlayers.add(socket.id);
            
            // Put player directly into racing state (using the correct start pos for THIS player)
             const startPos = currentValidCourse.startPositions[
                 (Object.keys(gameState.players).length -1) % currentValidCourse.startPositions.length
             ]; // Get pos based on current player index
            gameState.players[socket.id].position = { ...startPos };
            gameState.players[socket.id].rotation = { ...currentValidCourse.startRotation };
            gameState.players[socket.id].isSpectator = false;

            // Update game state to racing if it wasn't already
            let stateChanged = false;
            if (gameState.state !== 'racing') {
                gameState.state = 'racing';
                stateChanged = true;
                console.log('Game state changed to racing!');
            }

            // Ensure the course exists before using it
             const courseToSend = courses[gameState.currentCourse];
             if (!courseToSend) {
                  console.error(`Error: Course '${gameState.currentCourse}' not found when trying to emit racing state.`);
                  // Optionally switch back to test or handle error
                  return; // Prevent emitting bad state
             }

            // Always emit the update 
            console.log(`Emitting updateGameState: ${gameState.state} with course data for ${gameState.currentCourse}`);
            io.emit('updateGameState', gameState.state, gameState.players, {
                courseId: gameState.currentCourse,
                courseData: courseToSend,
                editorTiles: courses[gameState.currentCourse]?.rawEditorTiles
            });
            
            // Log if state changed for clarity
            if (stateChanged) {
                console.log('Racing state initiated and broadcasted with course data.');
            }
        }
    });

    // Handle player state updates
    socket.on('playerUpdateState', (data) => {
        const player = gameState.players[socket.id];
        if (player) {
            let positionUpdated = false;
            // let originalPosition = player.position ? { ...player.position } : null; // Store position before update (can be useful for debug)

            // Validate and apply updates from client
            // ... (validation and application logic remains the same) ...
             if (data.position && (isNaN(data.position.x) || isNaN(data.position.z))) {
                 console.error(`!!! Received NaN position from ${socket.id}:`, data.position);
                 // Don't update position if NaN
            } else {
                 if (data.position) {
                     // Add extra check here: only update if different from current state? Might prevent redundant checks.
                     // Check if position actually changed significantly to warrant collision checks
                     // const posChanged = !player.position || Math.abs(player.position.x - data.position.x) > 0.01 || Math.abs(player.position.z - data.position.z) > 0.01;
                     // if (posChanged) {
                           player.position = data.position;
                           positionUpdated = true;
                     // }
                 }
                 if (data.rotation) player.rotation = data.rotation;
                 // Update velocity ONLY if client sends a valid number
                 if (data.velocity !== undefined && !isNaN(data.velocity)) {
                    // Add sanity check for velocity? Max speed?
                    player.velocity = data.velocity;
                 } else if (data.velocity !== undefined) {
                     console.warn(`Received invalid velocity from ${socket.id}: ${data.velocity}. Keeping old value: ${player.velocity}`);
                 }
            }


            // --- Collision Resolution ---
            // Only perform collision checks if the player's position is valid *after* the update attempt
            if (player.position && !isNaN(player.position.x) && !isNaN(player.position.z)) {

                // 1. Check Player-Player Collisions
                // WARNING: This function modifies state directly for involved players and runs for *all* players.
                 checkCollisions(gameState); // Existing function call

                 // --- Retrieve potentially modified player state ---
                 // Re-fetch the player object as checkCollisions might have altered it.
                 const playerAfterP2PCollision = gameState.players[socket.id];
                 if (!playerAfterP2PCollision) {
                     console.error(`Player ${socket.id} missing after P2P collision check.`);
                      // If player missing, can't proceed with this update cycle for them
                      return;
                 }
                 // Make sure the player state is still valid after P2P check
                 if (!playerAfterP2PCollision.position || isNaN(playerAfterP2PCollision.position.x) || isNaN(playerAfterP2PCollision.position.z)) {
                      console.error(`Player ${socket.id} position became invalid after P2P collision check.`);
                      return; // Abort if state is corrupted
                 }


                // 2. Check Player-Obstacle Collisions using the state potentially modified by P2P collision check
                const currentCourse = courses[gameState.currentCourse];
                let obstacleCollisionOccurred = false;
                if (currentCourse && currentCourse.obstacles && currentCourse.obstacles.length > 0) {
                     // Pass the potentially updated player state to the obstacle check function
                     obstacleCollisionOccurred = checkAndResolveObstacleCollision(playerAfterP2PCollision, currentCourse.obstacles);
                     // checkAndResolveObstacleCollision modifies the player state directly (position, velocity)
                }

                // --- Final Player State for Broadcast ---
                // Get the state *after* both P2P and Obstacle collision resolutions
                 const finalPlayerState = gameState.players[socket.id];
                 if (!finalPlayerState) {
                     console.error(`Player ${socket.id} missing after Obstacle collision check.`);
                      return;
                 }
                 // Final validation before broadcast
                 if (!finalPlayerState.position || isNaN(finalPlayerState.position.x) || isNaN(finalPlayerState.position.z)) {
                      console.error(`Player ${socket.id} position invalid before broadcast.`);
                      return;
                 }


                 // 3. Broadcast update to all other players using the final state
                 // Ensure we are broadcasting the absolute final position after all resolutions
                 // Also broadcast velocity if it changed due to collisions? updatePlayerPosition doesn't handle velocity.
                 // Let's just send position/rotation for now. Client interpolates/predicts velocity locally.
                 socket.broadcast.emit('updatePlayerPosition', socket.id, finalPlayerState.position, finalPlayerState.rotation);

            } else {
                 // This case handles:
                 // - Client sent invalid position data initially.
                 // - Player's position is somehow null/NaN before checks.
                 console.warn(`Skipping collision checks and broadcast for ${socket.id} due to invalid position state.`);

                 // Should we broadcast if only rotation/velocity was updated and position was valid before?
                 // The 'positionUpdated' flag isn't quite right here. Let's rethink the condition.

                 // Revised condition: Broadcast if the player state *is* valid, even if position wasn't updated in *this specific message*
                 // (e.g., only rotation came, or position came but was invalid).
                 // This ensures others see rotation changes even if position is static or was invalid in the incoming packet.
                 if (player.position && !isNaN(player.position.x) && !isNaN(player.position.z)) {
                     // If we reached here, it means the initial check failed (player.position was invalid *after* update attempt).
                     // This path should logically not be taken if the player.position is valid.
                     // Let's simplify the logic flow.

                     // Simpler flow:
                     // 1. Update state from 'data', ensuring player.position remains valid.
                     // 2. If player.position is valid:
                     //    a. Run P2P check -> update state
                     //    b. Run Obstacle check -> update state
                     //    c. Broadcast final valid state.
                     // 3. If player.position is/became invalid:
                     //    a. Log warning.
                     //    b. Do not run checks or broadcast.

                     // The code mostly follows this, but the warning message might be misleading.
                     // Let's adjust the warning context.
                      console.warn(`Player ${socket.id} state invalid after update attempt. Position: ${JSON.stringify(player.position)}. Skipping collision checks and broadcast.`);

                 }

            }
        } else {
             console.warn(`Received playerUpdateState for unknown player: ${socket.id}`);
        }
    });

    // Handle player effects state
    socket.on('playerDriftStateChange', (isDrifting, direction) => {
        if (gameState.players[socket.id]) {
            gameState.players[socket.id].isDrifting = isDrifting;
            gameState.players[socket.id].driftDirection = direction;
            socket.broadcast.emit('updatePlayerEffectsState', socket.id, {
                isDrifting,
                driftDirection: direction
            });
        }
    });

    socket.on('playerBoostStart', (data) => {
        if (gameState.players[socket.id]) {
            gameState.players[socket.id].isBoosting = true;
            gameState.players[socket.id].boostLevel = data.level;
            socket.broadcast.emit('updatePlayerEffectsState', socket.id, {
                isBoosting: true,
                boostLevel: data.level
            });

            // Set timeout to end boost
            setTimeout(() => {
                if (gameState.players[socket.id]) {
                    gameState.players[socket.id].isBoosting = false;
                    socket.broadcast.emit('updatePlayerEffectsState', socket.id, {
                        isBoosting: false
                    });
                }
            }, data.duration);
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        if (gameState.players[socket.id]) {
            // Remove player from ready set and game state
            gameState.readyPlayers.delete(socket.id);
            delete gameState.players[socket.id];

            // Notify other players
            socket.broadcast.emit('playerLeft', socket.id);

            // Only reset game state if no players left AND we're in racing state
            if (Object.keys(gameState.players).length === 0 && gameState.state === 'racing') {
                gameState.state = 'character-selection';
                gameState.readyPlayers.clear();
            }
        }
    });

    // Handle Level Saving from Editor
    socket.on('editorSaveLevel', async ({ name, data }) => {
        console.log(`Received save request for level: ${name}`);
        const safeBaseName = name.replace(/[^a-zA-Z0-9_\-]/g, '');
        if (!safeBaseName) {
            console.error("Invalid or empty course name received after sanitization.");
            socket.emit('editorSaveConfirm', { success: false, message: 'Invalid course name.' });
            return;
        }

        const filename = `${safeBaseName}.json`;
        const filePath = join(COURSES_DIR, filename);

        // --- ADDED: Translate before saving --- 
        const translatedData = translateEditorDataToCourseData(data);
        if (!translatedData) {
             console.error("Failed to translate course data before saving.");
             socket.emit('editorSaveConfirm', { success: false, message: 'Server error translating data.' });
             return;
        }
        // Set the ID within the translated data before saving
        translatedData.id = safeBaseName;
        // --- End Translation Add ---

        try {
            await fs.mkdir(COURSES_DIR, { recursive: true }); 
            // Save the ORIGINAL editor data, NOT the translated data, to keep editor compatibility
            await fs.writeFile(filePath, JSON.stringify(data, null, 2)); 
            console.log(`Successfully saved ORIGINAL editor course data to ${filePath}`);
            
            // Store original tiles alongside translated data in memory
            translatedData.rawEditorTiles = data.tiles;
            courses[safeBaseName] = translatedData; 
            
            socket.emit('editorSaveConfirm', { success: true, name: safeBaseName });
        } catch (error) {
            console.error(`Error saving course ${name} to ${filePath}:`, error);
            socket.emit('editorSaveConfirm', { success: false, message: 'Server error saving file.' });
        }
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Start server with retry logic
const PORT = process.env.PORT || 3000; // Render provides PORT env var, use 3000 as local fallback
const MAX_RETRIES = 5;
const RETRY_DELAY = 1000;
let currentPort = PORT;

async function startServer(retryCount = 0) {
    try {
        await new Promise((resolve, reject) => {
             // <<< CHANGED: Bind explicitly to 0.0.0.0 for Render >>>
            server.listen(currentPort, '0.0.0.0', () => {
                console.log(`Server running on http://0.0.0.0:${currentPort}`); // Log actual binding
                console.log('Environment:', process.env.NODE_ENV);
                resolve();
            }).on('error', (error) => {
                if (error.code === 'EADDRINUSE') {
                    console.log(`Port ${currentPort} is busy, trying next port...`);
                    // Only increment port if NOT using Render's provided PORT
                    if (currentPort === PORT && process.env.PORT) {
                        reject(new Error(`Render specified port ${PORT} is already in use.`));
                        return;
                    }
                    currentPort++; // Try next port only for local fallback
                    if (retryCount < MAX_RETRIES) {
                        setTimeout(() => {
                            startServer(retryCount + 1).catch(reject);
                        }, RETRY_DELAY);
                    } else {
                        reject(new Error(`Failed to find available port after ${MAX_RETRIES} attempts`));
                    }
                } else {
                    reject(error);
                }
            });
        });
    } catch (error) {
        console.error('Server startup error:', error);
        process.exit(1);
    }
}

// Handle process signals
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    if (process.env.NODE_ENV === 'production') {
        console.error('Server continuing despite uncaught exception in production');
    } else {
        process.exit(1);
    }
});

loadCourses().then(() => {
    startServer(); 
}); 