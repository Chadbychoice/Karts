import * as THREE from 'three'; // Use the import map
// Import addons directly from unpkg
import { EffectComposer } from './jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './jsm/postprocessing/OutputPass.js';
import { ShaderPass } from './jsm/postprocessing/ShaderPass.js';
// Import required shaders
import { CopyShader } from './jsm/shaders/CopyShader.js';
import { LuminosityHighPassShader } from './jsm/shaders/LuminosityHighPassShader.js';
import { OutputShader } from './jsm/shaders/OutputShader.js';

// --- Basic Setup ---
// Get the WebSocket URL based on environment
const WEBSOCKET_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000'
    : window.location.origin;

console.log('Connecting to WebSocket server at:', WEBSOCKET_URL);

// Configure Socket.IO client
const socket = io(WEBSOCKET_URL, {
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
    upgrade: true,
    rememberUpgrade: true,
    timeout: 20000,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    autoConnect: true,
    forceNew: true,
    withCredentials: true
});

// Add connection event handlers
socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    updateConnectionStatus('error', `Connection error: ${error.message}`);
    // Try to reconnect with polling if WebSocket fails
    if (socket.io.opts.transports.includes('websocket')) {
        console.log('Retrying with polling transport...');
        socket.io.opts.transports = ['polling'];
    }
});

socket.on('connect', () => {
    console.log('Connected to server');
    updateConnectionStatus('connected');
    // If connected with polling, try to upgrade to WebSocket
    if (!socket.io.opts.transports.includes('websocket')) {
        console.log('Attempting to upgrade to WebSocket...');
        socket.io.opts.transports = ['websocket', 'polling'];
    }
});

socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
    updateConnectionStatus('disconnected', `Disconnected: ${reason}`);
});

socket.on('reconnect_attempt', (attemptNumber) => {
    console.log('Attempting to reconnect:', attemptNumber);
    updateConnectionStatus('reconnecting', `Reconnection attempt ${attemptNumber}`);
});

// Helper function to update connection status
function updateConnectionStatus(status, message = '') {
    console.log('Connection status:', status, message);
    // You can implement UI feedback here
}

let scene = new THREE.Scene();
let camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.LinearToneMapping; // Change tone mapping
renderer.toneMappingExposure = 0.7; // Lower exposure slightly for Linear
// renderer.setClearColor(0x111111, 1); // <<< Remove this
// renderer.autoClear = true; // Ensure default behavior - Remove this too
renderer.setSize(window.innerWidth, window.innerHeight);
// Ensure renderer preserves pixelated style if desired
renderer.setPixelRatio(window.devicePixelRatio); // Adjust for high DPI screens if needed
// renderer.domElement.style.imageRendering = 'pixelated'; // CSS approach
document.getElementById('game-container').appendChild(renderer.domElement); // <<< Add this

let composer; // Declare composer globally

// --- Game State ---
let currentGameState = 'character-selection'; // Renamed from gameState to avoid conflict
let players = {}; // Store player data { id: { position, rotation, characterId, ... } }
let localPlayerId = null;
let raceInitialized = false; // Track if race scene is set up
let isSceneInitialized = false; // <<< ADD Declaration for this flag

// Global variable to track which course to load locally
let localSelectedCourseId = 1;

// --- DOM Elements ---
const characterSelectionOverlay = document.getElementById('character-selection');
const waitingScreenOverlay = document.getElementById('waiting-screen');
const characterGrid = document.getElementById('character-grid');
const selectedCharacterNameElement = document.getElementById('selected-character-name');

// --- Character Data ---
const characters = {
    1: { name: "Turbo Hank", baseSpritePath: "/Sprites/characters/1" },
    2: { name: "Stella Vroom", baseSpritePath: "/Sprites/characters/2" },
    3: { name: "Bongo Blitz", baseSpritePath: "/Sprites/characters/3" },
    4: { name: "Krash Krawl", baseSpritePath: "/Sprites/characters/4" },
    5: { name: "Kara Krawl", baseSpritePath: "/Sprites/characters/5" },
    6: { name: "Freddy", baseSpritePath: "/Sprites/characters/6" },
    7: { name: "Laurette", baseSpritePath: "/Sprites/characters/7" },
};

const characterSpriteAngles = ['f', 'fr', 'r', 'br', 'b', 'bl', 'l', 'fl'];
// --- Texture Loading ---
const textureLoader = new THREE.TextureLoader();
const characterTextures = {}; // Cache for loaded textures { 'charId_angle': THREE.Texture }
const flameTextures = [];
const textures = {}; // <<< ADD Global object for course textures
let particlesMaterial;

function preloadAssets() {
    console.log("Preloading assets...");
    const assetsToLoad = [
        { key: '/textures/grass.png', type: 'texture' },
        { key: '/textures/mud.png', type: 'texture' },
        { key: '/textures/road.png', type: 'texture' },
        { key: '/textures/startfinishline.png', type: 'texture' },
        { key: '/textures/stripedline.png', type: 'texture' },
        { key: '/textures/stripedlineflip.png', type: 'texture' } // <<< Add FLIPPED striped line
        // Add other necessary course textures here if needed later
    ];

    let assetsLoaded = 0;
    // Preload spark textures
    const sparkTexturePaths = [];
    for (let i = 1; i <= 5; i++) {
        sparkTexturePaths.push(`/Sprites/sparks/spark${i}.png`);
    }

    const totalAssets = assetsToLoad.length + 7 + sparkTexturePaths.length; // Update total

    const checkAllAssetsLoaded = () => {
        assetsLoaded++;
        console.log(`Assets loaded: ${assetsLoaded}/${totalAssets}`);
        if (assetsLoaded === totalAssets) {
            console.log("All essential assets preloaded.");
            // You could potentially enable UI or trigger something here
        }
    };

    // Preload course textures
    assetsToLoad.forEach(asset => {
        if (asset.type === 'texture') {
            textures[asset.key] = textureLoader.load(
                asset.key,
                (tex) => { // onLoad
                    tex.magFilter = THREE.NearestFilter;
                    tex.minFilter = THREE.NearestFilter;
                    console.log(`Loaded course texture: ${asset.key}`);
                    checkAllAssetsLoaded();
                },
                undefined, // onProgress
                (err) => { // onError
                    console.error(`Failed to load course texture: ${asset.key}`, err);
                    checkAllAssetsLoaded(); // Still count it as "handled"
                }
            );
        }
        // Add handlers for other asset types (models, sounds) here later
    });

    // Preload spark textures into the global textures object
    sparkTexturePaths.forEach(path => {
        textures[path] = textureLoader.load(
            path,
            (tex) => { tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; checkAllAssetsLoaded(); },
            undefined,
            (err) => { console.error(`Failed to load spark texture: ${path}`, err); checkAllAssetsLoaded(); }
        );
    });

    // Preload flame textures
    for (let i = 1; i <= 7; i++) {
        const path = `/Sprites/flame/flame${i}.png`;
        flameTextures[i - 1] = textureLoader.load(
            path,
            (tex) => {
                tex.magFilter = THREE.NearestFilter;
                tex.minFilter = THREE.NearestFilter;
                checkAllAssetsLoaded(); // <<< Call checker on flame load
            },
            undefined,
            (err) => {
                console.error(`Failed to load flame texture: ${path}`, err);
                checkAllAssetsLoaded(); // <<< Call checker on flame error
            }
        );
    }

    // Create dust particle material
    particlesMaterial = new THREE.PointsMaterial({
         color: 0xffffff,
         size: 0.08,
         depthTest: false,  // Don't check depth buffer
         depthWrite: false, // Don't write to depth buffer
         transparent: true // Ensure transparency works correctly
    });
}

function getCharacterTexture(characterId, angle = 'b') {
    const cacheKey = `${characterId}_${angle}`;
    if (!characterTextures[cacheKey]) {
        const characterData = characters[characterId];
        if (!characterData) {
            console.error(`Invalid characterId: ${characterId}`);
            // Return a placeholder or default texture?
            return null; // Or create a default colored texture
        }
        const texturePath = `${characterData.baseSpritePath}${angle}.png`;
        // console.log(`Loading texture: ${texturePath}`); // Reduce console spam
        characterTextures[cacheKey] = textureLoader.load(
            texturePath,
            (texture) => { // onLoad
                texture.magFilter = THREE.NearestFilter;
                texture.minFilter = THREE.NearestFilter; // Use NearestFilter for pixelated look
                // console.log(`Texture loaded: ${texturePath}`);
            },
            undefined, // onProgress (optional)
            (err) => { // onError
                console.error(`Failed to load texture: ${texturePath}`, err);
                // Maybe mark this texture as failed in the cache
                characterTextures[cacheKey] = null; // Or a default error texture
            }
        );
    }
     // Handle case where texture failed to load
    return characterTextures[cacheKey] || null; // Return null or a default if loading failed
}

// Preload default textures (e.g., back view) for smoother start?
// Object.keys(characters).forEach(id => getCharacterTexture(id, 'b'));


let selectedCharacterIndex = 0;
let characterIds; // Declare globally

// --- Character Selection Logic ---
function setupCharacterSelection() {
    console.log("Running setupCharacterSelection..."); // Log: Function called
    const characterGrid = document.getElementById('character-grid');
    console.log("Character grid element:", characterGrid); // Log: Grid element found?
    if (!characterGrid) { console.error("Character grid DIV not found!"); return; } // Early exit if grid missing
    characterGrid.innerHTML = ''; // Clear previous slots
    console.log("Characters data:", characters); // Log: Characters object
    characterIds = Object.keys(characters).map(Number); // Assign to global variable (remove const)
    console.log("Character IDs:", characterIds); // Log: IDs array
    characterIds.forEach((id, index) => {
        console.log(`[Loop ${index}] Processing character ID: ${id}`); // Log: Loop iteration
        const char = characters[id];
        console.log(`[Loop ${index}] Character data:`, char);
        if (!char) {
            console.error(`[Loop ${index}] Character data not found for ID: ${id}`);
            return; // Skip this iteration if character data is missing
        }
        const slot = document.createElement('div');
        slot.classList.add('character-slot');
        slot.dataset.characterId = id;
        slot.dataset.index = index;
        console.log(`[Loop ${index}] Created slot:`, slot);

        const preview = document.createElement('img'); // Using img for simplicity now
        preview.classList.add('character-preview');
        const previewTexturePath = `${char.baseSpritePath}f.png`;
        console.log(`[Loop ${index}] Preview image path:`, previewTexturePath);
        preview.src = previewTexturePath;
        preview.alt = char.name;
        preview.onerror = () => { // Handle missing images gracefully
            console.error(`[Loop ${index}] ERROR loading preview image: ${preview.src}`); // Log error specifically
            preview.alt = `${char.name} (Image Missing)`;
           preview.style.backgroundColor = '#555';
           preview.style.border = '1px dashed white';
        };
        console.log(`[Loop ${index}] Created preview image element:`, preview);
        slot.appendChild(preview);

        characterGrid.appendChild(slot);
        console.log(`[Loop ${index}] Appended slot to characterGrid.`); // Log: Append confirmation

        slot.addEventListener('click', () => {
            selectCharacter(index);
        });
    });
    console.log("Finished character selection loop."); // Log: Loop finished
    selectCharacter(selectedCharacterIndex); // Ensure initial selection highlight
    // updateCharacterSelectionHighlight(); // Called by selectCharacter
}

