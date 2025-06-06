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
    mud: { clientType: 'mud', category: 'terrain' }, 
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
    tireswhite: { clientType: 'tireswhite', category: 'obstacles' },
    coin: { clientType: 'coin', category: 'collectibles' } // Added coin type
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

// Define constants for collision checks
const PLAYER_HALF_WIDTH = 0.5; 
const PLAYER_HALF_LENGTH = 0.5; 
const OBSTACLE_HALF_SIZE = 2.5; // Previous: 1.5, makes obstacles 5.0x5.0 box
const obstacleHalfWidth = OBSTACLE_HALF_SIZE;
const obstacleHalfLength = OBSTACLE_HALF_SIZE;

// Constants for coin collection
const COIN_RESPAWN_TIME = 5000; // 5 seconds in milliseconds
const COIN_COLLECTION_RADIUS = 6.0; // Increased from 4.0 to make collection easier

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
        checkpoints: [], // Checkpoints not handled by editor yet
        collectibles: [] // Add collectibles array for coins
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
        else if (mapping.category === 'collectibles') {
            const collectible = {
                ...item,
                id: `coin_${tile.x}_${tile.y}`,
                collected: false,
                respawnTime: 0
            };
            courseData.collectibles.push(collectible);
        } else console.warn(`Unknown category '${mapping.category}' for type ${tile.type}`);
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
            else if (mapping.category === 'collectibles') {
                const collectible = {
                    ...item,
                    id: `coin_${element.x}_${element.y}`,
                    collected: false,
                    respawnTime: 0
                };
                courseData.collectibles.push(collectible);
            } else console.warn(`Element type ${element.type} mapped to invalid category ${mapping.category}`);
        });
     } else {
          console.log(`Course ${editorData.name} has no elements array.`);
     }

    console.log(`Translated course ${courseData.name}: T:${courseData.terrain.length}, R:${courseData.road.length}, O:${courseData.obstacles.length}, D:${courseData.decorations.length}`);
    return courseData;
}

