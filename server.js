// server.js (Restored)
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);

// Course data
const courses = {
    test: {
        id: 'test',
        name: "Test Track",
        planeSize: { width: 100, height: 100 },
        roadTexturePath: '/textures/road.png',
        textureRepeat: { x: 10, y: 10 },
        checkpoints: [
            { x: -40, y: 0, z: 0 },
            { x: 40, y: 0, z: 0 },
            { x: 40, y: 0, z: 40 },
            { x: -40, y: 0, z: 40 }
        ],
        startPositions: [
            { x: 0, y: 0, z: 0 },
            { x: 2, y: 0, z: 0 },
            { x: -2, y: 0, z: 0 },
            { x: 4, y: 0, z: 0 }
        ],
        startRotation: { y: 0 },
        terrain: [
            { type: 'road', x: 0, y: 0, z: 0, width: 80, length: 80 },
            { type: 'grass', x: -50, y: 0, z: 0, width: 20, length: 80 },
            { type: 'grass', x: 50, y: 0, z: 0, width: 20, length: 80 }
        ],
        obstacles: [
            { type: 'mud', x: 20, y: 0, z: 20, width: 10, length: 10 },
            { type: 'mud', x: -20, y: 0, z: 40, width: 10, length: 10 }
        ],
        decorations: [
            { type: 'startline', x: 0, y: 0.1, z: 5, rotation: { y: 0 } },
            { type: 'finishline', x: 0, y: 0.1, z: 75, rotation: { y: 0 } }
        ]
    }
};

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
    currentCourse: 'test'
};

// Add collision detection
function checkCollisions(gameState) {
    const players = Object.values(gameState.players);
    
    for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
            const playerA = players[i];
            const playerB = players[j];
            
            // Skip if either player doesn't have a position
            if (!playerA.position || !playerB.position) continue;
            
            // Calculate distance between players
            const dx = playerA.position.x - playerB.position.x;
            const dz = playerA.position.z - playerB.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            
            // Collision radius (sum of both kart radii)
            const collisionThreshold = 2.5; // Adjusted for better detection
            
            if (distance < collisionThreshold) {
                // Calculate collision point (midpoint between players)
                const collisionPoint = {
                    x: (playerA.position.x + playerB.position.x) / 2,
                    y: Math.max(playerA.position.y, playerB.position.y) + 1.0, // Raise spark height
                    z: (playerA.position.z + playerB.position.z) / 2
                };
                
                // Calculate collision response
                const overlap = collisionThreshold - distance;
                if (overlap > 0) {
                    // Normalize collision vector
                    const nx = dx / distance;
                    const nz = dz / distance;
                    
                    // Strong immediate separation to prevent passing through
                    const separationForce = overlap * 3.0; // Increased force
                    
                    // Update positions with strong separation
                    playerA.position.x += nx * separationForce;
                    playerA.position.z += nz * separationForce;
                    playerB.position.x -= nx * separationForce;
                    playerB.position.z -= nz * separationForce;
                    
                    // Calculate relative velocity
                    const relativeVelocity = Math.abs(playerA.velocity - playerB.velocity);
                    const velocityFactor = Math.min(Math.max(relativeVelocity, 0.3), 1.0); // Ensure minimum effect
                    
                    // Exchange velocities with dampening
                    const restitution = 0.8; // Increased bounce factor
                    const tempVel = playerA.velocity;
                    playerA.velocity = playerB.velocity * restitution;
                    playerB.velocity = tempVel * restitution;
                    
                    // Add some sideways velocity for more dynamic collisions
                    const sideForce = relativeVelocity * 0.5; // Increased side force
                    playerA.sideVelocity = (Math.random() - 0.5) * sideForce;
                    playerB.sideVelocity = (Math.random() - 0.5) * sideForce;
                    
                    // Emit collision event with intensity based on relative velocity
                    io.emit('collisionDetected', {
                        playerA_id: playerA.id,
                        playerB_id: playerB.id,
                        collisionPoint: collisionPoint,
                        intensity: velocityFactor,
                        sparkRange: Math.min(relativeVelocity * 0.8, 2.0) // Adjusted spark range
                    });

                    // Log collision for debugging
                    console.log('Collision detected:', {
                        distance,
                        separationForce,
                        velocityFactor,
                        sparkRange: Math.min(relativeVelocity * 0.8, 2.0)
                    });
                }
            }
        }
    }
}

