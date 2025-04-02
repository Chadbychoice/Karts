const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// --- Game State ---
const GAME_STATES = {
    CHARACTER_SELECTION: 'character-selection',
    RACING: 'racing',
    POST_RACE: 'post-race', // Or 'results'
    WAITING_ROOM: 'waiting-room' // Could be combined with char select
};

let gameState = {
    currentState: GAME_STATES.CHARACTER_SELECTION,
    players: {}, // { socketId: { characterId: null, position: {x,y,z}, rotation: {y}, ready: false, finished: false, laps: 0 }, ... }
    race: {
        courseId: 1, // Default course
        laps: 3,
        startTime: null,
        // Potentially add waypoints, finish line data later
    }
};

// Placeholder for simple course data (e.g., starting positions)
const courses = {
    1: { startingPositions: [{x:0, y:0, z:5}, {x:2, y:0, z:5}, {x:-2, y:0, z:5}, {x:4, y:0, z:5}, {x:-4, y:0, z:5}] },
    // Add more courses later
};

// --- Helper Functions ---
function getSanitizedGameState() {
    // Send only necessary data to clients
    // Could filter based on player state (e.g., don't send detailed race data during char select)
    return gameState;
}

function broadcastGameState() {
    // Sends the *entire* game state - potentially large, optimize later if needed
    // For now, we'll send specific updates instead where possible
    // io.emit('updateGameState', gameState.currentState, gameState.players);
}

function checkRaceStart() {
    const connectedPlayers = Object.values(gameState.players);
    const readyPlayers = connectedPlayers.filter(p => p.ready);

    // Start race if at least one player is ready and all connected players are ready
    if (connectedPlayers.length > 0 && readyPlayers.length === connectedPlayers.length) {
        console.log("All players ready! Starting race...");
        startRace();
    } else {
        console.log(`Waiting for players: ${readyPlayers.length}/${connectedPlayers.length} ready.`);
    }
}

function assignStartingPosition(player) {
    // Find an available starting position
    const usedPositions = Object.values(gameState.players).map(p => p.startPositionIndex).filter(idx => idx !== undefined);
    const coursePositions = courses[gameState.race.courseId]?.startingPositions || [{x:0, y:0, z:5}]; // Fallback
    for(let i = 0; i < coursePositions.length; i++) {
        if (!usedPositions.includes(i)) {
            player.startPositionIndex = i;
            player.position = { ...coursePositions[i] }; // Assign initial position
            player.rotation = { y: 0 }; // Default rotation
            return;
        }
    }
    // Fallback if more players than positions (should handle gracefully)
    player.position = { x: Math.random() * 10 - 5, y: 0, z: 5 + Math.random() * 2 };
    player.rotation = { y: 0 };
    console.warn("Could not assign unique starting position, using random.");
}


function startRace() {
    gameState.currentState = GAME_STATES.RACING;
    gameState.race.startTime = Date.now();

    // Reset player race state and assign starting positions
    Object.values(gameState.players).forEach(player => {
        player.laps = 0;
        player.finished = false;
        assignStartingPosition(player);
        // Other race-specific resets if needed
    });

    console.log("Broadcasting race start. Players:", gameState.players);
    // Send the updated state (racing) and initial positions/rotations
    io.emit('updateGameState', gameState.currentState, gameState.players);
    // Could add a countdown timer here before actually enabling controls client-side
}

