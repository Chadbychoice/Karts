import { Server } from 'socket.io';
import { createServer } from 'http';

const httpServer = createServer();
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Game state
let players = {};
let currentGameState = 'character-selection';
let readyPlayers = new Set();

// Constants
const COLLISION_SEPARATION_EPSILON = 0.01;
const PLAYER_RADIUS = 1.0;

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    
    // Add new player to game state
    players[socket.id] = {
        id: socket.id,
        position: { x: 0, y: 0, z: 5 },
        rotation: { y: 0 },
        ready: false,
        finished: false,
        laps: 0,
        isDrifting: false,
        driftDirection: 0,
        isBoosting: false,
        boostLevel: 0
    };

    // Broadcast updated game state to all clients
    io.emit('updateGameState', currentGameState, players);

    // Handle character selection
    socket.on('playerSelectCharacter', (characterId) => {
        if (players[socket.id]) {
            players[socket.id].characterId = characterId;
            players[socket.id].ready = true;
            readyPlayers.add(socket.id);

            // Check if all players are ready
            if (readyPlayers.size >= Object.keys(players).length) {
                currentGameState = 'racing';
                io.emit('updateGameState', currentGameState, players);
            } else {
                io.emit('updateGameState', 'waiting', players);
            }
        }
    });

    // Handle player state updates
    socket.on('playerUpdateState', (data) => {
        if (players[socket.id]) {
            if (data.position) {
                players[socket.id].position = data.position;
            }
            if (data.rotation) {
                players[socket.id].rotation = data.rotation;
            }
            
            // Broadcast position update to other players
            socket.broadcast.emit('updatePlayerPosition', socket.id, data.position, data.rotation);

            // Check for collisions with other players
            Object.keys(players).forEach(otherId => {
                if (otherId !== socket.id) {
                    const p1 = players[socket.id];
                    const p2 = players[otherId];
                    
                    const dx = p1.position.x - p2.position.x;
                    const dz = p1.position.z - p2.position.z;
                    const distance = Math.sqrt(dx * dx + dz * dz);
                    
                    if (distance < PLAYER_RADIUS * 2) {
                        const overlap = PLAYER_RADIUS * 2 - distance;
                        if (overlap > 0) {
                            // Calculate separation amount (half for each player)
                            const separationAmount = (overlap / 2) + COLLISION_SEPARATION_EPSILON;
                            
                            // Calculate normalized direction vector
                            const nx = dx / distance;
                            const nz = dz / distance;
                            
                            // Update positions (push apart)
                            p1.position.x += nx * separationAmount;
                            p1.position.z += nz * separationAmount;
                            p2.position.x -= nx * separationAmount;
                            p2.position.z -= nz * separationAmount;
                            
                            // Emit collision event
                            const collisionPoint = {
                                x: (p1.position.x + p2.position.x) / 2,
                                y: (p1.position.y + p2.position.y) / 2,
                                z: (p1.position.z + p2.position.z) / 2
                            };
                            io.emit('collisionDetected', {
                                playerA_id: socket.id,
                                playerB_id: otherId,
                                collisionPoint: collisionPoint
                            });
                            
                            // Broadcast updated positions
                            io.emit('updatePlayerPosition', socket.id, p1.position, p1.rotation);
                            io.emit('updatePlayerPosition', otherId, p2.position, p2.rotation);
                        }
                    }
                }
            });
        }
    });

    // Handle drift state changes
    socket.on('playerDriftStateChange', (isDrifting, direction) => {
        if (players[socket.id]) {
            players[socket.id].isDrifting = isDrifting;
            players[socket.id].driftDirection = direction;
            socket.broadcast.emit('updatePlayerEffectsState', socket.id, {
                isDrifting: isDrifting,
                driftDirection: direction
            });
        }
    });

    // Handle boost start
    socket.on('playerBoostStart', (data) => {
        if (players[socket.id]) {
            players[socket.id].isBoosting = true;
            players[socket.id].boostLevel = data.level;
            setTimeout(() => {
                if (players[socket.id]) {
                    players[socket.id].isBoosting = false;
                    players[socket.id].boostLevel = 0;
                    socket.broadcast.emit('updatePlayerEffectsState', socket.id, {
                        isBoosting: false,
                        boostLevel: 0
                    });
                }
            }, data.duration);
            
            socket.broadcast.emit('updatePlayerEffectsState', socket.id, {
                isBoosting: true,
                boostLevel: data.level
            });
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        if (players[socket.id]) {
            delete players[socket.id];
            readyPlayers.delete(socket.id);
            io.emit('playerLeft', socket.id);
            
            // If no players left, reset game state
            if (Object.keys(players).length === 0) {
                currentGameState = 'character-selection';
                readyPlayers.clear();
            }
            // Update remaining players
            io.emit('updateGameState', currentGameState, players);
        }
    });
});

export default function SocketHandler(req, res) {
    if (!res.socket.server.io) {
        console.log('First use, starting socket.io');
        res.socket.server.io = io;
    } else {
        console.log('Socket.io already running');
    }
    res.end();
} 