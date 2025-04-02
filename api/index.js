const http = require('http');
const { Server } = require('socket.io');
// Note: We don't need express or path for this simple Vercel setup
// Vercel handles static file serving from the root or 'public' directory automatically.

// --- Game State (Needs to persist across invocations if possible, complex on Vercel - see note below) ---
// Warning: Standard serverless functions are stateless. Storing gameState in memory like this
// will likely NOT work reliably on Vercel as each request might hit a different instance.
// For a production Vercel deployment, you'd typically use an external store
// like Vercel KV, Upstash Redis, MongoDB Atlas, etc., for shared state.
// For simplified initial deployment/testing, we'll keep it in memory, but be aware of this limitation.
const GAME_STATES = {
    CHARACTER_SELECTION: 'character-selection',
    RACING: 'racing',
    POST_RACE: 'post-race',
    WAITING_ROOM: 'waiting-room'
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

// --- Global Socket.IO Server Instance ---
// We need to initialize Socket.IO differently for serverless environments.
// We'll attach it to the HTTP server instance managed by Vercel.
let io;

function initializeSocketIO(server) {
    if (io) return io; // Already initialized

    io = new Server(server, {
         path: "/socket.io", // Explicitly set the path
         cors: { // Configure CORS if your frontend might be on a different Vercel URL initially
             origin: "*", // Allow all origins for simplicity, tighten in production
             methods: ["GET", "POST"]
         }
    });
    console.log("Socket.IO server initialized with path /socket.io");

    // --- Socket.IO Connection Handling (Moved inside initialization) ---
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
            if (wasRacing && remainingPlayers < 1) {
                console.log("Last player left during race. Ending race.");
                endRace();
            } else if (gameState.currentState === GAME_STATES.CHARACTER_SELECTION && disconnectedPlayer?.ready) {
                 checkRaceStart();
            }
            console.log("Remaining players:", remainingPlayers);
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
            socket.broadcast.emit('updatePlayerPosition', socket.id, clientState.position, clientState.rotation);
        });
    });

    return io;
}

// --- Helper Functions (Need access to the global `io` instance) ---
function checkRaceStart() {
    if (!io) return; // Guard against io not being initialized
    const connectedPlayers = Object.values(gameState.players);
    const readyPlayers = connectedPlayers.filter(p => p.ready);
    if (connectedPlayers.length > 0 && readyPlayers.length === connectedPlayers.length) {
        console.log("All players ready! Starting race...");
        startRace();
    } else {
        console.log(`Waiting for players: ${readyPlayers.length}/${connectedPlayers.length} ready.`);
    }
}

function assignStartingPosition(player) {
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
    if (!io) return;
    gameState.currentState = GAME_STATES.RACING;
    gameState.race.startTime = Date.now();
    Object.values(gameState.players).forEach(player => {
        player.laps = 0;
        player.finished = false;
        assignStartingPosition(player);
    });
    console.log("Broadcasting race start. Players:", gameState.players);
    io.emit('updateGameState', gameState.currentState, gameState.players);
}

function endRace() {
    if (!io) return;
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
    setTimeout(() => {
        if (!io) return; // Check again in timeout
        gameState.currentState = GAME_STATES.CHARACTER_SELECTION;
        console.log("Returning to Character Selection.");
        io.emit('updateGameState', gameState.currentState, gameState.players);
    }, 5000);
}

// --- Vercel Serverless Function Handler ---
// This function will be executed by Vercel for incoming HTTP requests.
// We need to handle Socket.IO setup within this request context if it hasn't happened yet.
module.exports = (req, res) => {
    // Create an HTTP server instance or reuse existing one attached by Vercel
    // Vercel automatically provides req.socket.server for accessing the underlying server
    const server = res.socket?.server || http.createServer((_req, _res) => _res.writeHead(404).end());

    // Initialize Socket.IO if it hasn't been initialized for this server instance
    initializeSocketIO(server);

    // Vercel needs a response to the initial HTTP request, even though Socket.IO handles the rest.
    // We can just send a 200 OK or handle specific API routes if needed later.
    if (!res.headersSent) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Socket.IO server running.');
    }
};

// Note: For local development, you might need a separate entry point
// that explicitly creates an HTTP server and calls this handler, e.g.:
// if (process.env.NODE_ENV !== 'production') {
//     const localServer = http.createServer((req, res) => module.exports(req, res));
//     localServer.listen(3000, () => {
//         console.log('Local dev server with Socket.IO running on port 3000');
//     });
// } 