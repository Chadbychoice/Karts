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

// Configure Socket.IO for serverless environment
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "OPTIONS"],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    path: '/socket.io/',
    serveClient: false,
    pingTimeout: 10000,
    pingInterval: 5000,
    upgradeTimeout: 5000,
    maxHttpBufferSize: 1e6
});

// Basic middleware
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok',
        timestamp: new Date().toISOString()
    });
});

// Simplified game state for serverless
let gameState = {
    players: {},
    currentState: 'waiting'
};

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    // Add player to game state
    gameState.players[socket.id] = {
        id: socket.id,
        connected: true,
        timestamp: Date.now()
    };

    // Send current state
    socket.emit('gameState', gameState);

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        delete gameState.players[socket.id];
        io.emit('playerLeft', socket.id);
    });

    // Handle player updates
    socket.on('playerUpdate', (data) => {
        if (gameState.players[socket.id]) {
            gameState.players[socket.id] = {
                ...gameState.players[socket.id],
                ...data,
                timestamp: Date.now()
            };
            socket.broadcast.emit('playerUpdated', socket.id, data);
        }
    });
});

// Error handling
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Export for serverless
export default server; 