function updateCharacterSelectionHighlight() {
    const slots = characterGrid.querySelectorAll('.character-slot');
    slots.forEach((slot, index) => {
        const imgElement = slot.querySelector('.character-preview');
        if (index === selectedCharacterIndex) {
            slot.classList.add('selected');
            const charId = slot.dataset.characterId;
            selectedCharacterNameElement.textContent = characters[charId].name;
            startCharacterRotation(imgElement, characters[charId]);
        } else {
            slot.classList.remove('selected');
            stopCharacterRotation(imgElement); // Pass the specific img element to stop its rotation
             // Reset non-selected to front view
             const charId = slot.dataset.characterId;
             if (characters[charId] && imgElement) {
                 imgElement.src = `${characters[charId].baseSpritePath}f.png`;
                 imgElement.onerror = () => { imgElement.style.backgroundColor = '#555'; }; // Reset error state too
             }
        }
    });
}

let rotationIntervals = {}; // Store intervals per image element to prevent conflicts
function startCharacterRotation(imgElement, characterData) {
    // Use a unique key for the interval, e.g., the image src or character ID
    const intervalKey = characterData.baseSpritePath;
    stopCharacterRotation(imgElement, intervalKey); // Stop existing interval for this element

    let currentAngleIndex = 0;
    imgElement.src = `${characterData.baseSpritePath}${characterSpriteAngles[currentAngleIndex]}.png`;

    rotationIntervals[intervalKey] = setInterval(() => {
        currentAngleIndex = (currentAngleIndex + 1) % characterSpriteAngles.length;
        const nextSrc = `${characterData.baseSpritePath}${characterSpriteAngles[currentAngleIndex]}.png`;
        imgElement.src = nextSrc;
        imgElement.onerror = () => {
             console.warn(`Sprite not found during rotation: ${imgElement.src}`);
             stopCharacterRotation(imgElement, intervalKey);
             imgElement.style.backgroundColor = '#555'; // Show error state
        };
    }, 150); // Adjust speed of rotation
}

function stopCharacterRotation(imgElement, key) {
    // If a specific key is provided (or derivable from imgElement), clear that interval
    const intervalKey = key || (imgElement ? imgElement.src.substring(0, imgElement.src.lastIndexOf('/') + 1) : null); // Attempt to derive key
     if (intervalKey && rotationIntervals[intervalKey]) {
        clearInterval(rotationIntervals[intervalKey]);
        delete rotationIntervals[intervalKey];
    }
    // Clear all intervals if no specific one is targeted (e.g., when leaving selection screen)
     if (!key && !imgElement) {
         Object.values(rotationIntervals).forEach(clearInterval);
         rotationIntervals = {};
     }
}


function selectCharacter(index) {
    selectedCharacterIndex = index;
    updateCharacterSelectionHighlight();
}

function handleCharacterSelectionInput(event) {
    let newIndex = selectedCharacterIndex;
    switch (event.key) {
        case 'ArrowLeft':
        case 'a':
            newIndex = (selectedCharacterIndex - 1 + characterIds.length) % characterIds.length;
            break;
        case 'ArrowRight':
        case 'd':
            newIndex = (selectedCharacterIndex + 1) % characterIds.length;
            break;
        // Add Up/Down if grid layout changes (e.g., 2 rows)
        // case 'ArrowUp': case 'w': ...
        // case 'ArrowDown': case 's': ...
        case 'Enter':
        case ' ': // Spacebar
            confirmCharacterSelection();
            break;
    }
    if (newIndex !== selectedCharacterIndex) {
        selectCharacter(newIndex);
    }
}

function confirmCharacterSelection() {
    const selectedId = characterIds[selectedCharacterIndex];
    console.log(`Character selected: ${selectedId} (${characters[selectedId].name})`);
    socket.emit('playerSelectCharacter', selectedId);
    characterSelectionOverlay.style.display = 'none'; // Hide selection screen
    stopCharacterRotation(null, null); // Stop all rotation animations when confirmed
    document.removeEventListener('keydown', handleCharacterSelectionInput);
}

// --- Socket.IO Event Handlers ---
socket.on('connect', () => {
    console.log('Connected to server!', socket.id);
    localPlayerId = socket.id; // Store our own ID
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    currentGameState = 'disconnected'; // Update local state
    raceInitialized = false;
    scene.clear(); // Basic cleanup
    players = {};
    playerObjects = {}; // Clear visual objects
    alert("Disconnected from server!");
    // Might need to force a page reload or show a reconnect button
    location.reload(); // Simple way to reset
});

socket.on('updateGameState', (newGameState, serverPlayers, levelData) => {
    console.log("DEBUG: socket.on('updateGameState') received!"); // Log: Handler entry
    console.log("DEBUG: Received newGameState:", newGameState);
    const oldGameState = currentGameState;
    currentGameState = newGameState;
    players = serverPlayers;

    characterSelectionOverlay.style.display = (currentGameState === 'character-selection') ? 'flex' : 'none';
    waitingScreenOverlay.style.display = (currentGameState === 'waiting') ? 'flex' : 'none';

    if (currentGameState === 'character-selection') {
        console.log("DEBUG: Entered 'character-selection' block."); // Log: Correct block entered?
        if (raceInitialized) {
             cleanupRaceScene();
        }
        setupCharacterSelection();
        document.addEventListener('keydown', handleCharacterSelectionInput);
    } else {
        console.log("DEBUG: Entered ELSE block (state is NOT 'character-selection')."); // Log: Incorrect block entered?
        document.removeEventListener('keydown', handleCharacterSelectionInput);
         stopCharacterRotation(null, null);
    }

    if (currentGameState === 'racing') {
        // Initialize the race visuals ONLY if not already initialized
        if (!raceInitialized) {
            initializeRaceScene(players, levelData);
            raceInitialized = true;
             // Start the animation loop ONLY when the race starts
             if (!animationFrameId) {
                 animate();
             }
        }
        // Ensure player objects are up-to-date even if race was already initialized
        // (e.g., handling players joining/leaving during spectator mode before race starts)
        updatePlayerObjects();
    } else {
         // If we are NOT racing, ensure the animation loop is stopped
         // and the scene is cleaned up if it was initialized
         if (raceInitialized) {
             cleanupRaceScene();
         }
    }

    // General update for player objects based on received data, relevant for spectator view too
     if (currentGameState === 'waiting') {
         // If waiting, we might still want to see the current race state
          if (!raceInitialized) {
            initializeRaceScene(players, levelData); // Initialize scene to view ongoing race
            raceInitialized = true;
            if (!animationFrameId) animate(); // Start loop for spectator view
         }
         updatePlayerObjects(); // Update visuals for spectator
     }

});

socket.on('playerJoined', (playerId, playerData) => {
    console.log('Player joined:', playerId, playerData);
    players[playerId] = playerData; // Add to local cache
    // Add visual object only if the race scene is active (racing or waiting/spectating)
    if (raceInitialized) {
         addPlayerObject(playerId, playerData);
    }
});

socket.on('playerLeft', (playerId) => {
    console.log('Player left:', playerId);
    removePlayerObject(playerId); // Remove visual object if it exists
    delete players[playerId]; // Remove from local cache
});

socket.on('updatePlayerPosition', (playerId, position, rotation) => {
    if (players[playerId]) {
        // Lerp position for remote players for smoothness
        if (playerId !== localPlayerId && playerObjects[playerId] && position) {
             // Store target position if not already doing so
             if (!playerObjects[playerId].userData) playerObjects[playerId].userData = {};
             // Remote players get exact Y + offset
             playerObjects[playerId].userData.targetPosition = new THREE.Vector3(position.x, position.y + playerSpriteScale / 2, position.z); 
        } else if (playerId === localPlayerId && position) {
             // Update local player position, BUT KEEP Y POSITION LOCAL
             players[playerId].position.x = position.x;
             players[playerId].position.z = position.z;
             // Do NOT update players[playerId].position.y from server
             updatePlayerObjectTransform(playerId, players[playerId].position, rotation); // Update visual immediately
        }

        // Always update rotation data (no lerping needed for this typically)
        if (rotation) {
             players[playerId].rotation = rotation;
             // Visual update for rotation happens via angle calculation now
        }
    } else {
        console.warn("Received position update for unknown player:", playerId);
        // Optionally request full player data from server if needed
        // socket.emit('requestPlayerData', playerId);
    }
});

// Listener for effect state updates from the server
socket.on('updatePlayerEffectsState', (playerId, effectsState) => {
    if (players[playerId] && playerId !== localPlayerId) {
        // Update the remote player's state in our local `players` object
        if (effectsState.isDrifting !== undefined) {
            players[playerId].isDrifting = effectsState.isDrifting;
        }
        if (effectsState.driftDirection !== undefined) {
            players[playerId].driftDirection = effectsState.driftDirection;
        }
        if (effectsState.isBoosting !== undefined) {
            players[playerId].isBoosting = effectsState.isBoosting;
            // We might need to manually manage a boost end time for remote players
            // if the server only sends the start event reliably.
            // For now, just use the boolean flag.
        }
        if (effectsState.boostLevel !== undefined) {
            players[playerId].boostLevel = effectsState.boostLevel;
        }
    }
});

