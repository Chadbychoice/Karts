// server.js (Restored)
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['polling', 'websocket'],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 3000;
const LEVELS_DIR = join(__dirname, 'levels');

// --- Ensure Levels Directory Exists ---
try {
    if (!fs.existsSync(LEVELS_DIR)) {
        fs.mkdirSync(LEVELS_DIR);
        console.log(`Created levels directory at: ${LEVELS_DIR}`);
    }
} catch (err) {
    console.error("Error creating levels directory:", err);
    // Decide how to handle this - maybe exit?
    process.exit(1);
}

// --- Game State ---
const GAME_STATES = {
    CHARACTER_SELECTION: 'character-selection',
    RACING: 'racing',
    POST_RACE: 'post-race',
    WAITING_ROOM: 'waiting-room' // Not actively used currently, but defined
};

let gameState = {
    currentState: GAME_STATES.CHARACTER_SELECTION,
    players: {},
    race: {
        courseId: 1,
        laps: 3,
        startTime: null,
    }
};

const courses = {
    1: { startingPositions: [{x:0, y:0, z:5}, {x:2, y:0, z:5}, {x:-2, y:0, z:5}, {x:4, y:0, z:5}, {x:-4, y:0, z:5}] },
};

// Add this variable globally
let endRaceTimeoutId = null;

// --- Game Constants ---
const MIN_PLAYERS_TO_START = 2;
const PLAYER_COLLISION_RADIUS = 0.8; // Adjust as needed (world units)
const COLLISION_PUSH_FACTOR = 0.8; // Significantly increased push force
const COLLISION_SEPARATION_EPSILON = 0.01; // Tiny extra separation
const SERVER_TICK_RATE = 1000 / 15; // Milliseconds between server ticks (e.g., 15 Hz)

// --- Helper Functions ---
function checkRaceStart() {
    const connectedPlayers = Object.values(gameState.players);
    const readyPlayers = connectedPlayers.filter(p => p.ready);
    if (connectedPlayers.length > 0 && readyPlayers.length === connectedPlayers.length) {
        console.log("All players ready! Starting race...");
        startRace();
    } else {
        console.log(`Waiting for players: ${readyPlayers.length}/${connectedPlayers.length} ready.`);
    }
}

function assignStartingPosition(player, levelData) {
    const usedPositions = Object.values(gameState.players).map(p => p.startPositionIndex).filter(idx => idx !== undefined);
    const coursePositions = courses[gameState.race.courseId]?.startingPositions || [{x:0, y:0, z:5}];
    for(let i = 0; i < coursePositions.length; i++) {
        if (!usedPositions.includes(i)) {
            player.startPositionIndex = i;
            player.position = { ...coursePositions[i] };
            player.rotation = { y: 0 };
            return;
        }
    }
    player.position = { x: Math.random() * 10 - 5, y: 0, z: 5 + Math.random() * 2 };
    player.rotation = { y: 0 };
    console.warn("Could not assign unique starting position, using random.");
}

function startRace() {
    gameState.currentState = GAME_STATES.RACING;
    gameState.race.startTime = Date.now();

    // --- Attempt to load level data ---
    let levelData = null;
    const levelFilePath = join(LEVELS_DIR, 'test.json'); // Hardcode test.json for now
    try {
        if (fs.existsSync(levelFilePath)) {
            const rawData = fs.readFileSync(levelFilePath, 'utf8');
            levelData = JSON.parse(rawData);
            console.log("Loaded level data from test.json");
            // TODO: Validate levelData structure?
        } else {
            console.log("test.json not found, using default course setup.");
        }
    } catch (err) {
        console.error("Error loading or parsing test.json:", err);
        levelData = null; // Ensure fallback if error occurs
    }

    Object.values(gameState.players).forEach(player => {
        player.laps = 0;
        player.finished = false;
        assignStartingPosition(player, levelData); // Pass levelData (though not fully used yet)
    });
    console.log("Broadcasting race start. Players:", gameState.players);
    io.emit('updateGameState', gameState.currentState, gameState.players, levelData);
}

