// server.js (Restored)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO Server
const io = new Server(server, {
    // No specific transports needed now, defaults are fine
    cors: { // Keep CORS for flexibility during development
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

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
        gameState.currentState = GAME_STATES.CHARACTER_SELECTION;
        console.log("Returning to Character Selection.");
        io.emit('updateGameState', gameState.currentState, gameState.players);
    }, 5000);
}

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Handle root route to serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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

// Start the server
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 