// --- Three.js Scene Objects ---
let playerObjects = {}; // { playerId: THREE.Sprite }
const playerSpriteScale = 2;
let playerVisuals = {}; // Store visual components { sprite, boostFlame, driftParticles }

function addPlayerObject(playerId, playerData) {
    if (!playerObjects[playerId] && playerData.characterId) {
        const characterId = playerData.characterId;
        const initialAngleCode = 'b';
        const texture = getCharacterTexture(characterId, initialAngleCode);

        if (!texture) {
             console.error(`Cannot create sprite for player ${playerId}, texture not loaded/failed for char ${characterId}`);
             return;
        }

        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            alphaTest: 0.1,
        });

        const sprite = new THREE.Sprite(material);
        sprite.scale.set(playerSpriteScale, playerSpriteScale, playerSpriteScale);
        sprite.userData = { characterId: characterId, currentAngleCode: initialAngleCode };
        playerObjects[playerId] = sprite; // Keep reference to main sprite for positioning

        // Set initial sprite position
        if (playerData.position) {
            sprite.position.set(playerData.position.x, playerData.position.y + playerSpriteScale / 2, playerData.position.z);
        } else {
             sprite.position.set(0, playerSpriteScale / 2, 0);
             console.warn(`Player ${playerId} created without initial position.`);
        }
        scene.add(sprite);
        console.log(`Added player sprite for: ${playerId} with char ${characterId}`);

        // --- Create Boost Flame Sprite (Added to Scene directly) ---
        const boostMaterial = new THREE.SpriteMaterial({
            map: flameTextures[0],
            transparent: true,
            alphaTest: 0.1,
            depthTest: false, // Don't check depth buffer
            depthWrite: false // Don't write to depth buffer
        });
        const boostFlame = new THREE.Sprite(boostMaterial);
        boostFlame.scale.set(1.0, 1.0, 1.0); // Scale adjusted previously
        // Initial position will be set in the first updateBoostFlame call
        boostFlame.position.set(0, 0.01, 0); // Set Y low initially
        boostFlame.visible = false;
        // boostFlame.renderOrder = 1; // Removed, depthTest:false handles layering
        scene.add(boostFlame); // Add flame directly to the scene

        // --- Create Drift Particles (Added to Scene directly) ---
        const particleCount = 40; // Increased count
        const particlesGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3); // Adjusted array size
        particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const driftParticles = new THREE.Points(particlesGeometry, particlesMaterial);
        // Set initial position near player, low Y. Exact position updated in updateDriftParticles
        driftParticles.position.copy(sprite.position);
        driftParticles.position.y = 0.05; // Initial low Y
        driftParticles.visible = false;
        // // driftParticles.renderOrder = 1; // Not needed if material has depthTest: false
        scene.add(driftParticles); // ADDED: Add particles directly to the scene

        // Store visual components
        playerVisuals[playerId] = { sprite, boostFlame, driftParticles };

        updatePlayerSpriteAngle(playerId, sprite, playerData);
    } else if (!playerData.characterId) {
         console.warn(`Player ${playerId} has no characterId, cannot create sprite.`);
    }
}

function removePlayerObject(playerId) {
    if (playerVisuals[playerId]) {
        const { sprite, boostFlame, driftParticles } = playerVisuals[playerId];

        scene.remove(sprite); // Removing parent sprite
        scene.remove(boostFlame); // Remove flame from scene explicitly
        scene.remove(driftParticles); // ADDED: Remove particles from scene explicitly

        // Dispose materials/geometries
        if (sprite.material) sprite.material.dispose();
        if (boostFlame.material) boostFlame.material.dispose();
        if (driftParticles.geometry) driftParticles.geometry.dispose();
        // Particle material (particlesMaterial) is shared, don't dispose here unless it's the last user

        delete playerObjects[playerId];
        delete playerVisuals[playerId];
        console.log("Removed player object and visuals for:", playerId);
    } else if (playerObjects[playerId]) { // Fallback if only sprite exists
         const sprite = playerObjects[playerId];
         scene.remove(sprite);
         if (sprite.material) sprite.material.dispose();
         delete playerObjects[playerId];
         console.log("Removed player object (no visuals found) for:", playerId);
    }
}

function updatePlayerObjectTransform(playerId, position, rotation) {
    const playerObject = playerObjects[playerId];
    if (playerObject && position) {
        // For local player, update position directly.
        // For remote players, this is handled by lerping in the animate loop.
         if (playerId === localPlayerId) {
             playerObject.position.set(position.x, position.y + playerSpriteScale / 2, position.z);
         }
        // Rotation data is stored in `players[playerId].rotation`
        // The visual update based on rotation happens in `updatePlayerSpriteAngle`
    }
}

// --- Sprite Angle Calculation ---
const forwardVector = new THREE.Vector3(0, 0, -1); // Base forward vector in Three.js convention (negative Z)
const cameraForward = new THREE.Vector3();
const playerForward = new THREE.Vector3();
// const flatPlayerPos = new THREE.Vector3(); // Not needed
// const flatCameraPos = new THREE.Vector3(); // Not needed
// const vecToPlayer = new THREE.Vector3(); // Not needed

function calculateSpriteAngleIndex(sprite, playerData) {
    if (!playerData || !playerData.rotation) return 4; // Default to 'b' (index 4) if no rotation data

    const playerRotationY = playerData.rotation.y || 0;

    // 1. Get player's world forward direction (on XZ plane)
    // Apply rotation to the base forward vector
    playerForward.copy(forwardVector).applyAxisAngle(THREE.Object3D.DEFAULT_UP, playerRotationY).normalize();

    // 2. Get camera's world forward direction (on XZ plane)
    camera.getWorldDirection(cameraForward);
    cameraForward.y = 0; // Project onto XZ plane
    cameraForward.normalize();

    // 3. Calculate angle from camera's view direction to player's facing direction
    // We use atan2 for a signed angle in [-PI, PI]
    // atan2(cross.y, dot) gives the angle from vector1 to vector2
    const angle = Math.atan2(
        cameraForward.x * playerForward.z - cameraForward.z * playerForward.x, // Cross product's Y component (cameraForward x playerForward)
        cameraForward.x * playerForward.x + cameraForward.z * playerForward.z  // Dot product (cameraForward . playerForward)
    );

    // 4. Map the angle to the 8 sprite indices [0..7] corresponding to ['f', 'fr', 'r', 'br', 'b', 'bl', 'l', 'fl']
    const segment = Math.PI / 4.0; // 45 degrees = 2PI / 8
    const halfSegment = segment / 2.0;

    // Normalize angle to [0, 2*PI) and add offset for correct segment calculation
    // We add PI/8 (half segment) so that the segment boundaries align correctly
    // e.g., angle 0 should fall into the middle of the 'f' segment
    const normalizedAngle = (angle + 2 * Math.PI) % (2 * Math.PI);

    // Floor division by segment size after adding half-segment offset maps angle to index
    let temp_index = Math.floor((normalizedAngle + halfSegment) / segment);
    temp_index = temp_index % 8; // Ensure index is within [0, 7]
    // index = (index + 4) % 8; // REMOVE previous offset logic

    // Map the calculated segment index (counter-clockwise from camera forward)
    // to the desired sprite array index based on visual expectation.
    const indexMapping = [4, 3, 2, 1, 0, 7, 6, 5]; // temp_index -> final_index
    const final_index = indexMapping[temp_index];

    return final_index;
}

// --- Input Handling ---
const keyStates = {}; // Keep track of pressed keys
let leftTurnStartTime = 0;
let rightTurnStartTime = 0;
const TURN_SPRITE_DELAY = 500; // Milliseconds to hold turn before sprite changes (0.5 seconds)

// Drift State
let localPlayerDriftState = { state: 'none', direction: 0, startTime: 0, hopEndTime: 0, miniTurboLevel: 0, currentSidewaysAdjustment: 0 };

window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (!keyStates[key]) { // Keydown event fires repeatedly, only trigger on first press
        keyStates[key] = true;
        const now = Date.now();
        if (key === 'a' || key === 'arrowleft') {
            leftTurnStartTime = now;
            rightTurnStartTime = 0;
        } else if (key === 'd' || key === 'arrowright') {
            rightTurnStartTime = now;
            leftTurnStartTime = 0;
        } else if (key === 'shift') {
             // Check if turning when hop starts
             const turningLeft = keyStates['a'] || keyStates['arrowleft'];
             const turningRight = keyStates['d'] || keyStates['arrowright'];

             if (turningLeft || turningRight) {
                 // Initiate Hop/Drift only if turning
                 localPlayerDriftState.state = 'hopping';
                 localPlayerDriftState.startTime = now;
                 localPlayerDriftState.direction = turningLeft ? -1 : 1;
                 localPlayerDriftState.miniTurboLevel = 0; // Reset turbo level on new drift
                 // Emit drift start state
                 socket.emit('playerDriftStateChange', true, localPlayerDriftState.direction);
             }
        }
    }

    // --- Local Course Switching --- 
    if (event.key === '1') {
         localSelectedCourseId = 1;
         console.log("Selected Course 1 (Press 'R' to reload)");
    } else if (event.key === '2') {
         localSelectedCourseId = 2;
         console.log("Selected Course 2 (Press 'R' to reload)");
    } else if (event.key.toLowerCase() === 'r') {
         console.log("Reloading scene with Course:", localSelectedCourseId);
         // Simulate receiving a minimal game state to trigger reload
         // In a real scenario, you might rejoin or get a full update
         const fakeGameState = { 
             state: 'racing', // Assume racing state for simplicity
             players: { ...players }, // Pass current player data
             race: { courseId: localSelectedCourseId } // Tell init which course *we* want
         };
         handleGameStateUpdate(fakeGameState);
    }
});
window.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    keyStates[key] = false;
    if (key === 'a' || key === 'arrowleft') {
        leftTurnStartTime = 0; // Reset start time on release
    } else if (key === 'd' || key === 'arrowright') {
        rightTurnStartTime = 0; // Reset start time on release
    } else if (key === 'shift') {
         if (localPlayerDriftState.state === 'driftingLeft' || localPlayerDriftState.state === 'driftingRight') {
             releaseDrift(); // Call the dedicated function to handle boost and state reset
         } else if (localPlayerDriftState.state === 'hopping') {
              // If shift released during hop (no drift established), just cancel
              localPlayerDriftState.state = 'none';
              localPlayerDriftState.currentSidewaysAdjustment = 0; // Also reset here
              console.log("Hop Cancelled");
         }
    }
});

