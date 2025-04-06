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

const COURSES_DIR = join(__dirname, 'courses');

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
                    const data = await fs.readFile(filePath, 'utf-8');
                    courses[courseId] = JSON.parse(data);
                    console.log(`Loaded course: ${courseId}`);
                } catch (parseError) {
                    console.error(`Error parsing course file ${file}:`, parseError);
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
            
            // Skip if either player doesn't have a position
            if (!playerA?.position || !playerB?.position) {
                console.log('Skipping collision check - missing position data');
                continue;
            }
            
            // Calculate distance between players
            const dx = playerA.position.x - playerB.position.x;
            const dz = playerA.position.z - playerB.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            
            // Log distance for debugging
            console.log(`Distance between players ${playerA.id} and ${playerB.id}: ${distance}`);
            
            // Collision radius (sum of both kart radii)
            const collisionThreshold = 2.5; // Adjusted for better detection
            
            if (distance < collisionThreshold) {
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
                
                // Update positions with strong separation
                playerA.position.x += nx * separationForce;
                playerA.position.z += nz * separationForce;
                playerB.position.x -= nx * separationForce;
                playerB.position.z -= nz * separationForce;
                
                // Calculate relative velocity
                const relativeVelocity = Math.abs((playerA.velocity || 0) - (playerB.velocity || 0));
                const velocityFactor = Math.min(Math.max(relativeVelocity, 0.3), 1.0);
                
                // Exchange velocities with dampening
                const restitution = 0.8;
                const tempVel = playerA.velocity || 0;
                playerA.velocity = (playerB.velocity || 0) * restitution;
                playerB.velocity = tempVel * restitution;
                
                // Add some sideways velocity for more dynamic collisions
                const sideForce = relativeVelocity * 0.5;
                playerA.sideVelocity = (Math.random() - 0.5) * sideForce;
                playerB.sideVelocity = (Math.random() - 0.5) * sideForce;
                
                // Create collision event data
                const collisionData = {
                    playerA_id: playerA.id,
                    playerB_id: playerB.id,
                    collisionPoint: collisionPoint,
                    intensity: velocityFactor,
                    sparkRange: Math.min(relativeVelocity * 0.8, 2.0)
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
        courseData: currentValidCourse
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
                courseData: courseToSend
            });
            
            // Log if state changed for clarity
            if (stateChanged) {
                console.log('Racing state initiated and broadcasted with course data.');
            }
        }
    });

    // Handle player state updates
    socket.on('playerUpdateState', (data) => {
        if (gameState.players[socket.id]) {
            // Update player state
            if (data.position) gameState.players[socket.id].position = data.position;
            if (data.rotation) gameState.players[socket.id].rotation = data.rotation;
            if (data.velocity !== undefined) gameState.players[socket.id].velocity = data.velocity;

            // Broadcast update to all other players
            socket.broadcast.emit('updatePlayerPosition', socket.id, data.position, data.rotation);

            // Check for collisions
            const collisions = checkCollisions(gameState);
            if (collisions) {
                // Collision handling is already implemented in checkCollisions
            }
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
        // Basic sanitization: allow letters, numbers, underscore, hyphen
        const safeBaseName = name.replace(/[^a-zA-Z0-9_\-]/g, '');
        if (!safeBaseName) {
            console.error("Invalid or empty course name received after sanitization.");
            socket.emit('editorSaveConfirm', { success: false, message: 'Invalid course name.' });
            return;
        }

        const filename = `${safeBaseName}.json`;
        const filePath = join(COURSES_DIR, filename);

        try {
            await fs.mkdir(COURSES_DIR, { recursive: true });
            await fs.writeFile(filePath, JSON.stringify(data, null, 2));
            console.log(`Successfully saved course to ${filePath}`);
            
            // Update in-memory courses object
            courses[safeBaseName] = data; 
            
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

loadCourses().then(() => {
    startServer(); 
}); 