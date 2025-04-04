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

// Game state
let gameState = {
    players: {},
    currentState: 'waiting'
};

// Socket.IO event handlers
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    gameState.players[socket.id] = {
        id: socket.id,
        connected: true,
        timestamp: Date.now()
    };

    socket.emit('gameState', gameState);

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        delete gameState.players[socket.id];
        io.emit('playerLeft', socket.id);
    });

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

async function startServer(retryCount = 0) {
    try {
        await new Promise((resolve, reject) => {
            server.listen(PORT, '0.0.0.0', () => {
                console.log(`Server running on port ${PORT}`);
                console.log('Environment:', process.env.NODE_ENV);
                resolve();
            }).on('error', (error) => {
                if (error.code === 'EADDRINUSE' && retryCount < MAX_RETRIES) {
                    console.log(`Port ${PORT} is busy, retrying in ${RETRY_DELAY}ms... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
                    server.close();
                    setTimeout(() => {
                        startServer(retryCount + 1).catch(reject);
                    }, RETRY_DELAY);
                } else {
                    reject(error);
                }
            });
        });
    } catch (error) {
        if (retryCount >= MAX_RETRIES) {
            console.error(`Failed to start server after ${MAX_RETRIES} attempts:`, error);
            process.exit(1);
        }
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