// Driving Physics Constants
const ACCELERATION = 0.009; // Increased for faster speed gain
const DECELERATION = 0.007; // DECREASED Friction slightly
const BRAKING_FORCE = 0.015;
const MAX_SPEED = 0.7; // Further increased top speed
const MAX_REVERSE_SPEED = -0.1;
const TURN_SPEED_BASE = 0.025; // Base radians per frame

// Drift Physics Constants
const HOP_DURATION = 150; // ms
const DRIFT_TURN_RATE = 0.018; // Reduced for a less tight initial drift
const DRIFT_COUNTER_STEER_FACTOR = 0.4; // How much player input affects drift angle WHEN NOT adjusting radius (keep for now?)
const DRIFT_SIDEWAYS_FACTOR = 0.4; // INCREASED: More base sideways slide
const DRIFT_COUNTER_STEER_RADIUS_EFFECT = 25.0; // EXTREME potential effect
const DRIFT_RADIUS_LERP_FACTOR = 0.0025; // Further decreased for slower radius changes
// const DRIFT_SPEED_MULTIPLIER = 0.98; // REMOVED - No speed penalty for drifting
const MINI_TURBO_LEVEL_1_TIME = 1000; // ms for blue sparks
const MINI_TURBO_LEVEL_2_TIME = 2000; // ms for orange sparks
const BOOST_LEVEL_1_STRENGTH = 0.3; // Additional velocity
const BOOST_LEVEL_2_STRENGTH = 0.5;
const BOOST_DURATION = 800; // ms

let boostEndTime = 0; // Track when current boost ends
let boostTriggerLevel = 0; // Track which mini-turbo level triggered the current boost

function initiateDrift(direction, now) {
    if (localPlayerDriftState.state === 'none' && players[localPlayerId]?.velocity > 0.1) { // Can only drift if moving forward
        console.log("Initiate Hop/Drift:", direction === -1 ? "Left" : "Right");
        localPlayerDriftState.state = 'hopping';
        localPlayerDriftState.direction = direction;
        localPlayerDriftState.startTime = now;
        localPlayerDriftState.hopEndTime = now + HOP_DURATION;
        localPlayerDriftState.miniTurboLevel = 0;
        localPlayerDriftState.currentSidewaysAdjustment = 0; // Reset smoothed value
        // TODO: Trigger hop animation visually
    }
}

function releaseDrift() {
    if (localPlayerDriftState.state === 'driftingLeft' || localPlayerDriftState.state === 'driftingRight') {
        console.log("Release Drift - Mini Turbo Level:", localPlayerDriftState.miniTurboLevel);
        if (localPlayerDriftState.miniTurboLevel > 0) {
             // Apply boost
             let boostStrength = (localPlayerDriftState.miniTurboLevel === 1) ? BOOST_LEVEL_1_STRENGTH : BOOST_LEVEL_2_STRENGTH;
             boostTriggerLevel = localPlayerDriftState.miniTurboLevel; // Store the level for flame tinting
             if(players[localPlayerId]) {
                 players[localPlayerId].velocity += boostStrength;
                 players[localPlayerId].velocity = Math.min(players[localPlayerId].velocity, MAX_SPEED + boostStrength * 0.5); // Allow exceeding max speed slightly
                 boostEndTime = Date.now() + BOOST_DURATION;
                 console.log("BOOST APPLIED! Level:", localPlayerDriftState.miniTurboLevel, "New Velocity:", players[localPlayerId].velocity);
                 // TODO: Trigger boost visual/audio
                 // Emit boost start event to the server
                 socket.emit('playerBoostStart', { level: boostTriggerLevel, duration: BOOST_DURATION });
             }
        }
         // Reset drift state
         localPlayerDriftState.state = 'none';
         localPlayerDriftState.direction = 0;
         localPlayerDriftState.startTime = 0;
         localPlayerDriftState.hopEndTime = 0;
         localPlayerDriftState.miniTurboLevel = 0;
         localPlayerDriftState.currentSidewaysAdjustment = 0; // Reset smoothed value

        // Emit drift end state to server
        socket.emit('playerDriftStateChange', false, 0);

     } else if (localPlayerDriftState.state === 'hopping') {
          // Cancel hop if button released too early
          localPlayerDriftState.state = 'none';
          localPlayerDriftState.currentSidewaysAdjustment = 0; // Also reset here
          console.log("Hop Cancelled");

         // Also emit drift end state if hop is cancelled
         socket.emit('playerDriftStateChange', false, 0);
     }
 }

// Need temporary vectors accessible in the function scope
const playerRight = new THREE.Vector3();
const driftMoveDirection = new THREE.Vector3();

function handleDrivingInput() {
    if (!localPlayerId || !playerObjects[localPlayerId] || !players[localPlayerId]) return;

    const player = players[localPlayerId];
    const playerObject = playerObjects[localPlayerId];
    const now = Date.now();

    // Initialize physics state if missing
    if (player.velocity === undefined) player.velocity = 0;
    if (!player.position) player.position = { x: playerObject.position.x, y: playerObject.position.y - playerSpriteScale / 2, z: playerObject.position.z };
    if (!player.rotation) player.rotation = { y: 0 };


    let deltaRotation = 0;
    let rotationChanged = false;
    let positionChanged = false;
    let isCurrentlyDrifting = localPlayerDriftState.state === 'driftingLeft' || localPlayerDriftState.state === 'driftingRight';
    let isHopping = localPlayerDriftState.state === 'hopping';

    // --- State Transitions ---
    if (isHopping && now >= localPlayerDriftState.hopEndTime) {
        localPlayerDriftState.state = (localPlayerDriftState.direction === -1) ? 'driftingLeft' : 'driftingRight';
        localPlayerDriftState.startTime = now; // Start drift timer AFTER hop
        console.log("Hop Finished -> Drifting", localPlayerDriftState.state);
        isHopping = false;
        isCurrentlyDrifting = true;
    }

    // --- Determine Current Player Axes ---
    // Important: Calculate forward/right based on the CURRENT rotation
    playerForward.set(0, 0, -1).applyAxisAngle(THREE.Object3D.DEFAULT_UP, player.rotation.y);
    playerRight.set(1, 0, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, player.rotation.y);

    // --- Rotation & Drift Movement Vector Calculation ---
    driftMoveDirection.set(0, 0, 0); // Reset drift move direction

    if (isCurrentlyDrifting) {
        // Base automatic rotation based on drift direction
        deltaRotation = -localPlayerDriftState.direction * DRIFT_TURN_RATE;

        // Calculate target sideways drift adjustment AND counter-rotation based on steering
        let counterSteerInput = 0;
        if (keyStates['a'] || keyStates['arrowleft']) {
            counterSteerInput = 1; // Steering left
        } else if (keyStates['d'] || keyStates['arrowright']) {
            counterSteerInput = -1; // Steering right
        }

        let targetSidewaysAdjustment = 0;
        if (counterSteerInput !== 0) {
            targetSidewaysAdjustment = -(counterSteerInput * localPlayerDriftState.direction) * DRIFT_COUNTER_STEER_RADIUS_EFFECT;

            // NEW: If steering *against* the drift direction, slightly counteract the automatic turning
            if (counterSteerInput === localPlayerDriftState.direction) { 
                // Steering input matches drift direction (widening attempt)
                // Apply a counter-rotation based on TURN_SPEED_BASE and a small factor
                const counterRotationFactor = 0.3; // How much counter-steer affects rotation during drift
                deltaRotation += counterSteerInput * TURN_SPEED_BASE * counterRotationFactor;
            }
        }
        
        // Smoothly interpolate the current adjustment towards the target
        localPlayerDriftState.currentSidewaysAdjustment += 
            (targetSidewaysAdjustment - localPlayerDriftState.currentSidewaysAdjustment) * DRIFT_RADIUS_LERP_FACTOR;

        // Use the smoothed adjustment to calculate the final sideways factor
        const currentSidewaysFactor = DRIFT_SIDEWAYS_FACTOR * (1 + localPlayerDriftState.currentSidewaysAdjustment);
        const sidewaysDrift = playerRight.clone().multiplyScalar(localPlayerDriftState.direction * currentSidewaysFactor);

        // Combine forward motion and sideways drift
        driftMoveDirection.copy(playerForward).add(sidewaysDrift).normalize();

    } else if (!isHopping) { // Normal steering (if not hopping)
        let intendedTurnDirection = 0;
        if (keyStates['a'] || keyStates['arrowleft']) intendedTurnDirection = 1;
        else if (keyStates['d'] || keyStates['arrowright']) intendedTurnDirection = -1;

        if (intendedTurnDirection !== 0) {
            const actualTurnDirection = (player.velocity < 0) ? -intendedTurnDirection : intendedTurnDirection;
            deltaRotation = actualTurnDirection * TURN_SPEED_BASE;
        }
    }

    // Apply Rotation Change (calculated deltaRotation from either drift or normal steer)
    if (deltaRotation !== 0) {
        player.rotation.y = (player.rotation.y + deltaRotation);
        player.rotation.y = (player.rotation.y + Math.PI * 2) % (Math.PI * 2); // Normalize
        rotationChanged = true;
    }

    // --- Acceleration / Deceleration --- (Mostly unchanged)
    let currentMaxSpeed = (now < boostEndTime) ? MAX_SPEED + BOOST_LEVEL_2_STRENGTH : MAX_SPEED; // Allow higher speed during boost
    let currentAcceleration = ACCELERATION;
    // if (isCurrentlyDrifting) { // Keep drift accel penalty? Optional.
    //     currentAcceleration *= 0.5;
    // }

    if (!isHopping && (keyStates['w'] || keyStates['arrowup'])) {
        player.velocity += currentAcceleration;
        player.velocity = Math.min(player.velocity, currentMaxSpeed);
    } else if (!isHopping && (keyStates['s'] || keyStates['arrowdown'])) {
        player.velocity -= BRAKING_FORCE;
        player.velocity = Math.max(player.velocity, MAX_REVERSE_SPEED);
    } else {
        // Apply friction/deceleration
        if (player.velocity > 0) {
            player.velocity -= DECELERATION;
            player.velocity = Math.max(0, player.velocity);
        } else if (player.velocity < 0) {
            player.velocity += DECELERATION;
            player.velocity = Math.min(0, player.velocity);
        }
    }

    // --- Update Mini-Turbo Level --- (Unchanged)
     if (isCurrentlyDrifting) {
         const driftDuration = now - localPlayerDriftState.startTime;
         if (driftDuration > MINI_TURBO_LEVEL_2_TIME) {
             localPlayerDriftState.miniTurboLevel = 2;
         } else if (driftDuration > MINI_TURBO_LEVEL_1_TIME) {
             localPlayerDriftState.miniTurboLevel = 1;
         } else {
             localPlayerDriftState.miniTurboLevel = 0;
         }
     }

    // --- Update Position --- (Refactored)
    if (Math.abs(player.velocity) > 0.001) { 
        let moveVector = new THREE.Vector3();
        if (isCurrentlyDrifting) {
            // Use the calculated drift direction vector
            moveVector.copy(driftMoveDirection);
        } else {
            // Use the standard forward direction based on current rotation
            moveVector.set(0, 0, -1).applyAxisAngle(THREE.Object3D.DEFAULT_UP, player.rotation.y);
        }

        moveVector.multiplyScalar(player.velocity);

        player.position.x += moveVector.x;
        player.position.y += moveVector.y; // Should be 0 if moveVector is calculated correctly on XZ plane
        player.position.z += moveVector.z;
        positionChanged = true;
    }

    // Update the visual object immediately for responsiveness if necessary
    if (positionChanged) {
         updatePlayerObjectTransform(localPlayerId, player.position, player.rotation);
    }
}