function endRace() {
    // Clear any previous timeout just in case
    if (endRaceTimeoutId) {
        clearTimeout(endRaceTimeoutId);
        endRaceTimeoutId = null;
    }

    gameState.currentState = GAME_STATES.POST_RACE;
    gameState.race.startTime = null;
    console.log("Race finished! Returning to character selection shortly.");
    Object.values(gameState.players).forEach(player => {
       player.ready = false;
       player.characterId = null;
       player.position = null;
       player.rotation = null;
       player.startPositionIndex = undefined;
    });
    // Store the timeout ID
    endRaceTimeoutId = setTimeout(() => {
        gameState.currentState = GAME_STATES.CHARACTER_SELECTION;
        console.log("Returning to Character Selection.");
        io.emit('updateGameState', gameState.currentState, gameState.players);
        endRaceTimeoutId = null; // Clear ID after execution
    }, 5000);
}

// Serve static files from the "public" directory with correct MIME types
app.use(express.static('public', {
    setHeaders: (res, path) => {
        if (path.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        } else if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));
app.use('/node_modules', express.static(join(__dirname, 'node_modules')));

// Handle root route to serve index.html
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// ADDED: Handle editor route
app.get('/editor', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'editor.html'));
});

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id, " Current players:", Object.keys(gameState.players).length);

    // Create player state
    gameState.players[socket.id] = {
        id: socket.id,
        characterId: null,
        position: null,
        rotation: null,
        ready: false,
        finished: false,
        laps: 0,
        // Add state for effects synchronization
        isDrifting: false,
        driftDirection: 0, // -1 left, 1 right
        isBoosting: false,
        boostLevel: 0, // 1 or 2
    };

    // Send current state to the new player
    let initialStateForNewPlayer = gameState.currentState;
    if (gameState.currentState === GAME_STATES.RACING || gameState.currentState === GAME_STATES.POST_RACE) {
        initialStateForNewPlayer = 'waiting';
        console.log(`Player ${socket.id} joined during race/post-race, setting to waiting.`);
    } else {
         initialStateForNewPlayer = GAME_STATES.CHARACTER_SELECTION;
         gameState.players[socket.id].ready = false;
         console.log(`Player ${socket.id} joined during selection phase.`);
    }
    socket.emit('updateGameState', initialStateForNewPlayer, gameState.players);

    // Notify other players
    socket.broadcast.emit('playerJoined', socket.id, gameState.players[socket.id]);

    // --- Event Listeners for this client ---
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const wasRacing = gameState.currentState === GAME_STATES.RACING;
        const disconnectedPlayer = gameState.players[socket.id];
        delete gameState.players[socket.id];
        io.emit('playerLeft', socket.id);

        const remainingPlayers = Object.keys(gameState.players).length;
        console.log("Remaining players:", remainingPlayers);

        if (remainingPlayers < 1) {
            console.log("Last player disconnected.");
            if (wasRacing) {
                 console.log("Last player left during race. Ending race.");
                 endRace(); // Let endRace handle the timeout and transition
            } else {
                 // If last player leaves during POST_RACE or CHARACTER_SELECTION, reset immediately
                 console.log("Last player left outside of race.");
                 if (endRaceTimeoutId) { // If endRace timeout was running
                     console.log("Clearing pending endRace timeout.");
                     clearTimeout(endRaceTimeoutId);
                     endRaceTimeoutId = null;
                 }
                 // Ensure state is Character Selection
                 if (gameState.currentState !== GAME_STATES.CHARACTER_SELECTION) {
                     console.log("Forcing state to Character Selection.");
                     gameState.currentState = GAME_STATES.CHARACTER_SELECTION;
                     gameState.race.startTime = null;
                      // No need to reset player states as players object is empty
                     io.emit('updateGameState', gameState.currentState, gameState.players); // Broadcast immediate reset
                 }
            }
        } else { // More than 0 players remaining
            console.log(`[Disconnect Check] State is ${gameState.currentState}, wasRacing = ${wasRacing}`);
            if (wasRacing) {
                // Check if all *remaining* players are spectators (joined mid-race)
                const currentPlayers = Object.values(gameState.players);
                console.log('Remaining player details:', JSON.stringify(currentPlayers.map(p => ({id: p.id, charId: p.characterId})))); // Log details
                const remainingRacers = currentPlayers.filter(p => p.characterId !== null).length;
                console.log(`Player left during race. Remaining players: ${remainingPlayers}. Remaining racers: ${remainingRacers}.`);
                if (remainingRacers === 0) {
                    console.log("All original racers have left. Ending race.");
                    endRace(); // Trigger race end even if spectators remain
                }
            } else if (gameState.currentState === GAME_STATES.CHARACTER_SELECTION && disconnectedPlayer?.ready) {
                console.log("Ready player left during selection, checking if race can start.");
                checkRaceStart();
            }
        }
    });

    socket.on('playerSelectCharacter', (characterId) => {
        if (gameState.players[socket.id] && gameState.currentState === GAME_STATES.CHARACTER_SELECTION) {
            gameState.players[socket.id].characterId = characterId;
            gameState.players[socket.id].ready = true;
            console.log(`Player ${socket.id} selected character ${characterId} and is ready.`);
            io.emit('updateGameState', gameState.currentState, gameState.players);
            checkRaceStart();
        } else {
            console.warn(`Player ${socket.id} attempted selection in invalid state: ${gameState.currentState}`);
        }
    });

    socket.on('playerUpdateState', (clientState) => {
        if (!gameState.players[socket.id] || gameState.currentState !== GAME_STATES.RACING) return;
        if (clientState.position) gameState.players[socket.id].position = clientState.position;
        if (clientState.rotation) gameState.players[socket.id].rotation = clientState.rotation;
        // Only broadcast position/rotation, other state handled below
        socket.broadcast.emit('updatePlayerPosition', socket.id, clientState.position, clientState.rotation);
    });

    // --- New handlers for effect state ---
    socket.on('playerDriftStateChange', (isDrifting, direction) => {
        if (gameState.players[socket.id]) {
            gameState.players[socket.id].isDrifting = isDrifting;
            gameState.players[socket.id].driftDirection = isDrifting ? direction : 0;
            // Broadcast the change immediately to other players
            socket.broadcast.emit('updatePlayerEffectsState', socket.id, {
                 isDrifting: gameState.players[socket.id].isDrifting,
                 driftDirection: gameState.players[socket.id].driftDirection
            });
        }
    });

    socket.on('playerBoostStart', (level) => {
        if (gameState.players[socket.id]) {
            const player = gameState.players[socket.id];
            player.isBoosting = true;
            player.boostLevel = level;
            // Broadcast the change immediately
            socket.broadcast.emit('updatePlayerEffectsState', socket.id, {
                 isBoosting: player.isBoosting,
                 boostLevel: player.boostLevel
            });

            // Set timer to automatically end the boost on the server
            // BOOST_DURATION needs to be defined or imported (assuming 800ms for now)
            const BOOST_DURATION_SERVER = 800;
            setTimeout(() => {
                if (gameState.players[socket.id]) { // Check if player still exists
                    gameState.players[socket.id].isBoosting = false;
                    gameState.players[socket.id].boostLevel = 0;
                     // Broadcast the end of the boost
                    socket.broadcast.emit('updatePlayerEffectsState', socket.id, {
                        isBoosting: gameState.players[socket.id].isBoosting,
                        boostLevel: gameState.players[socket.id].boostLevel
                    });
                }
            }, BOOST_DURATION_SERVER);
        }
    });

    // --- Editor Event Listener (Add this block) ---
    socket.on('editorSaveLevel', ({ name, data }) => {
        console.log(`Received level save request for: ${name}`);

        // Basic validation/sanitization
        if (!name || typeof name !== 'string' || name.length > 50 || !/^[a-zA-Z0-9_\-]+$/.test(name)) {
            console.error("Invalid level name received:", name);
            // Optionally send an error back to the editor client
            socket.emit('saveLevelError', { name: name, message: "Invalid level name." });
            return;
        }
        if (!data || typeof data !== 'object') {
             console.error("Invalid level data received for:", name);
             socket.emit('saveLevelError', { name: name, message: "Invalid level data format." });
             return;
        }

        const safeFilename = name + '.json'; // Add .json extension
        const filePath = join(LEVELS_DIR, safeFilename);

        try {
            const jsonData = JSON.stringify(data, null, 2); // Pretty print JSON
            fs.writeFile(filePath, jsonData, (err) => {
                if (err) {
                    console.error(`Error writing level file ${filePath}:`, err);
                    socket.emit('saveLevelError', { name: name, message: "Server error saving file." });
                } else {
                    console.log(`Successfully saved level: ${filePath}`);
                    // Optionally send success feedback to the editor client
                    socket.emit('saveLevelSuccess', { name: name });
                }
            });
        } catch (stringifyError) {
            console.error(`Error stringifying level data for ${name}:`, stringifyError);
            socket.emit('saveLevelError', { name: name, message: "Server error processing level data." });
        }
    });
});