// Add after translateEditorDataToCourseData function
function addRandomCoinsToRoad(courseData) {
    // Get all road tiles
    const roadTiles = courseData.road.filter(tile => tile.type === 'road');
    
    // Place coins on about 20% of road tiles
    const numCoinsToPlace = Math.floor(roadTiles.length * 0.2);
    
    console.log(`[CoinPlacement] Adding coins to ${numCoinsToPlace} out of ${roadTiles.length} road tiles`);
    
    // Randomly select road tiles to place coins on
    for (let i = 0; i < numCoinsToPlace; i++) {
        const randomIndex = Math.floor(Math.random() * roadTiles.length);
        const roadTile = roadTiles[randomIndex];
        
        // Create a coin at the road tile position
        const coin = {
            type: 'coin',
            x: roadTile.x,
            y: 0,
            z: roadTile.z,
            width: EDITOR_TILE_SIZE,
            length: EDITOR_TILE_SIZE,
            id: `coin_random_${i}`,
            collected: false,
            respawnTime: 0
        };
        
        console.log(`[CoinPlacement] Added coin at (${coin.x}, ${coin.z})`);
        
        // Add to collectibles array
        if (!courseData.collectibles) {
            courseData.collectibles = [];
        }
        courseData.collectibles.push(coin);
        
        // Remove the used road tile to avoid duplicates
        roadTiles.splice(randomIndex, 1);
    }
    
    console.log(`[CoinPlacement] Added ${numCoinsToPlace} random coins to road tiles`);
}

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
                        // Add random coins to road tiles
                        addRandomCoinsToRoad(translatedData);
                        
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
        console.log(`Loaded ${Object.keys(courses).length} courses.`);
    } catch (error) {
        console.error('Error loading courses:', error);
        if (Object.keys(courses).length === 0) {
            console.warn("No courses loaded, ensure courses directory exists and is readable.");
            courses['sausage'] = {
                id: 'sausage',
                name: "Sausage Track",
                planeSize: { width: 100, height: 100 },
                startPositions: [{ x: 0, y: 0, z: 0 }],
                startRotation: { y: 0 },
                terrain: [{ type: 'grass', x: 0, y: 0, z: 0, width: 100, length: 100 }],
                obstacles: [], decorations: [], checkpoints: []
            };
            console.log("Created default 'sausage' course.");
        }
        if (!courses['sausage']) {
            courses['sausage'] = {
                id: 'sausage',
                name: "Sausage Track",
                planeSize: { width: 100, height: 100 },
                startPositions: [{ x: 0, y: 0, z: 0 }],
                startRotation: { y: 0 },
                terrain: [{ type: 'grass', x: 0, y: 0, z: 0, width: 100, length: 100 }],
                obstacles: [], decorations: [], checkpoints: []
            };
            console.log("Created default 'sausage' course.");
        }
        // Ensure 'sausage' course exists if nothing else loaded (create a default translated structure)
        if (Object.keys(courses).length === 0 || !courses['sausage']) {
            console.warn("No valid courses loaded or 'sausage' missing, creating default.");
             const defaultEditorData = {
                name: 'sausage',
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
                 courses['sausage'] = defaultTranslated;
                 console.log("Created default 'sausage' course from translated structure.");
             } else {
                  console.error("CRITICAL: Failed to create default translated 'sausage' course!");
                   // If even default fails, create a super minimal fallback
                   courses['sausage'] = {
                      id: 'sausage', name: 'Minimal Fallback', startPositions: [{x:0,y:0,z:0}], startRotation: {y:0},
                      terrain: [{type:'grass', x:0, y:0, z:0, width: 20, length: 20}], road:[], obstacles:[], decorations:[], checkpoints:[]
                   };
             }
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
    currentCourse: 'sausage'
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
                
                // Calculate response
                const overlap = collisionThreshold - distance;
                const nx = dx / distance;
                const nz = dz / distance;
                const separationForce = overlap * 3.0;
                
                // Calculate collision point
                const collisionPoint = {
                    x: (playerA.position.x + playerB.position.x) / 2,
                    y: 1.0,
                    z: (playerA.position.z + playerB.position.z) / 2
                };

                // Emit collision event to all clients
                io.emit('playerCollision', collisionPoint);
                
                // <<< RE-ENABLE P2P POSITIONAL CORRECTION >>>
                if (!isNaN(nx) && !isNaN(nz) && !isNaN(separationForce)) {
                    playerA.position.x += nx * separationForce;
                    playerA.position.z += nz * separationForce;
                    playerB.position.x -= nx * separationForce;
                    playerB.position.z -= nz * separationForce;
                    
                     if (isNaN(playerA.position.x) || isNaN(playerA.position.z)) {
                          console.error(`!!! FATAL: Player A (${playerA.id}) position became NaN AFTER P2P separation!`);
                     }
                     if (isNaN(playerB.position.x) || isNaN(playerB.position.z)) {
                          console.error(`!!! FATAL: Player B (${playerB.id}) position became NaN AFTER P2P separation!`);
                     }

                } else {
                    console.warn(`!!! Skipping P2P position separation due to NaN values (nx=${nx}, nz=${nz}, force=${separationForce}).`);
                }
                // <<< END RE-ENABLE >>>
                
                // Keep velocity exchange logic (less likely to cause jitter)
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
             player.velocity = 0; 
         }

        obstacles.forEach(obstacle => {
            if (!solidObstacleTypes.has(obstacle.type)) return;
            
            // Ensure obstacle position is valid FIRST
            // ... validation ...
            // Use a fixed hitbox for solid obstacles, adjust size as needed
            const OBSTACLE_HALF_SIZE = 2.5; // Previous: 1.5, makes obstacles 5.0x5.0 box
            let obstacleHalfWidth = OBSTACLE_HALF_SIZE;
            let obstacleHalfLength = OBSTACLE_HALF_SIZE;
            
            // <<< ADDED: Custom size for specific types >>>
            if (obstacle.type === 'tires' || obstacle.type === 'blocks') {
                obstacleHalfWidth = 1.0; // Larger half-size (2.0 width)
                obstacleHalfLength = 1.0; // Larger half-size (2.0 length)
            }

            // <<< Diagnostic Log >>>
            console.log(`  [Check AABB] Player ${player.id} (Pos: ${player.position.x.toFixed(2)},${player.position.z.toFixed(2)}) vs Obstacle ${obstacle.type} (Pos: ${obstacle.x.toFixed(2)},${obstacle.z.toFixed(2)})`);

            // --- AABB Check --- 
            const PLAYER_HALF_WIDTH = 0.5; 
            
            const playerMinX = player.position.x - PLAYER_HALF_WIDTH;
            const playerMaxX = player.position.x + PLAYER_HALF_WIDTH;
            const playerMinZ = player.position.z - PLAYER_HALF_WIDTH;
            const playerMaxZ = player.position.z + PLAYER_HALF_WIDTH;
            
            const obstacleMinX = obstacle.x - obstacleHalfWidth;
            const obstacleMaxX = obstacle.x + obstacleHalfWidth;
            const obstacleMinZ = obstacle.z - obstacleHalfLength;
            const obstacleMaxZ = obstacle.z + obstacleHalfLength;

            // Add a small margin to prevent jitter from floating point inaccuracies near edges
            const COLLISION_MARGIN = 0.01;
            const collisionX = (playerMaxX > obstacleMinX + COLLISION_MARGIN) && (playerMinX < obstacleMaxX - COLLISION_MARGIN);
            const collisionZ = (playerMaxZ > obstacleMinZ + COLLISION_MARGIN) && (playerMinZ < obstacleMaxZ - COLLISION_MARGIN);

            if (collisionX && collisionZ) {
                console.log(`---> OBSTACLE COLLISION DETECTED: Player ${player.id} vs Obstacle ${obstacle.type}`);
                
                // --- Simplified Direct Pushback Response --- 
                const pushVectorX = player.position.x - obstacle.x;
                const pushVectorZ = player.position.z - obstacle.z;
                const pushDist = Math.sqrt(pushVectorX * pushVectorX + pushVectorZ * pushVectorZ);

                let normPushX = 0;
                let normPushZ = 0;
                if (pushDist > 0.001) { 
                     normPushX = pushVectorX / pushDist;
                     normPushZ = pushVectorZ / pushDist;
                } else { 
                    console.warn(`Player ${player.id} is directly on top of obstacle ${obstacle.type}. Applying default push.`);
                    normPushX = 1;
                    normPushZ = 0;
                }
                
                 const totalHalfWidths = PLAYER_HALF_WIDTH + OBSTACLE_HALF_SIZE; 
                 const overlap = Math.max(0, totalHalfWidths - pushDist);
                
                 if (isNaN(normPushX) || isNaN(normPushZ) || isNaN(overlap)) {
                      console.error(`!!! FATAL: Calculated NaN pushback values! normX=${normPushX}, normZ=${normPushZ}, overlap=${overlap}`);
                      return;
                 }

                player.position.x += normPushX * overlap;
                player.position.z += normPushZ * overlap;
                console.log(`  Pushing player ${player.id} along (${normPushX.toFixed(2)}, ${normPushZ.toFixed(2)}) by ${overlap.toFixed(3)}`);
                
                 if (isNaN(player.position.x) || isNaN(player.position.z)) {
                      console.error(`!!! FATAL: Player (${player.id}) position became NaN AFTER Obstacle separation!`);
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

// Add after the checkCollisions function:
function checkCoinCollections(gameState) {
    const course = courses[gameState.courseId];
    if (!course || !course.collectibles) {
        console.log(`[CoinCheck] No course or collectibles found for course ${gameState.courseId}`);
        return;
    }

    console.log(`[CoinCheck] Found ${course.collectibles.length} coins on course ${gameState.courseId}`);

    for (const playerId in gameState.players) {
        const player = gameState.players[playerId];
        if (!player.position) {
            console.log(`[CoinCheck] Player ${playerId} has no position`);
            continue;
        }

        for (const coin of course.collectibles) {
            if (coin.collected) {
                // Check if it's time to respawn
                if (Date.now() >= coin.respawnTime) {
                    coin.collected = false;
                    coin.respawnTime = 0;
                    console.log(`[CoinCheck] Coin ${coin.id} respawned`);
                    // Broadcast coin respawn to all players
                    io.emit('coinRespawned', {
                        coinId: coin.id
                    });
                }
                continue;
            }

            // Check distance between player and coin
            const dx = player.position.x - coin.x;
            const dz = player.position.z - coin.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            console.log(`[CoinCheck] Distance check - Player ${playerId} at (${player.position.x.toFixed(2)}, ${player.position.z.toFixed(2)}) to Coin at (${coin.x.toFixed(2)}, ${coin.z.toFixed(2)}) = ${distance.toFixed(2)} units`);

            if (distance <= COIN_COLLECTION_RADIUS) {
                console.log(`[CoinCheck] Coin ${coin.id} collected by player ${playerId}!`);
                coin.collected = true;
                coin.respawnTime = Date.now() + COIN_RESPAWN_TIME;
                
                // Initialize coins if not exists
                if (!player.coins) player.coins = 0;
                player.coins++;
                
                // Emit coin collection event to all players
                io.emit('coinCollected', {
                    coinId: coin.id,
                    collectorId: playerId,
                    totalCoins: player.coins
                });
            }
        }
    }
}

// Socket.IO event handlers
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    if (!courses[gameState.currentCourse]) {
        console.warn(`Current course '${gameState.currentCourse}' not found, switching to 'sausage'.`);
        gameState.currentCourse = 'sausage';
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

    // Always send character-selection state to newly connected player
    socket.emit('updateGameState', 'character-selection', gameState.players, {
        courseId: gameState.currentCourse,
        courseData: currentValidCourse,
        editorTiles: courses[gameState.currentCourse]?.rawEditorTiles
    });

    // If racing already in progress, other players will stay in racing state
    if (gameState.state === 'racing') {
        // Only broadcast to other players, not the new one
        socket.broadcast.emit('playerJoined', socket.id, gameState.players[socket.id]);
    }

    // Handle character selection
    socket.on('playerSelectCharacter', (characterId) => {
        console.log(`Player ${socket.id} selected character ${characterId}`);
        if (gameState.players[socket.id]) {
            gameState.players[socket.id].characterId = characterId;
            gameState.readyPlayers.add(socket.id);
            
            // Always place the player at a start position
            const startPos = currentValidCourse.startPositions[
                (Object.keys(gameState.players).length - 1) % currentValidCourse.startPositions.length
            ];
            gameState.players[socket.id].position = { ...startPos };
            gameState.players[socket.id].rotation = { ...currentValidCourse.startRotation };
            gameState.players[socket.id].isSpectator = false;
            gameState.players[socket.id].velocity = 0; // Start with zero velocity
            gameState.players[socket.id].lap = 1; // Set starting lap

            console.log(`Player ${socket.id} placed at starting position, ready to race`);

            // Always transition to racing state if not already
            if (gameState.state !== 'racing') {
                gameState.state = 'racing';
                console.log('Game state changed to racing!');
            } else {
                console.log('Race already in progress, joining player to ongoing race');
            }

            // Ensure the course exists before using it
            const courseToSend = courses[gameState.currentCourse];
            if (!courseToSend) {
                console.error(`Error: Course '${gameState.currentCourse}' not found when trying to emit racing state.`);
                return; // Prevent emitting bad state
            }

            // Send updated game state to all clients
            io.emit('updateGameState', gameState.state, gameState.players, {
                courseId: gameState.currentCourse,
                courseData: courseToSend,
                editorTiles: courses[gameState.currentCourse]?.rawEditorTiles
            });
            
            // Send immediate racing state update to the joining player
            socket.emit('updateGameState', 'racing', gameState.players, {
                courseId: gameState.currentCourse,
                courseData: courseToSend,
                editorTiles: courses[gameState.currentCourse]?.rawEditorTiles
            });
        }
    });

    // Handle player state updates
    socket.on('playerUpdateState', (data) => {
        console.log(`[Debug] playerUpdateState received for ${socket.id}`);
        const player = gameState.players[socket.id]; 
        if (player) {
            // Store incoming data safely
            const clientUpdateData = { 
                position: data.position ? { ...data.position } : null,
                rotation: data.rotation ? { ...data.rotation } : null,
                velocity: (data.velocity !== undefined && !isNaN(data.velocity)) ? data.velocity : player.velocity // Use current if invalid
            };

            // Store state BEFORE applying client update AND before collision check
            const positionBeforeUpdate = { ...player.position }; 
            const velocityBeforeUpdate = player.velocity;
            
            // 1. Tentatively apply updates from client (validated)
            if (clientUpdateData.position) {
                player.position = clientUpdateData.position;
            }
            if (clientUpdateData.rotation) {
                 player.rotation = clientUpdateData.rotation;
            }
            // Apply validated velocity from clientUpdateData
            player.velocity = clientUpdateData.velocity;
            
            // <<< ADDED: Ground Type Slowdown >>>
            const currentCourseData = courses[gameState.currentCourse];
            if (currentCourseData && currentCourseData.rawEditorTiles && player.position) {
                const worldX = player.position.x;
                const worldZ = player.position.z;
                const gridX = Math.round(worldX / EDITOR_TILE_SIZE + EDITOR_GRID_WIDTH / 2);
                const gridY = Math.round(worldZ / EDITOR_TILE_SIZE + EDITOR_GRID_HEIGHT / 2); // Editor uses Y for Z-axis
                const tileIndex = gridY * EDITOR_GRID_WIDTH + gridX;

                console.log(`[GroundCheck] Player ${socket.id}: World(${worldX.toFixed(2)}, ${worldZ.toFixed(2)}) -> Grid(${gridX}, ${gridY}) -> Index(${tileIndex})`);

                if (gridX >= 0 && gridX < EDITOR_GRID_WIDTH && gridY >= 0 && gridY < EDITOR_GRID_HEIGHT) {
                    const groundTile = currentCourseData.rawEditorTiles[tileIndex];

                    if (groundTile) {
                        console.log(`[GroundCheck] Player ${socket.id}: Tile Type = ${groundTile.type}`);
                    } else {
                        console.log(`[GroundCheck] Player ${socket.id}: No tile data found at index ${tileIndex}`);
                    }

                    if (groundTile && (groundTile.type === 'grass' || groundTile.type === 'mud')) {
                        const slowdownFactor = 0.1; // <<< CHANGED: Adjust this value as needed (was 0.9)
                        player.velocity *= slowdownFactor;
                        // Optional: Log the slowdown
                        console.log(`Player ${socket.id} slowed on ${groundTile.type}. New velocity: ${player.velocity.toFixed(2)}`);
                        // Stop smoke if slowing down
                        socket.broadcast.emit('playerDrivingEffect', socket.id, 'none');
                    } else if (groundTile && (groundTile.type.startsWith('road') || groundTile.type === 'startfinish')) {
                         // Emit smoke effect for road or start/finish line
                         socket.broadcast.emit('playerDrivingEffect', socket.id, 'smoke');
                    } else {
                         // Emit no effect for other tile types (or no tile)
                         socket.broadcast.emit('playerDrivingEffect', socket.id, 'none');
                    }
                } else {
                     // Player is off the grid, emit no effect
                     socket.broadcast.emit('playerDrivingEffect', socket.id, 'none');
                }
            }
            // <<< END ADDED >>>

            // Store state AFTER applying client update but BEFORE collision check
            const stateBeforeCollisionCheck = {
                position: { ...player.position },
                rotation: { ...player.rotation },
                velocity: player.velocity
            };

            // 2. Perform Collision Checks & Resolution (potentially modifies player state)
            let collisionModifiedState = false;
            let posChangeDistanceSq = 0;
            let significantChange = false;

            if (player.position && !isNaN(player.position.x) && !isNaN(player.position.z)) {
                 checkCollisions(gameState); 

                 // 3. Check if state was ACTUALLY modified significantly by collisions
                 const finalPlayerState = gameState.players[socket.id]; // Re-get state after checkCollisions
                 if (finalPlayerState) {
                      // Compare final state with state *before* collision check
                      const posChanged = finalPlayerState.position.x !== stateBeforeCollisionCheck.position.x || 
                                         finalPlayerState.position.z !== stateBeforeCollisionCheck.position.z;
                      const velChanged = finalPlayerState.velocity !== stateBeforeCollisionCheck.velocity;
                      
                      if (posChanged) {
                           const dx = finalPlayerState.position.x - stateBeforeCollisionCheck.position.x;
                           const dz = finalPlayerState.position.z - stateBeforeCollisionCheck.position.z;
                           posChangeDistanceSq = dx * dx + dz * dz;
                      }
                      
                      const CORRECTION_THRESHOLD_SQ = 0.1 * 0.1; 
                      significantChange = posChangeDistanceSq > CORRECTION_THRESHOLD_SQ;
                      
                      if (posChanged || velChanged) {
                           collisionModifiedState = true;
                           console.log(`Collision system modified state for ${socket.id}. Pos changed: ${posChanged} (DistSq: ${posChangeDistanceSq.toFixed(4)}), Vel changed: ${velChanged}. Significant: ${significantChange}`);
                      }

                      // 4. <<< NEW: Decide whether to keep collision modifications or revert >>>
                      if (!significantChange) {
                           // Jitter reduction: If change wasn't significant, revert to the state we had *after* applying client data but *before* collisions
                           console.log(`   (Change below threshold, reverting ${socket.id} to pre-collision state for this tick)`);
                           player.position = stateBeforeCollisionCheck.position;
                           player.rotation = stateBeforeCollisionCheck.rotation;
                           player.velocity = stateBeforeCollisionCheck.velocity;
                           collisionModifiedState = false; // Treat as unmodified if reverted
                      } 
                      // ELSE: Keep the modified state if change was significant

                      // 5. Broadcast state to OTHERS (using the final decided state)
                      const stateToBroadcast = gameState.players[socket.id]; // Get the potentially reverted state
                      if (stateToBroadcast && !isNaN(stateToBroadcast.position.x) && !isNaN(stateToBroadcast.position.z)) {
                          socket.broadcast.emit('updatePlayerPosition', socket.id, stateToBroadcast.position, stateToBroadcast.rotation, stateToBroadcast.velocity);
                      } else {
                           console.error(`Player ${socket.id} state invalid before broadcast. Not broadcasting position.`);
                      }

                      // 6. Send correction back to the originating client ONLY IF state was significantly modified AND kept
                      if (collisionModifiedState && significantChange && stateToBroadcast && !isNaN(stateToBroadcast.position.x) && !isNaN(stateToBroadcast.position.z)) {
                           console.log(`---> Sending position correction back to client ${socket.id} (Significant change: ${Math.sqrt(posChangeDistanceSq).toFixed(3)})`);
                           socket.emit('updatePlayerPosition', socket.id, stateToBroadcast.position, stateToBroadcast.rotation, stateToBroadcast.velocity); 
                      } else if (collisionModifiedState && !significantChange) {
                           // This case should now not happen due to revert logic above
                           console.log(`   (Skipping correction for ${socket.id}: Reverted change below threshold)`);
                      }
                 } else {
                      console.error(`Player ${socket.id} disappeared after collision check!`);
                 }
            } else {
                 console.warn(`Skipping collision checks for ${socket.id} due to invalid state before checks.`);
                 // If state was invalid BEFORE checks, broadcast original client data if valid?
                  if (clientUpdateData.position && clientUpdateData.rotation && !isNaN(clientUpdateData.position.x) && !isNaN(clientUpdateData.position.z)) {
                       socket.broadcast.emit('updatePlayerPosition', socket.id, clientUpdateData.position, clientUpdateData.rotation, clientUpdateData.velocity);
                  }
            }

            // Check coin collections with current course ID
            const coinCheckState = {
                ...gameState,
                courseId: gameState.currentCourse
            };
            checkCoinCollections(coinCheckState);
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