function updateCameraPosition() {
    // Make the camera follow the localPlayerObject smoothly
    if (localPlayerId && playerObjects[localPlayerId] && players[localPlayerId]) {
        const target = playerObjects[localPlayerId];
        const playerRotationY = players[localPlayerId].rotation?.y || 0;

        // Calculate desired camera position based on player's current rotation
        const offset = new THREE.Vector3(0, 4, 6); // Reduced Z offset to zoom in slightly
        offset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, playerRotationY);

        const cameraTargetPosition = target.position.clone().add(offset);
        // Look slightly above the sprite's base position
        const lookAtTarget = target.position.clone().add(new THREE.Vector3(0, playerSpriteScale * 0.5, 0));

        // Smoother camera using lerp
        const cameraLerpFactor = 0.15; // INCREASED for stiffer follow
        camera.position.lerp(cameraTargetPosition, cameraLerpFactor);

        // Make camera look directly at the target point above the kart
        camera.lookAt(lookAtTarget);

    } else if (raceInitialized) { // Keep spectator cam if race is running but local player gone/waiting
         // Simple rotating camera for spectator mode?
         const time = Date.now() * 0.0001;
         camera.position.x = Math.sin(time) * 40;
         camera.position.z = Math.cos(time) * 40;
         camera.position.y = 20;
         camera.lookAt(0, 0, 0); // Look at center of track
    }
     camera.updateMatrixWorld(); // Ensure camera's matrix is updated for next frame's calculations
}

let lastUpdateTime = 0;
const updateInterval = 100; // Send updates every 100ms (10 times per second)

function sendLocalPlayerUpdate() {
    const now = Date.now();
    // Check player data existence before sending
    if (now - lastUpdateTime > updateInterval && localPlayerId && players[localPlayerId] && players[localPlayerId].position && players[localPlayerId].rotation) {
        const playerState = players[localPlayerId];
        // Send only necessary data (position and rotation)
        const updateData = {
            position: playerState.position,
            rotation: playerState.rotation,
        };

        socket.emit('playerUpdateState', updateData);
        lastUpdateTime = now;
    }
}

// --- Initialization ---
console.log("Client script loaded. Waiting for server connection...");
// Initial setup (like character selection) is now triggered by the first 'updateGameState' from the server.
// The animate() loop is started only when the game state becomes 'racing' or 'waiting'.

console.log("Client script loaded. Waiting for server connection...");
preloadAssets(); // Call preload function
setupCharacterSelection(); // Initialize character selection screen

function updatePlayerSpriteAngle(playerId, sprite, playerData) {
    if (!sprite || !sprite.userData || !playerData) return;

    let newAngleIndex;

    if (playerId === localPlayerId) {
        const isDrifting = (localPlayerDriftState.state === 'driftingLeft' || localPlayerDriftState.state === 'driftingRight');

        if (isDrifting) {
            // Force sprite angle based on drift direction
            newAngleIndex = (localPlayerDriftState.direction === -1) ? 5 : 3; // 5='bl', 3='br'
        } else {
            // Original logic for non-drifting state (hold turn delay etc.)
            const now = Date.now();
            if ((keyStates['a'] || keyStates['arrowleft']) && leftTurnStartTime && (now - leftTurnStartTime > TURN_SPRITE_DELAY)) {
                newAngleIndex = 5; // Force 'bl' sprite after delay
            } else if ((keyStates['d'] || keyStates['arrowright']) && rightTurnStartTime && (now - rightTurnStartTime > TURN_SPRITE_DELAY)) {
                newAngleIndex = 3; // Force 'br' sprite after delay
            } else {
                // If not turning long enough or not turning, use camera vs facing angle
                newAngleIndex = calculateSpriteAngleIndex(sprite, playerData);
            }
        }
    } else {
        // For remote players, use camera vs facing angle
        newAngleIndex = calculateSpriteAngleIndex(sprite, playerData);
    }

    const newAngleCode = characterSpriteAngles[newAngleIndex];

    // Only update texture if the angle code has changed
    if (newAngleCode !== sprite.userData.currentAngleCode) {
        const newTexture = getCharacterTexture(sprite.userData.characterId, newAngleCode);
        if (newTexture && sprite.material.map !== newTexture) {
            sprite.material.map = newTexture;
            sprite.material.needsUpdate = true;
            sprite.userData.currentAngleCode = newAngleCode;
        } else if (!newTexture) {
             console.warn(`Failed to get texture for angle ${newAngleCode} for player ${playerId}`);
        }
    }
}

// Update all player objects based on the current `players` data
function updatePlayerObjects() {
    // Remove objects for players who are no longer present in the received state
    for (const id in playerObjects) {
        if (!players[id]) {
            removePlayerObject(id);
        }
    }
    // Add or update objects for current players
    for (const id in players) {
        // Ensure player has selected a character before trying to add/update
        if (players[id] && players[id].characterId) {
            if (!playerObjects[id]) {
                addPlayerObject(id, players[id]); // Add if missing
            } else {
                 // Update transform only if NOT lerping remote players
                 // (Local player is updated directly in input handling)
                 if (id === localPlayerId && players[id].position) {
                      updatePlayerObjectTransform(id, players[id].position, players[id].rotation);
                 }
            }
        } else if (playerObjects[id]) {
             // If player somehow exists visually but no longer has charId, remove them
             removePlayerObject(id);
        }
    }
}

// Define Course Layout Data (will eventually come from server)
const courseLayouts = {
    1: {
        name: "Simple Plane",
        planeSize: { width: 100, height: 200 },
        roadTexturePath: 'textures/road.png',
        textureRepeat: { x: 10, y: 20 },
        walls: [
            { type: 'box', size: { x: 1, y: 3, z: 200 }, position: { x: -50.5, y: 1.5, z: 0 } }, // Left
            { type: 'box', size: { x: 1, y: 3, z: 200 }, position: { x: 50.5, y: 1.5, z: 0 } }  // Right
        ],
        startPositions: [
             { x: 0, z: 5 }, { x: 2, z: 5 }, { x: -2, z: 5 }, { x: 4, z: 5 },
             { x: -4, z: 5 }, { x: 6, z: 5 }, { x: -6, z: 5 }, { x: 8, z: 5 }
        ]
    },
    // Add more courses here...
    2: {
        name: "Basic Oval",
        planeSize: { width: 120, height: 220 }, // Larger plane for oval
        roadTexturePath: 'textures/road_oval.png', // Different texture maybe?
        textureRepeat: { x: 12, y: 22 },
        walls: [
             // Outer Walls (example)
             { type: 'box', size: { x: 1, y: 3, z: 220 }, position: { x: -60.5, y: 1.5, z: 0 } },
             { type: 'box', size: { x: 1, y: 3, z: 220 }, position: { x: 60.5, y: 1.5, z: 0 } },
             { type: 'box', size: { x: 120, y: 3, z: 1 }, position: { x: 0, y: 1.5, z: -110.5 } },
             { type: 'box', size: { x: 120, y: 3, z: 1 }, position: { x: 0, y: 1.5, z: 110.5 } },
             // Inner Walls (example - making an oval shape)
             { type: 'box', size: { x: 1, y: 3, z: 100 }, position: { x: -20.5, y: 1.5, z: -50 } },
             { type: 'box', size: { x: 1, y: 3, z: 100 }, position: { x: 20.5, y: 1.5, z: -50 } },
             // ... potentially more complex shapes using multiple boxes or geometry
        ],
        startPositions: [
             { x: -4, z: 100 }, { x: -2, z: 100 }, { x: 0, z: 100 }, { x: 2, z: 100 },
             { x: 4, z: 100 }, { x: 6, z: 100 }, { x: -6, z: 100 }, { x: -8, z: 100 }
        ]
    }
};

// --- Course Setup --- 
let currentCourseObjects = []; // Keep track of course objects for cleanup