// Start the server
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// --- Server-Side Game Loop ---
setInterval(() => {
    if (gameState.currentState !== GAME_STATES.RACING) return; // Only run during race

    const playerIds = Object.keys(gameState.players);
    if (playerIds.length < 2) return; // Need at least 2 players to collide

    // Collision Detection & Resolution
    for (let i = 0; i < playerIds.length; i++) {
        for (let j = i + 1; j < playerIds.length; j++) {
            const p1Id = playerIds[i];
            const p2Id = playerIds[j];
            const p1 = gameState.players[p1Id];
            const p2 = gameState.players[p2Id];

            // Ensure both players have positions
            if (!p1 || !p2 || !p1.position || !p2.position) continue;

            const dx = p1.position.x - p2.position.x;
            const dz = p1.position.z - p2.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            const collisionThreshold = PLAYER_COLLISION_RADIUS * 2;

            if (distance < collisionThreshold && distance > 0) { // Check for collision
                console.log(`Collision detected between ${p1Id} and ${p2Id}`);

                // Calculate normalized direction vector from p2 to p1
                const nx = dx / distance;
                const nz = dz / distance;

                // Calculate overlap and push amount
                const overlap = collisionThreshold - distance;
                // Directly separate players by half the overlap each
                const separationAmount = (overlap / 2) + COLLISION_SEPARATION_EPSILON;

                // Apply push (modify server state directly)
                p1.position.x += nx * separationAmount;
                p1.position.z += nz * separationAmount;
                p2.position.x -= nx * separationAmount;
                p2.position.z -= nz * separationAmount;

                 // Calculate collision point (midpoint)
                 const collisionPoint = {
                      x: p2.position.x + dx / 2,
                      y: (p1.position.y + p2.position.y) / 2, // Average Y - adjust if needed
                      z: p2.position.z + dz / 2
                 };

                // Emit event to clients for effects
                io.emit('collisionDetected', { 
                     playerA_id: p1Id, 
                     playerB_id: p2Id, 
                     collisionPoint: collisionPoint 
                });

                // Immediately broadcast updated positions for physics response
                // (Clients might lerp, but this reflects the server's correction)
                 const p1Update = { position: p1.position, rotation: p1.rotation };
                 const p2Update = { position: p2.position, rotation: p2.rotation };
                 io.emit('updatePlayerPosition', p1Id, p1Update.position, p1Update.rotation);
                 io.emit('updatePlayerPosition', p2Id, p2Update.position, p2Update.rotation);
            }
        }
    }
}, SERVER_TICK_RATE); 