function endRace() {
    gameState.currentState = GAME_STATES.POST_RACE; // Or CHARACTER_SELECTION directly
    gameState.race.startTime = null;
    console.log("Race finished! Returning to character selection shortly.");

    // Reset player readiness for the next round
    Object.values(gameState.players).forEach(player => {
       player.ready = false;
       player.characterId = null; // Force re-selection
       // Clear position/rotation or keep last known? Let's clear for now
       player.position = null;
       player.rotation = null;
       player.startPositionIndex = undefined;
    });

    // Give players a moment to see results (implement later)
    setTimeout(() => {
        gameState.currentState = GAME_STATES.CHARACTER_SELECTION;
        console.log("Returning to Character Selection.");
        // Send updated state - players will need to re-select characters
        io.emit('updateGameState', gameState.currentState, gameState.players);
    }, 5000); // 5 second delay before going back to character select
}

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // 1. Create player state
    gameState.players[socket.id] = {
        id: socket.id,
        characterId: null,
        position: null, // Will be set at race start
        rotation: null,
        ready: false,
        finished: false,
        laps: 0,
        // Add other relevant player state: name, color, items, etc.
    };

    // 2. Send current state to the new player
    // Determine if they should wait or select characters
    let initialStateForNewPlayer = gameState.currentState;
    if (gameState.currentState === GAME_STATES.RACING || gameState.currentState === GAME_STATES.POST_RACE) {
        initialStateForNewPlayer = 'waiting'; // Tell client to show waiting screen
        console.log(`Player ${socket.id} joined during race/post-race, setting to waiting.`);
    } else {
         initialStateForNewPlayer = GAME_STATES.CHARACTER_SELECTION; // Ensure they go to char select
         gameState.players[socket.id].ready = false; // Ensure not ready by default
         console.log(`Player ${socket.id} joined during selection phase.`);
    }
    // Send the determined state and the *full* current player list
    socket.emit('updateGameState', initialStateForNewPlayer, gameState.players);


    // 3. Notify other players about the new connection
    socket.broadcast.emit('playerJoined', socket.id, gameState.players[socket.id]);

    // --- Event Listeners for this client ---

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const wasRacing = gameState.currentState === GAME_STATES.RACING;
        const disconnectedPlayer = gameState.players[socket.id]; // Get data before deleting

        // Remove player from state
        delete gameState.players[socket.id];

        // Notify others
        io.emit('playerLeft', socket.id);

        // Check if game state needs to change
        const remainingPlayers = Object.keys(gameState.players).length;
        if (wasRacing && remainingPlayers < 1) { // Or < minimum players if desired
            console.log("Last player left during race. Ending race.");
            endRace(); // Or transition to waiting/char select immediately
        } else if (gameState.currentState === GAME_STATES.CHARACTER_SELECTION && disconnectedPlayer?.ready) {
            // If a ready player disconnects during selection, re-check if race can start
             checkRaceStart();
        }

        console.log("Remaining players:", remainingPlayers);
    });

    socket.on('playerSelectCharacter', (characterId) => {
        if (gameState.players[socket.id] && gameState.currentState === GAME_STATES.CHARACTER_SELECTION) {
            gameState.players[socket.id].characterId = characterId;
            gameState.players[socket.id].ready = true; // Mark as ready after selecting
            console.log(`Player ${socket.id} selected character ${characterId} and is ready.`);

            // Notify all clients about the updated player (character chosen, ready status)
            // Could optimize to only send the changed player, but sending all is simpler for now
            io.emit('updateGameState', gameState.currentState, gameState.players); // Send full state to ensure sync


            // Check if all connected players are now ready
            checkRaceStart();
        } else {
            console.warn(`Player ${socket.id} attempted to select character in invalid state: ${gameState.currentState}`);
            // Optionally send an error back to the client
            // socket.emit('errorState', 'Cannot select character now.');
        }
    });

    socket.on('playerUpdateState', (clientState) => {
         // Basic validation
        if (!gameState.players[socket.id] || gameState.currentState !== GAME_STATES.RACING) {
            return; // Ignore updates if player doesn't exist or game not racing
        }
        if (clientState.position) {
             gameState.players[socket.id].position = clientState.position;
        }
         if (clientState.rotation) {
             gameState.players[socket.id].rotation = clientState.rotation;
        }
        // TODO: Add server-side validation/physics check here later

        // Broadcast position/rotation to other players
        socket.broadcast.emit('updatePlayerPosition', socket.id, clientState.position, clientState.rotation);
    });

    // Add more listeners: player finished lap, used item, etc.

});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 