function createCourse(courseData) {
    if (!courseData) {
        console.error("No course data provided to createCourse!");
        // Optionally load a default course
        courseData = courseLayouts[1]; // Fallback to course 1
    }
    console.log(`Creating course: ${courseData.name}`);

    // --- Create Ground Plane --- 
    const roadTexture = textureLoader.load(courseData.roadTexturePath || 'textures/road.png');
    roadTexture.wrapS = THREE.RepeatWrapping;
    roadTexture.wrapT = THREE.RepeatWrapping;
    const repeatX = courseData.textureRepeat?.x || 10;
    const repeatY = courseData.textureRepeat?.y || 10;
    roadTexture.repeat.set(repeatX, repeatY);

    const planeSize = courseData.planeSize || { width: 100, height: 100 };
    const planeGeometry = new THREE.PlaneGeometry(planeSize.width, planeSize.height);
    const planeMaterial = new THREE.MeshStandardMaterial({ map: roadTexture, side: THREE.DoubleSide }); // Restore Standard
    const plane = new THREE.Mesh(planeGeometry, planeMaterial);
    plane.rotation.x = -Math.PI / 2; 
    plane.position.y = 0; 
    plane.receiveShadow = true; 
    scene.add(plane);
    currentCourseObjects.push(plane);
    console.log(`[createCourse] Added ground plane to scene.`);

    // --- Create Walls --- 
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x888888 }); // Restore Standard
    if (courseData.walls && Array.isArray(courseData.walls)) {
        courseData.walls.forEach(wallData => {
            if (wallData.type === 'box') { // Extend this for other wall types later
                const size = wallData.size || { x: 1, y: 1, z: 1 };
                const position = wallData.position || { x: 0, y: 0.5, z: 0 };
                const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
                const wallMesh = new THREE.Mesh(geometry, wallMaterial);
                wallMesh.position.set(position.x, position.y, position.z);
                // Apply rotation if specified in wallData (e.g., wallData.rotation = { x: 0, y: Math.PI/4, z: 0 })
                if(wallData.rotation) {
                     wallMesh.rotation.set(
                         wallData.rotation.x || 0,
                         wallData.rotation.y || 0,
                         wallData.rotation.z || 0
                     );
                }
                wallMesh.castShadow = true;
                wallMesh.receiveShadow = true;
                scene.add(wallMesh);
                console.log(`[createCourse] Added wall ${wallData.type} to scene at ${position.x}, ${position.y}, ${position.z}`);
                currentCourseObjects.push(wallMesh);
            } 
            // Add else if for cylinders, custom shapes etc.
        });
    }

    // Add more course elements based on courseData (e.g., item boxes, boost pads)
}

// --- Race Initialization ---
function initializeRaceScene(initialPlayers, levelData) { // Add levelData parameter
    console.log("Initializing race scene...");
    if (raceInitialized) { 
         cleanupRaceScene(); // Ensure cleanup runs if re-initializing
    }
    raceInitialized = true;
    isSceneInitialized = true; // Ensure this is set too

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Restore Sky blue background

    // --- Lighting ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4); // Slightly increased ambient light
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7);
    scene.add(directionalLight);
    renderer.shadowMap.enabled = true; // Ensure shadows are enabled
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // --- Camera Setup ---
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 10, 15); // Default initial position
    camera.lookAt(0, 0, 0);

    // --- Setup EffectComposer ---
    composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    // Temporarily remove other passes for debugging
    // Add Bloom and Output passes
    // const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.1, 0.85); // Adjusted threshold, strength
    // composer.addPass(bloomPass);
    // const outputPass = new OutputPass();
    // composer.addPass(outputPass);

    // --- Setup Resize Handling for this scene/composer instance ---
    // Remove previous listener if any to avoid duplicates
    window.removeEventListener('resize', handleResizeForComposer);
    // Add new listener
    window.addEventListener('resize', handleResizeForComposer);

    // --- Load Course ---
    // If levelData is provided, use it. Otherwise, use defaults.
    if (levelData) {
        console.log("Loading course from received level data:", levelData.name);
        console.log("--> Calling createCourseFromData"); // <<< ADD LOG
        createCourseFromData(levelData);
    } else {
        console.log("No level data received, loading default course (Course 1)."); // Revert log
        const courseId = 1; // Default course ID
        let courseDataToLoad = courseLayouts[courseId]; // Fallback using old system
        if (!courseDataToLoad) {
             console.error(`FATAL: Default Course ID ${courseId} not found in layouts!`);
             // Handle this critical error - maybe show an error message and stop?
             courseDataToLoad = { // Provide a minimal fallback layout
                 name: "Fallback Plane",
                 planeSize: { width: 50, height: 50 },
                 textureRepeat: { x: 5, y: 5 },
                 //texture: '/textures/grass.png', // Use a known texture - Change path if needed
                 roadTexturePath: '/textures/road.png', // Ensure this key exists for createCourse
                 walls: []
             };
        }
        console.log("--> Calling createCourse"); // <<< ADD LOG
        createCourse(courseDataToLoad); // Call the OLD function for default/fallback
    }

    // --- Add Initial Player Objects ---
    console.log("Adding initial player objects:", initialPlayers);
    updatePlayerObjects(); // Use the initialPlayers data passed from updateGameState
    setupInitialCameraPosition();
    updateAllSpriteAngles();

    // Initialize spark system after scene setup
    initializeSparkSystem();
}

// Define a resize handler function globally or make it accessible
function handleResizeForComposer() {
    if (camera && renderer && composer) { // Check if objects exist
        const width = window.innerWidth;
        const height = window.innerHeight;

        camera.aspect = width / height;
        camera.updateProjectionMatrix();

        renderer.setSize(width, height);
        composer.setSize(width, height); // Resize composer too
    }
}

function setupInitialCameraPosition() {
     if (localPlayerId && players[localPlayerId] && playerObjects[localPlayerId]) {
        const playerObj = playerObjects[localPlayerId];
         const targetPosition = playerObj.position;
         const playerRotationY = players[localPlayerId].rotation?.y || 0;
         const offset = new THREE.Vector3(0, 4, 6); // Reduced Z offset to zoom in slightly
         offset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, playerRotationY); // Apply rotation
         const finalCamPos = targetPosition.clone().add(offset);
         const finalLookAt = targetPosition.clone().add(new THREE.Vector3(0, 1.5, 0));
         camera.position.copy(finalCamPos);
         camera.lookAt(finalLookAt); 
         console.log(`Initial camera set for local player ${localPlayerId}`);
         console.log(`  -> Cam Pos: ${finalCamPos.x.toFixed(2)}, ${finalCamPos.y.toFixed(2)}, ${finalCamPos.z.toFixed(2)}`);
         console.log(`  -> LookAt: ${finalLookAt.x.toFixed(2)}, ${finalLookAt.y.toFixed(2)}, ${finalLookAt.z.toFixed(2)}`);
         camera.updateMatrixWorld(); // Update camera matrix immediately
    } else {
        // Default camera position if local player not found (e.g., spectator)
        camera.position.set(0, 15, 30); // Overview position
        camera.lookAt(0, 0, 0);
         console.log("Setting default camera position (spectator/no local player).");
          camera.updateMatrixWorld();
    }
}


// --- Game Loop ---
let animationFrameId = null;
const lerpFactor = 0.15; // Smoothing factor for remote player movement
let frameCount = 0; // Initialize frame counter

function animate() {
    // Loop should continue as long as race is initialized (racing or spectator)
    if (!raceInitialized) {
        animationFrameId = null; // Ensure loop stops if scene cleaned up
        return;
    };
    // console.log(`[Animate Frame ${frameCount}] State: ${currentGameState}`); // Log animate loop runs
    animationFrameId = requestAnimationFrame(animate);
    frameCount++; // Increment frame counter
    const now = Date.now(); // Get current time for effects

    // --- Update Remote Player Positions (Lerp) ---
     for (const playerId in playerObjects) {
         if (playerId !== localPlayerId && playerObjects[playerId].userData.targetPosition) {
             playerObjects[playerId].position.lerp(playerObjects[playerId].userData.targetPosition, lerpFactor);
         }
     }

    // Only run driving logic if actually racing and local player exists
    if (currentGameState === 'racing' && localPlayerId && players[localPlayerId]) {
        handleDrivingInput();
        sendLocalPlayerUpdate();
    }

    updateCameraPosition();
    updateAllSpriteAngles();

    // --- Update Visual Effects for ALL players ---
    for (const playerId in playerObjects) {
        updateDriftParticles(playerId);
        updateBoostFlame(playerId, now);
    }

    // composer.render(); // Render via EffectComposer
    composer.render(); // <<< Restore composer rendering

    // Update spark system if it exists
    if (sparkSystem) {
        updateSparks();
    }
}

function updateAllSpriteAngles() {
    camera.updateMatrixWorld(); // Ensure camera matrix is up-to-date before calculations
    for (const playerId in playerObjects) {
        if (players[playerId]) { // Ensure player data exists
            updatePlayerSpriteAngle(playerId, playerObjects[playerId], players[playerId]);
        }
    }
}

// --- Visual Effects Update ---

// Temporary vectors for particle calculations
const particleEmitterOffset = new THREE.Vector3(0, -0.1, -0.5); // Keep emitter low
const particleWorldOffset = new THREE.Vector3();
const particleEmitterPosition = new THREE.Vector3();
const particlePlayerRight = new THREE.Vector3();
const particleSpreadOffset = new THREE.Vector3();

function updateDriftParticles(playerId) {
    if (!playerVisuals[playerId] || !players[playerId] || !playerObjects[playerId]) return;

    const { driftParticles } = playerVisuals[playerId];
    const playerData = players[playerId];
    const playerSprite = playerObjects[playerId];

    let isDrifting = false;
    let driftDirection = 0;
    let miniTurboLevel = 0;

    if (playerId === localPlayerId) {
        isDrifting = (localPlayerDriftState.state === 'driftingLeft' || localPlayerDriftState.state === 'driftingRight');
        driftDirection = localPlayerDriftState.direction;
        miniTurboLevel = localPlayerDriftState.miniTurboLevel;
    } else {
        // Use state received from server for remote players
        isDrifting = playerData.isDrifting || false;
        driftDirection = playerData.driftDirection || 0;
        miniTurboLevel = playerData.boostLevel || 0; // Using boostLevel for particle color, might need separate drift level sync
    }

    // --- Set Particle Color based on Mini-Turbo Level ---
    let targetColor = 0xffffff; // Default: White
    if (miniTurboLevel === 1) {
        targetColor = 0xff0000; // Level 1: Red
    } else if (miniTurboLevel >= 2) {
        targetColor = 0x0000ff; // Level 2: Blue
    }
    // Update shared material color (may affect all particle systems if not cloned)
    // Consider cloning particlesMaterial if different colors are needed simultaneously.
    if (particlesMaterial.color.getHex() !== targetColor) {
         particlesMaterial.color.setHex(targetColor);
    }

    driftParticles.visible = isDrifting;

    if (driftParticles.visible) {
        const playerRotationY = playerData.rotation?.y || 0;

        // 1. Calculate Emitter World Position & Rotation
        particleWorldOffset.copy(particleEmitterOffset).applyAxisAngle(THREE.Object3D.DEFAULT_UP, playerRotationY);
        particleEmitterPosition.copy(playerSprite.position).add(particleWorldOffset);
        particleEmitterPosition.y = particleEmitterOffset.y; // Use the LOWERED offset Y (-0.1)
        driftParticles.position.copy(particleEmitterPosition);
        driftParticles.rotation.y = playerRotationY; // Keep emitter aligned with player

        // 2. Calculate Player's World Right Vector (needed for initial spread)
        particlePlayerRight.set(1, 0, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, playerRotationY);

        // 3. Update Individual Particles
        const positions = driftParticles.geometry.attributes.position.array;
        const particleSpeed = 0.1 + Math.random() * 0.1;
        const spread = 1.0;
        const maxParticleDist = 2.5;
        const velocity = playerData.velocity || (playerId === localPlayerId ? players[localPlayerId]?.velocity : 0.1); // Estimate velocity for remotes if not synced
        const velocityFactor = (velocity > 0 ? velocity / MAX_SPEED : 0.5);
        const sidewaysDriftFactor = 0.02;

        for (let i = 0; i < positions.length; i += 3) {
            if (positions[i+2] > maxParticleDist || Math.random() < 0.05) {
                 const randomSpread = (Math.random() - 0.5) * spread;
                 positions[i]   = randomSpread;
                 positions[i+1] = (Math.random() * 0.05);
                 positions[i+2] = (Math.random() - 0.5) * 0.1;
            } else {
                positions[i+2] += particleSpeed * velocityFactor;
                 const driftAmount = driftDirection * sidewaysDriftFactor * velocityFactor;
                 positions[i] += driftAmount;
                 positions[i+1] += 0.01;
            }
        }
        driftParticles.geometry.attributes.position.needsUpdate = true;
    }
}