// Socket.IO event handlers
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    // Add player to game state
    gameState.players[socket.id] = {
        id: socket.id,
        connected: true,
        timestamp: Date.now(),
        characterId: null,
        position: courses[gameState.currentCourse].startPositions[0],
        rotation: courses[gameState.currentCourse].startRotation,
        velocity: 0,
        lap: 1,
        nextCheckpoint: 0,
        finishedRace: false
    };

    // Send current game state to the new player
    socket.emit('updateGameState', gameState.state, gameState.players, {
        courseId: gameState.currentCourse,
        courseData: courses[gameState.currentCourse]
    });

    // Handle character selection
    socket.on('playerSelectCharacter', (characterId) => {
        console.log(`Player ${socket.id} selected character ${characterId}`);
        if (gameState.players[socket.id]) {
            gameState.players[socket.id].characterId = characterId;
            gameState.readyPlayers.add(socket.id);
            
            // Check if all connected players have selected characters
            const allPlayersReady = Object.keys(gameState.players).every(playerId => 
                gameState.players[playerId].characterId !== null
            );

            if (allPlayersReady || gameState.readyPlayers.size >= 1) {
                console.log('All players ready, starting race!');
                gameState.state = 'racing';
                
                // Assign start positions to players
                const readyPlayers = Array.from(gameState.readyPlayers);
                readyPlayers.forEach((playerId, index) => {
                    if (gameState.players[playerId]) {
                        const startPos = courses[gameState.currentCourse].startPositions[index % courses[gameState.currentCourse].startPositions.length];
                        gameState.players[playerId].position = { ...startPos };
                        gameState.players[playerId].rotation = { ...courses[gameState.currentCourse].startRotation };
                    }
                });

                // Broadcast the updated game state to all players
                io.emit('updateGameState', gameState.state, gameState.players, {
                    courseId: gameState.currentCourse,
                    courseData: courses[gameState.currentCourse]
                });
            }
        }
    });

    socket.on('playerUpdateState', (data) => {
        if (gameState.players[socket.id]) {
            if (data.position) gameState.players[socket.id].position = data.position;
            if (data.rotation) gameState.players[socket.id].rotation = data.rotation;
            if (data.velocity !== undefined) gameState.players[socket.id].velocity = data.velocity;
            
            // Check for collisions after position update
            checkCollisions(gameState);
            
            // Broadcast to other players
            socket.broadcast.emit('updatePlayerPosition', socket.id, data.position, data.rotation);
        }
    });

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
            
            // Schedule boost end
            setTimeout(() => {
                if (gameState.players[socket.id]) {
                    gameState.players[socket.id].isBoosting = false;
                    gameState.players[socket.id].boostLevel = 0;
                    socket.broadcast.emit('updatePlayerEffectsState', socket.id, {
                        isBoosting: false,
                        boostLevel: 0
                    });
                }
            }, data.duration);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        gameState.readyPlayers.delete(socket.id);
        delete gameState.players[socket.id];
        io.emit('playerLeft', socket.id);

        // If no players left, reset game state
        if (Object.keys(gameState.players).length === 0) {
            gameState.state = 'character-selection';
            gameState.readyPlayers.clear();
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
const PORT = process.env.PORT || 3000;
const MAX_RETRIES = 5;
const RETRY_DELAY = 1000;
let currentPort = PORT;

async function startServer(retryCount = 0) {
    try {
        await new Promise((resolve, reject) => {
            server.listen(currentPort, '0.0.0.0', () => {
                console.log(`Server running on port ${currentPort}`);
                console.log('Environment:', process.env.NODE_ENV);
                resolve();
            }).on('error', (error) => {
                if (error.code === 'EADDRINUSE') {
                    console.log(`Port ${currentPort} is busy, trying next port...`);
                    currentPort++;
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

startServer(); 