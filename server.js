const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// In-memory room management
// roomCode -> Set of socket IDs
const rooms = new Map();

// Helper to get room size
const getRoomSize = (roomCode) => {
    const room = rooms.get(roomCode);
    return room ? room.size : 0;
};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join_room', ({ roomCode }) => {
        // Basic validation
        if (!roomCode || typeof roomCode !== 'string') {
            socket.emit('error', 'Invalid room code');
            return;
        }

        const size = getRoomSize(roomCode);

        if (size >= 2) {
            socket.emit('room_full');
            return;
        }

        // Join the room
        socket.join(roomCode);

        if (!rooms.has(roomCode)) {
            rooms.set(roomCode, new Set());
        }
        rooms.get(roomCode).add(socket.id);

        // Store room code on socket for easier disconnect handling
        socket.roomCode = roomCode;

        socket.emit('room_joined', { roomCode });

        // If room has 2 people now, notify both
        if (rooms.get(roomCode).size === 2) {
            io.to(roomCode).emit('partner_connected');
        } else {
            // Just one person (the current user), waiting...
            socket.emit('waiting_for_partner');
        }
    });

    socket.on('chat_message', ({ roomCode, text }) => {
        if (!roomCode || !text) return;

        // Broadcast to everyone else in the room
        socket.to(roomCode).emit('chat_message', {
            text: text, // In a real app, sanitize this!
            sender: 'partner'
        });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const roomCode = socket.roomCode;

        if (roomCode && rooms.has(roomCode)) {
            const room = rooms.get(roomCode);
            room.delete(socket.id);

            // Notify the other person if they are still there
            if (room.size > 0) {
                socket.to(roomCode).emit('partner_disconnected');
            } else {
                // Clean up empty room
                rooms.delete(roomCode);
            }
        }
    });

    // WebRTC Signaling
    socket.on('offer', (payload) => {
        socket.to(payload.roomCode).emit('offer', payload);
    });

    socket.on('answer', (payload) => {
        socket.to(payload.roomCode).emit('answer', payload);
    });

    socket.on('ice-candidate', (payload) => {
        socket.to(payload.roomCode).emit('ice-candidate', payload);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