let flameAnimationIndex = 0; // Shared animation index - consider per-player if needed
let lastFlameUpdateTime = 0; // Shared timer - consider per-player if needed
const FLAME_ANIMATION_SPEED = 50;
const FLAME_LOOP_START_INDEX = 4;

const playerForwardFlame = new THREE.Vector3(0, 0, -1);
const flameTargetPosition = new THREE.Vector3();
const flameOffsetDistance = -0.6;
const flameYPosition = 0.02;

function updateBoostFlame(playerId, now) {
    if (!playerVisuals[playerId] || !players[playerId] || !playerObjects[playerId]) return;

    const { boostFlame } = playerVisuals[playerId];
    const playerSprite = playerObjects[playerId];
    const playerData = players[playerId];

    let isBoosting = false;
    let boostLevel = 0;

    if (playerId === localPlayerId) {
        isBoosting = (now < boostEndTime); // Use local boost timer
        boostLevel = boostTriggerLevel; // Use local trigger level
    } else {
        // Use state received from server for remote players
        isBoosting = playerData.isBoosting || false;
        boostLevel = playerData.boostLevel || 0;
    }

    boostFlame.visible = isBoosting;

    if (isBoosting) {
        const playerRotationY = playerData.rotation?.y || 0;
        playerForwardFlame.set(0, 0, -1);
        playerForwardFlame.applyAxisAngle(THREE.Object3D.DEFAULT_UP, playerRotationY);

        flameTargetPosition.copy(playerSprite.position);
        flameTargetPosition.addScaledVector(playerForwardFlame, flameOffsetDistance);
        flameTargetPosition.y = flameYPosition;

        boostFlame.position.copy(flameTargetPosition);

        // --- Tint flame based on boost level ---
        let targetColor = 0xffffff;
        if (boostLevel >= 2) {
             targetColor = 0x6666ff;
        }
        if (boostFlame.material.color.getHex() !== targetColor) {
             boostFlame.material.color.setHex(targetColor);
             boostFlame.material.needsUpdate = true;
        }

        // --- Animate texture (using shared index/timer for now) ---
        if (now - lastFlameUpdateTime > FLAME_ANIMATION_SPEED) {
            flameAnimationIndex++;
            let textureIndex;
            if (flameAnimationIndex < flameTextures.length) {
                textureIndex = flameAnimationIndex;
            } else {
                const loopIndex = (flameAnimationIndex - FLAME_LOOP_START_INDEX) % (flameTextures.length - FLAME_LOOP_START_INDEX);
                textureIndex = FLAME_LOOP_START_INDEX + loopIndex;
            }

            if (flameTextures[textureIndex]) {
                boostFlame.material.map = flameTextures[textureIndex];
                boostFlame.material.needsUpdate = true;
            } else {
                 console.warn(`Missing flame texture for index: ${textureIndex}`);
            }
            lastFlameUpdateTime = now; // Update shared timer
        }
    } else {
        // Reset shared state if this player *was* the one causing animation?
        // This part is tricky with shared state.
        // A per-player animation state would be better.
        if (boostFlame.material.color.getHex() !== 0xffffff) {
            boostFlame.material.color.setHex(0xffffff);
            boostFlame.material.needsUpdate = true;
        }
        // Resetting shared index might stop other players' animations prematurely
        // flameAnimationIndex = 0;
        // boostTriggerLevel = 0; // This is local, reset is fine.
    }
}

// NEW Function to create course from loaded data
function createCourseFromData(levelData) {
    console.log("Creating course from data:", levelData);
    if (!levelData || !levelData.tiles || !levelData.elements) {
        console.error("Invalid level data provided to createCourseFromData.");
        loadCourse(1); // Fallback to default
        return;
    }

    // --- Define mapping from editor coords to world coords ---
    const TILE_SIZE_EDITOR = 32; // Matches editor.js
    const GRID_WIDTH_EDITOR = 40;
    const GRID_HEIGHT_EDITOR = 30;
    const WORLD_SCALE = 30.0; // <<< Further increased overall positioning scale (1.5x)
    const GROUND_TILE_WORLD_SIZE = 30.0; // <<< Match ground tile size to new world scale
    // Calculate world offset to center the grid (optional, adjust as needed)
    const worldOffsetX = -(GRID_WIDTH_EDITOR * WORLD_SCALE) / 2;
    const worldOffsetZ = -(GRID_HEIGHT_EDITOR * WORLD_SCALE) / 2;

    function editorToWorld(editorX, editorY) {
        return {
            x: worldOffsetX + (editorX + 0.5) * WORLD_SCALE,
            y: 0, // Assuming flat ground for now
            z: worldOffsetZ + (editorY + 0.5) * WORLD_SCALE
        };
    }

    // --- Create Ground Tiles ---
    // Consider creating one large ground plane or fewer larger planes for performance
    // For now, map tiles directly (might be slow for large maps)
    levelData.tiles.forEach(tile => {
        const pos = editorToWorld(tile.x, tile.y);
        let textureUrl = null;
        let color = 0x888888; // Default grey

        switch (tile.type) {
            case 'grass': textureUrl = '/textures/grass.png'; color = 0x34A853; break;
            case 'mud': textureUrl = '/textures/mud.png'; color = 0x8B4513; break;
            case 'road_v':
            case 'road_h':
            case 'road_ne':
            case 'road_nw':
            case 'road_se':
            case 'road_sw': textureUrl = '/textures/road.png'; color = 0x666666; break;
            case 'startfinish': textureUrl = '/textures/startfinishline.png'; color = 0xaaaaaa; break;
            default: textureUrl = '/textures/grass.png'; // Default to grass if unknown type
        }

        // Make geometry slightly larger than spacing to prevent gaps
        const overlap = 0.1;
        const groundGeometry = new THREE.PlaneGeometry(GROUND_TILE_WORLD_SIZE + overlap, GROUND_TILE_WORLD_SIZE + overlap);
        let groundMaterial;

        if (textureUrl && textures[textureUrl]) {
             groundMaterial = new THREE.MeshStandardMaterial({ map: textures[textureUrl] }); // Revert to Lambert or Standard
        } else {
            console.warn(`Texture not preloaded or not found for tile type: ${tile.type} (path: ${textureUrl}). Using color.`);
            groundMaterial = new THREE.MeshStandardMaterial({ map: textures[textureUrl] }); // Revert to Lambert or Standard
        }

        const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
        groundMesh.rotation.x = -Math.PI / 2; // Rotate plane to be flat
        // Add tiny random offset to prevent Z-fighting
        const randomYOffset = (Math.random() - 0.5) * 0.01; // <<< Increased random offset magnitude
        groundMesh.position.set(pos.x, pos.y - 0.01 + randomYOffset, pos.z);

        // TODO: Handle road rotations/variants based on tile.variant

        scene.add(groundMesh);

        // --- Add Striped Edges --- 
        const stripeTextureKey = '/textures/stripedline.png';
        const stripeTextureFlipKey = '/textures/stripedlineflip.png';
        if (textures[stripeTextureKey] && tile.type.startsWith('road')) { // Only add stripes to road tiles
            const stripeMap = textures[stripeTextureKey];
            const stripeMapFlip = textures[stripeTextureFlipKey];

            // Material for N/S (using flipped texture, no Z rotation)
            const stripeMaterialNS = new THREE.MeshStandardMaterial({
                map: stripeMapFlip, // Use flipped texture
                color: stripeMapFlip ? 0xffffff : 0x00ff00, // GREEN fallback for NS
                transparent: true, alphaTest: 0.1, depthWrite: false,
                polygonOffset: true, polygonOffsetFactor: -1.0, polygonOffsetUnits: -4.0
            });

            // Material for E/W (using original texture, WITH Z rotation)
            const stripeMaterial = new THREE.MeshStandardMaterial({
                map: stripeMap,
                color: stripeMap ? 0xffffff : 0xff0000, // White if texture loads, RED fallback
                transparent: true, alphaTest: 0.1, depthWrite: false,
                polygonOffset: true, polygonOffsetFactor: -1.0, polygonOffsetUnits: -4.0
            });

            const isRoad = (t) => t && t.type.startsWith('road'); // Helper to check if a tile is road

            const neighbors = {
                n: levelData.tiles.find(t => t.x === tile.x && t.y === tile.y - 1),
                s: levelData.tiles.find(t => t.x === tile.x && t.y === tile.y + 1),
                e: levelData.tiles.find(t => t.x === tile.x + 1 && t.y === tile.y),
                w: levelData.tiles.find(t => t.x === tile.x - 1 && t.y === tile.y)
            };

            const stripeHeight = 1.0; // Increased stripe height
            const stripeWidth = GROUND_TILE_WORLD_SIZE; // Full width of the tile edge
            const stripeGeometryNS = new THREE.PlaneGeometry(stripeWidth, stripeHeight);
            const stripeGeometryEW = new THREE.PlaneGeometry(stripeHeight, stripeWidth); // Swapped dimensions

            // Check North edge
            if (!isRoad(neighbors.n)) {
                const stripeN = new THREE.Mesh(stripeGeometryNS, stripeMaterial); // Use Original Material
                stripeN.rotation.x = -Math.PI / 2;
                stripeN.rotation.z = Math.PI; // Add Z rotation
                stripeN.position.set(pos.x, pos.y, pos.z - GROUND_TILE_WORLD_SIZE / 2);
                scene.add(stripeN);
            }
            // Check South edge
            if (!isRoad(neighbors.s)) {
                const stripeS = new THREE.Mesh(stripeGeometryNS, stripeMaterial); // Use Original Material
                stripeS.rotation.x = -Math.PI / 2;
                stripeS.rotation.z = Math.PI; // Add Z rotation
                stripeS.position.set(pos.x, pos.y, pos.z + GROUND_TILE_WORLD_SIZE / 2);
                scene.add(stripeS);
            }
            // Check East edge
            if (!isRoad(neighbors.e)) {
                const stripeE = new THREE.Mesh(stripeGeometryEW, stripeMaterialNS); // Use NS (Flipped) Material
                stripeE.rotation.x = -Math.PI / 2;
                stripeE.position.set(pos.x + GROUND_TILE_WORLD_SIZE / 2, pos.y, pos.z);
                scene.add(stripeE);
            }
            // Check West edge
            if (!isRoad(neighbors.w)) {
                const stripeW = new THREE.Mesh(stripeGeometryEW, stripeMaterialNS); // Use NS (Flipped) Material
                stripeW.rotation.x = -Math.PI / 2;
                stripeW.position.set(pos.x - GROUND_TILE_WORLD_SIZE / 2, pos.y, pos.z);
                scene.add(stripeW);
            }
        }
    });

    // --- Create Elements (Walls, etc.) ---
    levelData.elements.forEach(element => {
        const pos = editorToWorld(element.x, element.y);
        let elementMesh = null;
        // Reduce relative element size
        // Adjust factors to keep element size somewhat constant despite increased WORLD_SCALE
        const elementSize = WORLD_SCALE * 0.27; // Approx 8.1 with WORLD_SCALE=30
        const elementHeight = WORLD_SCALE * 0.2; // Approx 6.0 with WORLD_SCALE=30

        // Simple box geometry for now
        const geometry = new THREE.BoxGeometry(elementSize, elementHeight, elementSize);
        let material;

        // Basic color mapping (improve with textures later)
        let color = 0xCCCCCC;
        switch (element.type) {
            case 'startgate': color = 0xFFFF00; break; // Yellow
            case 'blueblock': color = 0x4285F4; break; // Blue
            case 'greenblock': color = 0x34A853; break; // Green
            case 'darkgreenblock': color = 0x0F9D58; break; // Dark Green
            case 'redblock': color = 0xEA4335; break; // Red
            case 'yellowblock': color = 0xFBBC05; break; // Yellow/Orange
            case 'tiresred': color = 0xEA4335; break;
            case 'tireswhite': color = 0xFFFFFF; break;
            default: color = 0x999999; // Default grey for unknown elements
        }
        material = new THREE.MeshStandardMaterial({ color: color }); // Revert to Lambert or Standard
        elementMesh = new THREE.Mesh(geometry, material);
        elementMesh.position.set(pos.x, pos.y + elementHeight / 2, pos.z);

        // TODO: Add textures, rotations, different geometries based on element.type

        if (elementMesh) {
            scene.add(elementMesh);
        }
    });

    console.log("Finished creating course from data.");
}

