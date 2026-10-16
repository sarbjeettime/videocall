// --- WebSocket Connection (replaces Socket.IO) ---
const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
let socket = null;
let reconnectTimer = null;

function connectWebSocket() {
    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
        console.log('WebSocket connected');
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleServerMessage(data);
        } catch (e) {
            console.error('Failed to parse server message:', e);
        }
    };

    socket.onclose = () => {
        console.log('WebSocket disconnected');
        addSystemMessage('You have been disconnected from the server.');
        // Attempt reconnect after 3 seconds
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => connectWebSocket(), 3000);
    };

    socket.onerror = (err) => {
        console.error('WebSocket error:', err);
    };
}

function sendMessage_ws(type, payload) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type, ...payload }));
    }
}

function handleServerMessage(data) {
    switch (data.type) {
        case 'room_joined':
            onRoomJoined(data);
            break;
        case 'room_full':
            alert('Room is full. Please try another code.');
            break;
        case 'partner_connected':
            chatMessages.innerHTML = '';
            addSystemMessage('Partner connected! You can now chat.');
            break;
        case 'waiting_for_partner':
            // Already handled by default message
            break;
        case 'chat_message':
            addMessage(data.text, 'partner');
            break;
        case 'partner_disconnected':
            addSystemMessage('Partner disconnected.');
            break;
        case 'error':
            alert(data.message);
            break;
        case 'offer':
            onOffer(data);
            break;
        case 'answer':
            onAnswer(data);
            break;
        case 'ice_candidate':
            onIceCandidate(data);
            break;
    }
}

// --- DOM Elements ---
const homeScreen = document.getElementById('home-screen');
const chatScreen = document.getElementById('chat-screen');
const roomCodeInput = document.getElementById('room-code-input');
const joinBtn = document.getElementById('join-btn');
const randomBtn = document.getElementById('random-btn');
const displayRoomCode = document.getElementById('display-room-code');
const exitBtn = document.getElementById('exit-btn');
const chatMessages = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');

// New Control Elements
const shareScreenBtn = document.getElementById('share-screen-btn');
const switchCameraBtn = document.getElementById('switch-camera-btn');
const toggleFlashBtn = document.getElementById('toggle-flash-btn');

let currentRoomCode = '';

// Helper Functions
function showScreen(screenName) {
    if (screenName === 'home') {
        homeScreen.classList.remove('hidden');
        chatScreen.classList.add('hidden');
    } else {
        homeScreen.classList.add('hidden');
        chatScreen.classList.remove('hidden');
    }
}

function addSystemMessage(text) {
    const div = document.createElement('div');
    div.classList.add('system-message');
    div.textContent = text;
    chatMessages.appendChild(div);
    scrollToBottom();
}

function addMessage(text, type) {
    const div = document.createElement('div');
    div.classList.add('message', type);
    div.textContent = text;
    chatMessages.appendChild(div);
    scrollToBottom();
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function generateRandomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Event Listeners
randomBtn.addEventListener('click', () => {
    roomCodeInput.value = generateRandomCode();
});

joinBtn.addEventListener('click', () => {
    const code = roomCodeInput.value.trim().toUpperCase();
    if (code.length < 4) {
        alert('Please enter a room code (at least 4 characters).');
        return;
    }

    currentRoomCode = code;
    sendMessage_ws('join_room', { room_code: currentRoomCode });
});

exitBtn.addEventListener('click', () => {
    location.reload();
});

messageInput.addEventListener('input', () => {
    sendBtn.disabled = messageInput.value.trim() === '';
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !sendBtn.disabled) {
        sendChatMessage();
    }
});

sendBtn.addEventListener('click', sendChatMessage);

function sendChatMessage() {
    const text = messageInput.value.trim();
    if (text) {
        sendMessage_ws('chat_message', { room_code: currentRoomCode, text });
        addMessage(text, 'you');
        messageInput.value = '';
        sendBtn.disabled = true;
        messageInput.focus();
    }
}

// Server event handlers
function onRoomJoined(data) {
    showScreen('chat');
    displayRoomCode.textContent = data.room_code;
    chatMessages.innerHTML = '';
    addSystemMessage('Waiting for another person to join this room...');
}

// --- WebRTC Logic ---
const videoContainer = document.getElementById('video-container');
const videoWrapper = document.getElementById('video-wrapper');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const toggleVideoBtn = document.getElementById('toggle-video-btn');
const toggleAudioBtn = document.getElementById('toggle-audio-btn');

let localStream;
let screenStream;
let peerConnection;
let currentCameraDeviceId;
let isFlashOn = false;
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

toggleVideoBtn.addEventListener('click', async () => {
    if (!localStream) {
        try {
            await startVideo();
            toggleVideoBtn.textContent = 'Stop Video';
            toggleVideoBtn.classList.add('active');
            toggleAudioBtn.disabled = false;
            createOffer();
        } catch (err) {
            console.error('Error accessing media devices:', err);
            alert('Could not access camera/microphone.');
        }
    } else {
        stopVideo();
        toggleVideoBtn.textContent = 'Start Video';
        toggleVideoBtn.classList.remove('active');
        toggleAudioBtn.disabled = true;
    }
});

