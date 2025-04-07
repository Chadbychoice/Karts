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
const EDITOR_TILE_SIZE = 25; // <<< CHANGED: Increased scale factor further
const EDITOR_GRID_WIDTH = 40; // Match editor.js (needed for centering?)
const EDITOR_GRID_HEIGHT = 30; // Match editor.js

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

// Define which obstacle types are solid
const solidObstacleTypes = new Set([
    'blueblock', 
    'greenblock', 
    'darkgreenblock', 
    'redblock', 
    'yellowblock', 
    'tiresred', 
    'tireswhite'
]);

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
    const currentCourse = courses[gameState.currentCourse];
    const obstacles = currentCourse?.obstacles || [];
    const collisions = [];
    
    // --- Player vs Player Collisions --- 
    for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
            const playerA = players[i];
            const playerB = players[j];

             // <<< RIGOROUS NaN Check: Player A >>>
             if (!playerA || !playerA.position || 
                 typeof playerA.position.x !== 'number' || isNaN(playerA.position.x) || 
                 typeof playerA.position.z !== 'number' || isNaN(playerA.position.z)) {
                 console.error(`!!! FATAL: Player A (${playerA?.id}) has invalid position BEFORE P2P check:`, playerA?.position);
                 // How to handle this? Skip check? Attempt reset?
                 // For now, skip this pair to prevent NaN propagation.
                 continue; 
             }
             // <<< RIGOROUS NaN Check: Player B >>>
              if (!playerB || !playerB.position || 
                  typeof playerB.position.x !== 'number' || isNaN(playerB.position.x) || 
                  typeof playerB.position.z !== 'number' || isNaN(playerB.position.z)) {
                  console.error(`!!! FATAL: Player B (${playerB?.id}) has invalid position BEFORE P2P check:`, playerB?.position);
                  continue; 
              }


            // Calculate distance between players (already has NaN check for distanceSquared)
            // ... (existing dx, dz, distanceSquared calculation) ...
             const dx = playerA.position.x - playerB.position.x;
             const dz = playerA.position.z - playerB.position.z;
             const distanceSquared = dx * dx + dz * dz;
             if (isNaN(distanceSquared) || distanceSquared < 0) {
                 console.warn(`Skipping P2P collision - Invalid distanceSquared (${distanceSquared}) between ${playerA.id} and ${playerB.id}`);
                 continue;
             }
             const distance = Math.sqrt(distanceSquared);
             // <<< ADDED: Explicit check for NaN distance itself >>>
             if (isNaN(distance)) {
                  console.error(`!!! FATAL: Calculated NaN distance between ${playerA.id} and ${playerB.id}. Positions: A=${JSON.stringify(playerA.position)}, B=${JSON.stringify(playerB.position)}`);
                  continue; // Skip this pair
             }

            // Collision radius
            const collisionThreshold = 2.5;
            
            if (distance < collisionThreshold && distance > 0) {
                console.log(`Player-Player Collision detected! Distance: ${distance.toFixed(3)}`);
                
                // ... (existing collision point calculation) ...
                 const collisionPoint = {
                     x: (playerA.position.x + playerB.position.x) / 2,
                     y: 1.0,
                     z: (playerA.position.z + playerB.position.z) / 2
                 };

                // Calculate response
                const overlap = collisionThreshold - distance;
                const nx = dx / distance;
                const nz = dz / distance;
                const separationForce = overlap * 3.0;
                
                // <<< RIGOROUS NaN check before applying separation >>>
                if (!isNaN(nx) && !isNaN(nz) && !isNaN(separationForce)) {
                     // Store positions before applying change for logging
                     // const posA_before = { ...playerA.position };
                     // const posB_before = { ...playerB.position };

                    playerA.position.x += nx * separationForce;
                    playerA.position.z += nz * separationForce;
                    playerB.position.x -= nx * separationForce;
                    playerB.position.z -= nz * separationForce;
                    
                     // <<< RIGOROUS NaN check AFTER applying separation >>>
                     if (isNaN(playerA.position.x) || isNaN(playerA.position.z)) {
                          console.error(`!!! FATAL: Player A (${playerA.id}) position became NaN AFTER P2P separation!`);
                          // Attempt to revert or reset? Reverting might be complex if one is NaN, other not.
                          // Resetting to a safe state might be better. For now, log error.
                          // playerA.position = posA_before; // Example revert - CAREFUL
                     }
                     if (isNaN(playerB.position.x) || isNaN(playerB.position.z)) {
                          console.error(`!!! FATAL: Player B (${playerB.id}) position became NaN AFTER P2P separation!`);
                          // playerB.position = posB_before;
                     }

                } else {
                    console.warn(`!!! Skipping P2P position separation due to NaN values (nx=${nx}, nz=${nz}, force=${separationForce}).`);
                }
                
                // ... (existing velocity exchange with NaN checks) ...
                 const restitution = 0.8;
                 let tempVel = playerA.velocity ?? 0;
                 let playerBVel = playerB.velocity ?? 0;
                 if (isNaN(tempVel)) { console.warn(`Player A vel NaN before swap (${playerA.id})`); tempVel = 0; }
                 if (isNaN(playerBVel)) { console.warn(`Player B vel NaN before swap (${playerB.id})`); playerBVel = 0; }
                 
                 if (!isNaN(restitution)) { // Check restitution too, though unlikely to be NaN
                     playerA.velocity = playerBVel * restitution;
                     playerB.velocity = tempVel * restitution;
                 } else {
                      console.warn("!!! Skipping P2P velocity exchange due to NaN restitution.");
                 }
                 // Final NaN check for velocity
                 if(isNaN(playerA.velocity)) { console.error(`!!! Player A vel NaN AFTER swap (${playerA.id})`); playerA.velocity = 0; }
                 if(isNaN(playerB.velocity)) { console.error(`!!! Player B vel NaN AFTER swap (${playerB.id})`); playerB.velocity = 0; }
                
                // ... (existing side velocity - needs NaN check?) ...
                 const sideForceInput = Math.abs(playerA.velocity - playerB.velocity) * 0.5;
                 if (!isNaN(sideForceInput)){
                     playerA.sideVelocity = (Math.random() - 0.5) * sideForceInput;
                     playerB.sideVelocity = (Math.random() - 0.5) * sideForceInput;
                      if(isNaN(playerA.sideVelocity)) { console.warn(`Player A sideVel NaN (${playerA.id})`); playerA.sideVelocity = 0;} 
                      if(isNaN(playerB.sideVelocity)) { console.warn(`Player B sideVel NaN (${playerB.id})`); playerB.sideVelocity = 0;} 
                 } else {
                      console.warn("!!! Skipping P2P side force due to NaN input.");
                      playerA.sideVelocity = 0;
                      playerB.sideVelocity = 0;
                 }

                
                // ... (existing collision event data creation - ensure no NaNs passed) ...
                 const intensity = Math.min(Math.max(Math.abs(playerA.velocity - playerB.velocity) / 2, 0.3), 1.0);
                 const sparkRange = Math.min(Math.max(Math.abs(playerA.velocity - playerB.velocity) * 0.8, 0), 2.0);
                 
                 // Ensure data sent to client is valid
                 if (!isNaN(collisionPoint.x) && !isNaN(collisionPoint.y) && !isNaN(collisionPoint.z) && !isNaN(intensity) && !isNaN(sparkRange)) {
                     const collisionData = {
                         playerA_id: playerA.id,
                         playerB_id: playerB.id,
                         collisionPoint: collisionPoint,
                         intensity: intensity,
                         sparkRange: sparkRange
                     };
                     console.log('P2P Collision details:', collisionData);
                     io.emit('collisionDetected', collisionData);
                     collisions.push(collisionData);
                 } else {
                      console.error("!!! Failed to emit P2P collision event due to NaN values in data.", { collisionPoint, intensity, sparkRange });
                 }
                 
            }
        }
    }
    
    // --- Player vs Obstacle Collisions --- 
    for (let i = 0; i < players.length; i++) {
        const player = players[i];
        
         // <<< RIGOROUS NaN Check: Player BEFORE Obstacle Check >>>
         if (!player || !player.position || 
             typeof player.position.x !== 'number' || isNaN(player.position.x) || 
             typeof player.position.z !== 'number' || isNaN(player.position.z)) {
             console.error(`!!! FATAL: Player (${player?.id}) has invalid position BEFORE Obstacle check:`, player?.position);
             continue; 
         }
         if (player.velocity === undefined || player.velocity === null || isNaN(player.velocity)) {
             // console.warn(`Player ${player.id} velocity is NaN/undefined before obstacle check. Setting to 0.`);
             player.velocity = 0; 
         }


        obstacles.forEach(obstacle => {
            if (!solidObstacleTypes.has(obstacle.type)) return;
            
            // --- Obstacle Validation ---
            const obsWidth = (typeof obstacle.width === 'number' && !isNaN(obstacle.width)) ? obstacle.width : EDITOR_TILE_SIZE;
            const obsLength = (typeof obstacle.length === 'number' && !isNaN(obstacle.length)) ? obstacle.length : EDITOR_TILE_SIZE;
            if (typeof obstacle.x !== 'number' || isNaN(obstacle.x) || typeof obstacle.z !== 'number' || isNaN(obstacle.z)) {
                 console.warn(`Skipping obstacle collision check with type ${obstacle.type} due to invalid obstacle position:`, obstacle);
                 return; 
            }
            
            // <<< ADDED DIAGNOSTIC LOG >>>
            // Log every obstacle being checked against this player
            console.log(`  [Check] Player ${player.id} (Pos: ${player.position.x.toFixed(2)},${player.position.z.toFixed(2)}) vs Obstacle ${obstacle.type} (Pos: ${obstacle.x.toFixed(2)},${obstacle.z.toFixed(2)})`);


            // --- AABB Check (ensure no NaN inputs) ---
            // Further reduce player hitbox size
            const PLAYER_HALF_WIDTH = 0.4; // Previous: 0.7 
            const obstacleHalfWidth = obsWidth / 2.0;
            const obstacleHalfLength = obsLength / 2.0;
            
            const playerMinX = player.position.x - PLAYER_HALF_WIDTH;
            const playerMaxX = player.position.x + PLAYER_HALF_WIDTH;
            const playerMinZ = player.position.z - PLAYER_HALF_WIDTH;
            const playerMaxZ = player.position.z + PLAYER_HALF_WIDTH;
            const obstacleMinX = obstacle.x - obstacleHalfWidth;
            const obstacleMaxX = obstacle.x + obstacleHalfWidth;
            const obstacleMinZ = obstacle.z - obstacleHalfLength;
            const obstacleMaxZ = obstacle.z + obstacleHalfLength;

            const collisionX = playerMaxX > obstacleMinX && playerMinX < obstacleMaxX;
            const collisionZ = playerMaxZ > obstacleMinZ && playerMinZ < obstacleMaxZ;

            if (collisionX && collisionZ) {
                console.log(`---> OBSTACLE COLLISION DETECTED: Player ${player.id} vs Obstacle ${obstacle.type}`);
                
                // --- Response (MTV Calculation) ---
                const overlapX1 = playerMaxX - obstacleMinX;
                const overlapX2 = obstacleMaxX - playerMinX;
                const overlapZ1 = playerMaxZ - obstacleMinZ;
                const overlapZ2 = obstacleMaxZ - playerMinZ;
                const mtvX = Math.min(overlapX1, overlapX2);
                const mtvZ = Math.min(overlapZ1, overlapZ2);
                
                // <<< RIGOROUS NaN check for MTV >>>
                if (isNaN(mtvX) || isNaN(mtvZ)){
                     console.error(`!!! FATAL: Calculated NaN MTV for obstacle collision! Player: ${player.id}, Obstacle: ${obstacle.type}. Overlaps: X1=${overlapX1}, X2=${overlapX2}, Z1=${overlapZ1}, Z2=${overlapZ2}`);
                     // Skip applying response if MTV is NaN
                     return; // Continue to next obstacle
                }

                // --- Apply Position Correction --- 
                // const posBeforeObstacle = { ...player.position }; // For logging/revert
                if (mtvX < mtvZ) {
                    const pushDirectionX = player.position.x < obstacle.x ? -1 : 1;
                     if (!isNaN(pushDirectionX)) {
                         player.position.x += pushDirectionX * mtvX;
                     } else { console.warn("NaN pushDirectionX in obstacle collision"); }
                } else {
                    const pushDirectionZ = player.position.z < obstacle.z ? -1 : 1;
                     if (!isNaN(pushDirectionZ)) {
                         player.position.z += pushDirectionZ * mtvZ;
                     } else { console.warn("NaN pushDirectionZ in obstacle collision"); }
                }
                
                // <<< RIGOROUS NaN check AFTER applying correction >>>
                 if (isNaN(player.position.x) || isNaN(player.position.z)) {
                      console.error(`!!! FATAL: Player (${player.id}) position became NaN AFTER Obstacle separation!`);
                      // Attempt revert?
                      // player.position = posBeforeObstacle; 
                 }

                // --- Apply Velocity Correction --- 
                const oldVelocity = player.velocity;
                player.velocity *= 0.1; 
                 if (isNaN(player.velocity)) {
                     console.warn(`Player ${player.id} velocity became NaN after obstacle impact! Resetting to 0. Old: ${oldVelocity}`);
                     player.velocity = 0;
                 } else {
                      console.log(`  Player ${player.id} velocity changed from ${oldVelocity.toFixed(2)} to ${player.velocity.toFixed(2)}`);
                 }


                // --- Emit Event (Ensure data validity) --- 
                 const obstaclePosY = (obstacle.y === undefined || isNaN(obstacle.y)) ? 0 : obstacle.y;
                 const effectPosY = obstaclePosY + 0.5;
                 if (!isNaN(obstacle.x) && !isNaN(effectPosY) && !isNaN(obstacle.z)) {
                     io.to(player.id).emit('obstacleCollision', { 
                         type: obstacle.type, 
                         position: { x: obstacle.x, y: effectPosY, z: obstacle.z } 
                     }); 
                 } else {
                      console.error(`!!! Failed to emit obstacleCollision event due to NaN position data. Obstacle:`, obstacle); 
                 }
            } 
        });
    }
    
    return collisions.length > 0 ? collisions : null; 
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
        const player = gameState.players[socket.id]; // Get player reference
        if (player) {
            let positionBeforeCheck = null;
            let velocityBeforeCheck = null;

            // 1. Apply updates from client (and validate)
            if (data.position && (isNaN(data.position.x) || isNaN(data.position.z))) {
                 console.error(`!!! Received NaN position from ${socket.id}:`, data.position);
                 // Don't apply NaN position
            } else if (data.position) {
                 // Store state before applying client update AND before collision check
                 positionBeforeCheck = { ...player.position }; 
                 velocityBeforeCheck = player.velocity;
                 player.position = data.position;
            }
            if (data.rotation) {
                 player.rotation = data.rotation;
            }
            if (data.velocity !== undefined && !isNaN(data.velocity)) {
                 if(velocityBeforeCheck === null) velocityBeforeCheck = player.velocity; // Store if not stored yet
                 player.velocity = data.velocity;
            } else if (data.velocity !== undefined) {
                 console.warn(`Received invalid velocity from ${socket.id}: ${data.velocity}. Keeping old value: ${player.velocity}`);
            }

            // 2. Perform Collision Checks & Resolution (modifies gameState directly)
            let collisionModifiedState = false;
            if (player.position && !isNaN(player.position.x) && !isNaN(player.position.z)) {
                 // Store state just before collision function, if not already stored
                 if(positionBeforeCheck === null) positionBeforeCheck = { ...player.position };
                 if(velocityBeforeCheck === null) velocityBeforeCheck = player.velocity;
                 
                 checkCollisions(gameState); // This function modifies player positions/velocities in gameState

                 // 3. Check if state was ACTUALLY modified by collisions
                 const finalPlayerState = gameState.players[socket.id]; // Re-get state after checkCollisions
                 if (finalPlayerState) {
                      // Compare final state with state *before* collision check
                      const posChanged = finalPlayerState.position.x !== positionBeforeCheck.x || 
                                         finalPlayerState.position.z !== positionBeforeCheck.z;
                      const velChanged = finalPlayerState.velocity !== velocityBeforeCheck;
                      
                      if (posChanged || velChanged) {
                           collisionModifiedState = true;
                           console.log(`Collision system modified state for ${socket.id}. Pos changed: ${posChanged}, Vel changed: ${velChanged}`);
                      }

                      // 4. Broadcast state to OTHERS
                      if (!isNaN(finalPlayerState.position.x) && !isNaN(finalPlayerState.position.z)) {
                          socket.broadcast.emit('updatePlayerPosition', socket.id, finalPlayerState.position, finalPlayerState.rotation);
                      } else {
                           console.error(`Player ${socket.id} state invalid after collision checks. Not broadcasting position.`);
                      }

                      // 5. <<< IMPORTANT FIX: Send correction back to the originating client if modified >>>
                      if (collisionModifiedState && !isNaN(finalPlayerState.position.x) && !isNaN(finalPlayerState.position.z)) {
                           console.log(`---> Sending position correction back to client ${socket.id}`);
                           socket.emit('updatePlayerPosition', socket.id, finalPlayerState.position, finalPlayerState.rotation); 
                           // Also consider sending corrected velocity if client uses it?
                           // socket.emit('updatePlayerVelocity', socket.id, finalPlayerState.velocity); // Requires client handler
                      }
                 } else {
                      console.error(`Player ${socket.id} disappeared after collision check!`);
                 }
            } else {
                 console.warn(`Skipping collision checks for ${socket.id} due to invalid state before checks.`);
                 // If state was invalid BEFORE checks, maybe still broadcast valid rotation if it came in?
                  if (player.rotation && data.rotation && player.position && !isNaN(player.position.x) && !isNaN(player.position.z)) {
                       // If only rotation was updated, broadcast that to others
                       socket.broadcast.emit('updatePlayerPosition', socket.id, player.position, player.rotation);
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

    // --- Handle Obstacle Collision Event on Client --- 
    socket.on('obstacleCollision', ({ type }) => {
        console.log(`Local player hit obstacle: ${type}`);
        // TODO: Play a collision sound based on type?
        // TODO: Add a small camera shake?
        shakeCamera(0.15); // Add a smaller shake for obstacles
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