// Function to clean up scene objects and state when race ends or resets
function cleanupRaceScene() {
    console.log("Cleaning up race scene...");

    // Stop the animation loop
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    // Remove players
    for (const playerId in playerObjects) {
        removePlayerObject(playerId); // Use existing function to remove visuals
    }
    players = {}; // Clear player data cache
    playerObjects = {}; // Ensure visual object references are cleared
    playerVisuals = {}; // Ensure visual components references are cleared

    // Remove course objects 
    // Fallback: Remove meshes/sprites potentially added by createCourseFromData or createCourse
    const objectsToRemove = [];
    scene.children.forEach(child => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Points || child instanceof THREE.Sprite) {
            // Keep player sprites (already handled by removePlayerObject)
            // Keep lights, camera etc.
            if (!Object.values(playerObjects).includes(child) && 
                !(child instanceof THREE.Light || child instanceof THREE.Camera)) {
                objectsToRemove.push(child);
            }
        }
    });
    objectsToRemove.forEach(obj => scene.remove(obj));
    console.log(`Removed ${objectsToRemove.length} dynamic scene objects.`);
    if (currentCourseObjects && Array.isArray(currentCourseObjects)) {
        currentCourseObjects = []; // Also clear the old tracking array if it exists
    }

    // Remove resize listener
    window.removeEventListener('resize', handleResizeForComposer);

    // Reset flags
    raceInitialized = false;
    isSceneInitialized = false;
    composer = null; 
    console.log("Race scene cleanup complete.");
}

// --- Spark Effect Setup ---
let sparkSystem;
const MAX_SPARKS = 50; // Max sparks visible at once
let sparkParticles = []; // Store individual spark data { position, velocity, life, textureIndex } 
const sparkTexturesLoaded = []; // Cache loaded textures
const SPARK_LIFESPAN = 300; // ms

// --- Collision Handling ---
socket.on('collisionDetected', ({ playerA_id, playerB_id, collisionPoint }) => {
    console.log(`Collision event received: ${playerA_id} vs ${playerB_id} at`, collisionPoint); // <<< Enable log
    if (raceInitialized && sparkSystem) {
        console.log("--> Triggering sparks!"); // <<< Add log
        triggerSparks(collisionPoint);
    }
});

// --- Spark Functions ---
function initializeSparkSystem() {
    console.log("Initializing Spark System..."); // <<< Add log
    // Cache loaded spark textures
    for (let i = 1; i <= 5; i++) {
        const path = `/Sprites/sparks/spark${i}.png`;
        if (textures[path]) {
            sparkTexturesLoaded.push(textures[path]);
        }
    }
    if (sparkTexturesLoaded.length === 0) {
        console.warn("No spark textures loaded, cannot initialize spark system.");
        return;
    }

    const sparkGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_SPARKS * 3);
    const colors = new Float32Array(MAX_SPARKS * 3); // For potential color variation
    const texIndices = new Float32Array(MAX_SPARKS); // To tell shader which texture

    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    sparkGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); // Optional
    sparkGeometry.setAttribute('texIndex', new THREE.BufferAttribute(texIndices, 1));

    // For simplicity, start with PointsMaterial - ShaderMaterial needed for per-particle texture
    const sparkMaterial = new THREE.PointsMaterial({
        size: 0.8, // Adjust size
        map: sparkTexturesLoaded[0], // Use first texture as default for PointsMaterial
        transparent: true,
        alphaTest: 0.1,
        depthWrite: false,
        blending: THREE.AdditiveBlending // Brighter sparks
    });

    sparkSystem = new THREE.Points(sparkGeometry, sparkMaterial);
    sparkSystem.visible = false; // Start hidden
    scene.add(sparkSystem);

    // Initialize particle data pool
    for (let i = 0; i < MAX_SPARKS; i++) {
        sparkParticles.push({ life: 0, velocity: new THREE.Vector3(), textureIndex: 0 });
    }
}

function triggerSparks(origin) {
    if (!sparkSystem || sparkTexturesLoaded.length === 0) return;

    let sparksCreated = 0;
    const numSparksToCreate = 8; // As requested

    for (let i = 0; i < MAX_SPARKS && sparksCreated < numSparksToCreate; i++) {
        if (sparkParticles[i].life <= 0) { // Find a dead particle to reuse
            sparkParticles[i].life = SPARK_LIFESPAN;
            sparkParticles[i].textureIndex = Math.floor(Math.random() * sparkTexturesLoaded.length); // Random texture
            // Initial position at collision point
            sparkSystem.geometry.attributes.position.setXYZ(i, origin.x, origin.y, origin.z);
            // Random outward velocity
            sparkParticles[i].velocity.set(
                (Math.random() - 0.5),
                (Math.random() - 0.5),
                (Math.random() - 0.5)
            ).normalize().multiplyScalar(0.1 + Math.random() * 0.1); // Random speed

            sparksCreated++;
        }
    }

    sparkSystem.visible = true; // Make sure system is visible if sparks are active
    sparkSystem.geometry.attributes.position.needsUpdate = true;
    // NOTE: Changing texture per particle needs ShaderMaterial, this won't work with PointsMaterial directly.
    // We can set the overall texture randomly for now as a placeholder.
    sparkSystem.material.map = sparkTexturesLoaded[Math.floor(Math.random() * sparkTexturesLoaded.length)];
    sparkSystem.material.needsUpdate = true; 
}

let lastSparkUpdate = Date.now();
function updateSparks() {
    if (!sparkSystem || !sparkSystem.visible) return;

    const now = Date.now();
    const delta = now - lastSparkUpdate;
    lastSparkUpdate = now;

    let aliveCount = 0;
    const positions = sparkSystem.geometry.attributes.position.array;

    for (let i = 0; i < MAX_SPARKS; i++) {
        if (sparkParticles[i].life > 0) {
            sparkParticles[i].life -= delta;
            if (sparkParticles[i].life <= 0) {
                // Hide particle (move far away or set scale to 0 if using InstancedMesh)
                positions[i * 3 + 1] = -10000; // Move offscreen
            } else {
                // Update position
                positions[i * 3 + 0] += sparkParticles[i].velocity.x * delta * 0.05; // Reduced speed multiplier
                positions[i * 3 + 1] += sparkParticles[i].velocity.y * delta * 0.05; // Reduced speed multiplier
                positions[i * 3 + 2] += sparkParticles[i].velocity.z * delta * 0.05; // Reduced speed multiplier
                aliveCount++;
            }
        }
    }

    sparkSystem.geometry.attributes.position.needsUpdate = true;
    if (aliveCount === 0) {
        sparkSystem.visible = false; // Hide system if no sparks are alive
    }
}