toggleAudioBtn.addEventListener('click', () => {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            toggleAudioBtn.textContent = audioTrack.enabled ? 'Mute' : 'Unmute';
            toggleAudioBtn.classList.toggle('active', !audioTrack.enabled);
        }
    }
});

shareScreenBtn.addEventListener('click', async () => {
    if (!screenStream) {
        try {
            await startScreenShare();
        } catch (err) {
            console.error('Error sharing screen:', err);
        }
    } else {
        stopScreenShare();
    }
});

switchCameraBtn.addEventListener('click', async () => {
    await switchCamera();
});

toggleFlashBtn.addEventListener('click', async () => {
    await toggleFlashlight();
});

async function startVideo() {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    videoWrapper.classList.remove('hidden');
    shareScreenBtn.disabled = false;
    await checkCameraCapabilities();
}

function stopVideo() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    videoWrapper.classList.add('hidden');

    shareScreenBtn.disabled = true;
    shareScreenBtn.textContent = 'Share Screen';
    shareScreenBtn.classList.remove('active');
    switchCameraBtn.classList.add('hidden');
    toggleFlashBtn.classList.add('hidden');
}

function createPeerConnection() {
    if (peerConnection) return;

    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendMessage_ws('ice_candidate', {
                room_code: currentRoomCode,
                candidate: event.candidate
            });
        }
    };

    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
    };

    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }
}

async function createOffer() {
    createPeerConnection();
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sendMessage_ws('offer', {
        room_code: currentRoomCode,
        offer: offer
    });
}

async function createAnswer(offer) {
    createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    sendMessage_ws('answer', {
        room_code: currentRoomCode,
        answer: answer
    });
}

async function handleAnswer(answer) {
    if (!peerConnection) return;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
}

async function handleCandidate(candidate) {
    if (!peerConnection) return;
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
}

// WebRTC server event handlers
async function onOffer(data) {
    if (!localStream) {
        addSystemMessage('Partner started video. Click "Start Video" to join.');
        return;
    }
    await createAnswer(data.offer);
}

async function onAnswer(data) {
    await handleAnswer(data.answer);
}

async function onIceCandidate(data) {
    await handleCandidate(data.candidate);
}

// --- Screen Share & Camera ---

async function startScreenShare() {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];

        if (peerConnection) {
            const senders = peerConnection.getSenders();
            const videoSender = senders.find(s => s.track.kind === 'video');
            if (videoSender) {
                videoSender.replaceTrack(screenTrack);
            }
        }

        localVideo.srcObject = screenStream;
        shareScreenBtn.textContent = 'Stop Share';
        shareScreenBtn.classList.add('active');

        screenTrack.onended = () => {
            stopScreenShare();
        };

    } catch (err) {
        console.error("Error starting screen share:", err);
    }
}

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }

    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (peerConnection) {
            const senders = peerConnection.getSenders();
            const videoSender = senders.find(s => s.track.kind === 'video');
            if (videoSender) {
                videoSender.replaceTrack(videoTrack);
            }
        }
        localVideo.srcObject = localStream;
    }

    shareScreenBtn.textContent = 'Share Screen';
    shareScreenBtn.classList.remove('active');
}

async function checkCameraCapabilities() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');

    if (videoDevices.length > 1) {
        switchCameraBtn.classList.remove('hidden');
    }

    const track = localStream.getVideoTracks()[0];
    const capabilities = track.getCapabilities();

    if (capabilities.torch) {
        toggleFlashBtn.classList.remove('hidden');
    }
}

async function switchCamera() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');

    if (videoDevices.length < 2) return;

    const currentTrack = localStream.getVideoTracks()[0];
    const currentLabel = currentTrack.label;
    const currentIndex = videoDevices.findIndex(d => d.label === currentLabel);

    const nextIndex = (currentIndex + 1) % videoDevices.length;
    const nextDevice = videoDevices[nextIndex];

    const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: nextDevice.deviceId } },
        audio: true
    });

    currentTrack.stop();

    const newVideoTrack = newStream.getVideoTracks()[0];

    localStream.removeTrack(currentTrack);
    localStream.addTrack(newVideoTrack);

    localVideo.srcObject = localStream;

    if (peerConnection) {
        const senders = peerConnection.getSenders();
        const videoSender = senders.find(s => s.track.kind === 'video');
        if (videoSender) {
            videoSender.replaceTrack(newVideoTrack);
        }
    }

    const capabilities = newVideoTrack.getCapabilities();
    if (capabilities.torch) {
        toggleFlashBtn.classList.remove('hidden');
    } else {
        toggleFlashBtn.classList.add('hidden');
    }
}

async function toggleFlashlight() {
    const track = localStream.getVideoTracks()[0];
    const capabilities = track.getCapabilities();

    if (capabilities.torch) {
        isFlashOn = !isFlashOn;
        await track.applyConstraints({
            advanced: [{ torch: isFlashOn }]
        });
        toggleFlashBtn.classList.toggle('active', isFlashOn);
    }
}

// --- Initialize ---
connectWebSocket();
