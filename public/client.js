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
    : 'https://karts-websocket.onrender.com';

// Base URL for assets
const ASSET_BASE_URL = window.location.hostname === 'localhost' 
    ? '' 
    : 'https://karts-websocket.onrender.com';

console.log('Using base URL for assets:', ASSET_BASE_URL);

console.log('Connecting to WebSocket server at:', WEBSOCKET_URL);

// Configure Socket.IO client
const socket = io(WEBSOCKET_URL, {
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
    upgrade: true,
    rememberUpgrade: true,
    timeout: 10000,
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
    console.log(`Reconnection attempt ${attemptNumber}`);
    updateConnectionStatus('reconnecting', `Reconnection attempt ${attemptNumber}`);
});

// Helper function to update connection status
function updateConnectionStatus(status, message = '') {
    console.log('Connection status:', status, message);
    // You can update UI elements here if needed
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
let currentCourseEditorTiles = []; // <<< ADDED Declaration

// Global variable to track which course to load locally
let localSelectedCourseId = 1;

// --- DOM Elements ---
const characterSelectionOverlay = document.getElementById('character-selection');
const waitingScreenOverlay = document.getElementById('waiting-screen');
const characterGrid = document.getElementById('character-grid');
const selectedCharacterNameElement = document.getElementById('selected-character-name');

// --- Character Data ---
const characters = {
    1: { name: "Turbo Hank", baseSpritePath: "Sprites/characters" },
    2: { name: "Stella Vroom", baseSpritePath: "Sprites/characters" },
    3: { name: "Bongo Blitz", baseSpritePath: "Sprites/characters" },
    4: { name: "Krash Krawl", baseSpritePath: "Sprites/characters" },
    5: { name: "Kara Krawl", baseSpritePath: "Sprites/characters" },
    6: { name: "Freddy", baseSpritePath: "Sprites/characters" },
    7: { name: "Laurette", baseSpritePath: "Sprites/characters" },
    8: { name: "Fierry Farez", baseSpritePath: "Sprites/characters" }
};

const characterSpriteAngles = ['f', 'fr', 'r', 'br', 'b', 'bl', 'l', 'fl'];
// --- Texture Loading ---
const textureLoader = new THREE.TextureLoader();
textureLoader.crossOrigin = 'anonymous'; // Add this line to handle CORS
const characterTextures = {}; // Cache for loaded textures { 'charId_angle': THREE.Texture }
const flameTextures = [];
const textures = {}; // <<< ADD Global object for course textures
let particlesMaterial;

// --- ADDED: Preload Set for Elements --- 
const elementTexturesToPreload = new Set([
    'startgate',
    'blueblock',
    'greenblock',
    'darkgreenblock',
    'redblock',
    'yellowblock',
    'tiresred',
    'tireswhite'
    // Add any other element types used
]);

function preloadAssets() {
    console.log("Preloading assets...");
    const assetsToLoad = [
        // Keep existing terrain textures
        { key: '/textures/grass.png', type: 'texture' },
        { key: '/textures/mud.png', type: 'texture' },
        { key: '/textures/road.png', type: 'texture' },
        { key: '/textures/startfinishline.png', type: 'texture' },
        { key: '/textures/stripedline.png', type: 'texture' },
        { key: '/textures/stripedlineflip.png', type: 'texture' }
    ];

    // Add element textures to preload list dynamically
    elementTexturesToPreload.forEach(elementType => {
        assetsToLoad.push({ 
            key: `/Sprites/courseelements/${elementType}.png`, 
            type: 'texture' 
        });
    });

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
    
    // Return cached texture if available and not null
    if (characterTextures.hasOwnProperty(cacheKey)) { // Check ownership explicitly
        if (characterTextures[cacheKey] instanceof THREE.Texture) {
            // console.log(`Returning cached texture for: ${cacheKey}`);
            return Promise.resolve(characterTextures[cacheKey]); // Wrap in resolved promise
        } else if (characterTextures[cacheKey] === null) {
            // console.log(`Returning null (previously failed) for: ${cacheKey}`);
            return Promise.resolve(null); // Indicate known failure
        }
        // If entry exists but isn't Texture or null, it might be a pending promise
        if (characterTextures[cacheKey] instanceof Promise) {
            // console.log(`Returning PENDING promise for: ${cacheKey}`);
            return characterTextures[cacheKey];
        }
    }

    const character = characters[characterId];
    if (!character) {
            console.error(`Invalid characterId: ${characterId}`);
        return Promise.resolve(null); // Return resolved null promise
    }

    // Use the global textureLoader
    // const textureLoader = new THREE.TextureLoader(); // <<< REMOVE: Don't create new loader
    // textureLoader.crossOrigin = 'anonymous'; // <<< REMOVE: Already set on global loader

    const texturePath = `${ASSET_BASE_URL}/${character.baseSpritePath}/${characterId}${angle}.png`.replace(/([^:]\/)\/+/g, "$1");
    console.log('Loading texture:', texturePath); // Keep log for debugging
    
    // Create and STORE the promise in the cache immediately
    const loadingPromise = new Promise((resolve) => { // No reject needed, resolve with null on error
        textureLoader.load(
            texturePath,
            (texture) => {
                texture.magFilter = THREE.NearestFilter;
                texture.minFilter = THREE.NearestFilter;
                // console.log(`Successfully loaded texture: ${texturePath}`); // Reduce success logs
                characterTextures[cacheKey] = texture; // Cache the loaded texture
                resolve(texture);
            },
            undefined,
            (err) => {
                console.error(`Failed to load texture: ${texturePath}`, err);
                characterTextures[cacheKey] = null; // Cache the failure explicitly
                
                // Try fallback textures (resolve with the promise from the fallback call)
                if (angle === 'f') {
                    console.log(`Attempting to load back texture as fallback for character ${characterId}`);
                    resolve(getCharacterTexture(characterId, 'b'));
                } else if (characterId !== 1 && angle !== 'b') { // Fallback to 'b' before falling back to char 1
                     console.log(`Attempting to load back texture as fallback before char 1 for ${characterId}`);
                     resolve(getCharacterTexture(characterId, 'b'));
                } else if (characterId !== 1) {
                    console.log(`Attempting to use character 1 as fallback for character ${characterId}`);
                    resolve(getCharacterTexture(1, angle)); 
                } else {
                    resolve(null); // Final fallback: resolve with null
                }
            }
        );
    });
    
    characterTextures[cacheKey] = loadingPromise; // Store the promise itself
    return loadingPromise;
}

// Function to preload essential character textures
function preloadCharacterTextures() {
    console.log("Preloading essential character textures...");
    Object.keys(characters).forEach(id => {
        getCharacterTexture(id, 'f'); // Preload front-facing texture
        // Optionally preload 'b' as well if needed frequently at start
        // getCharacterTexture(id, 'b');
    });
}

// Preload default textures (e.g., back view) for smoother start?
// Object.keys(characters).forEach(id => getCharacterTexture(id, 'b'));


let selectedCharacterIndex = 0;
let characterIds; // Declare globally

// --- Character Selection Logic ---

// <<< Restoring Function Definition >>>
function showCharacterSelection() {
    characterSelectionOverlay.style.display = 'flex';
    waitingScreenOverlay.style.display = 'none';
    setupCharacterSelection();
    document.addEventListener('keydown', handleCharacterSelectionInput);
}

function setupCharacterSelection() {
    console.log("Running setupCharacterSelection...");
    const characterGrid = document.getElementById('character-grid');
    console.log("Character grid element:", characterGrid);
    if (!characterGrid) { console.error("Character grid DIV not found!"); return; }
    characterGrid.innerHTML = '';
    console.log("Characters data:", characters);
    characterIds = Object.keys(characters).map(Number);
    console.log("Character IDs:", characterIds);
    
    characterIds.forEach((id, index) => {
        console.log(`[Loop ${index}] Processing character ID: ${id}`);
        const char = characters[id];
        console.log(`[Loop ${index}] Character data:`, char);
        if (!char) {
            console.error(`[Loop ${index}] Character data not found for ID: ${id}`);
            return;
        }
        
        const slot = document.createElement('div');
        slot.classList.add('character-slot');
        slot.dataset.characterId = id;
        slot.dataset.index = index;
        console.log(`[Loop ${index}] Created slot:`, slot);

        const preview = document.createElement('img');
        preview.classList.add('character-preview');
        const previewTexturePath = `${ASSET_BASE_URL}/${char.baseSpritePath}/${id}f.png`.replace(/([^:]\/)\/+/g, "$1");
        console.log(`[Loop ${index}] Preview image path:`, previewTexturePath);
        
        // Create a temporary Image object to test loading
        const tempImg = new Image();
        tempImg.onload = () => {
        preview.src = previewTexturePath;
            preview.style.backgroundColor = '';
            preview.style.border = '';
        };
        tempImg.onerror = (event) => { // Add event parameter
            console.error(`[Loop ${index}] ERROR loading preview image: ${previewTexturePath}`, event); // Log the event object
            preview.alt = `${char.name} (Image Missing)`;
           preview.style.backgroundColor = '#555';
           preview.style.border = '1px dashed white';
        };
        tempImg.src = previewTexturePath;
        
        preview.alt = char.name;
        console.log(`[Loop ${index}] Created preview image element:`, preview);
        slot.appendChild(preview);

        characterGrid.appendChild(slot);
        console.log(`[Loop ${index}] Appended slot to characterGrid.`);

        slot.addEventListener('click', () => {
            selectCharacter(index);
        });
    });
    console.log("Finished character selection loop.");
    selectCharacter(selectedCharacterIndex);
    preloadCharacterTextures(); // <<< ADD: Start preloading after setting up selection
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
                imgElement.src = `${ASSET_BASE_URL}/${characters[charId].baseSpritePath}/${charId}f.png`;
                 imgElement.onerror = () => { imgElement.style.backgroundColor = '#555'; }; // Reset error state too
             }
        }
    });
}

let rotationIntervals = {}; // Store intervals per image element to prevent conflicts
function startCharacterRotation(imgElement, characterData) {
    const intervalKey = characterData.baseSpritePath;
    stopCharacterRotation(imgElement, intervalKey);

    let currentAngleIndex = 0;
    const characterId = imgElement.parentElement.dataset.characterId;
    
    // Load the first texture
    const texturePath = `${ASSET_BASE_URL}/${characterData.baseSpritePath}/${characterId}${characterSpriteAngles[currentAngleIndex]}.png`.replace(/([^:]\/)\/+/g, "$1");
    console.log('Starting rotation with path:', texturePath);
    
    // Create a temporary Image object to test loading
    const tempImg = new Image();
    tempImg.onload = () => {
        imgElement.src = texturePath;
        imgElement.style.backgroundColor = '';
        imgElement.style.border = '';
    };
    tempImg.onerror = (event) => { // Add event parameter
        console.warn(`Initial sprite not found: ${texturePath}`, event); // Log the event object
        imgElement.style.backgroundColor = '#555';
        imgElement.style.border = '1px dashed white';
        stopCharacterRotation(imgElement, intervalKey);
    };
    tempImg.src = texturePath;

    rotationIntervals[intervalKey] = setInterval(() => {
        currentAngleIndex = (currentAngleIndex + 1) % characterSpriteAngles.length;
        const nextSrc = `${ASSET_BASE_URL}/${characterData.baseSpritePath}/${characterId}${characterSpriteAngles[currentAngleIndex]}.png`.replace(/([^:]\/)\/+/g, "$1");
        
        // Create a temporary Image object to test loading
        const nextTempImg = new Image();
        nextTempImg.onload = () => {
        imgElement.src = nextSrc;
            imgElement.style.backgroundColor = '';
            imgElement.style.border = '';
        };
        nextTempImg.onerror = (event) => { // Add event parameter
            console.warn(`Sprite not found during rotation: ${nextSrc}`, event); // Log the event object
            imgElement.style.backgroundColor = '#555';
            imgElement.style.border = '1px dashed white';
             stopCharacterRotation(imgElement, intervalKey);
        };
        nextTempImg.src = nextSrc;
    }, 150);
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
    waitingScreenOverlay.style.display = 'block'; // Show waiting screen
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

socket.on('updateGameState', (state, serverPlayers, options) => {
    console.log('Received game state update:', state, options); // Log received options
    currentGameState = state;
    players = serverPlayers || {}; // Ensure players is initialized even if empty
    
    // <<< STORE received editor tiles >>>
    if (options?.editorTiles) {
        currentCourseEditorTiles = options.editorTiles;
    } else {
        currentCourseEditorTiles = []; // Clear if not received
    }

    if (state === 'racing') {
        console.log('Racing state detected. Players:', players);
        waitingScreenOverlay.style.display = 'none'; // Hide waiting screen
        if (!raceInitialized) {
            console.log('Initializing race with options:', options); // Log options again here
            // Pass the entire options.courseData object, or an empty object if it's missing
            const courseDataToUse = options?.courseData || {}; 
            console.log('Attempting to create course with data:', courseDataToUse); // Log what's passed to createCourse
            createCourse(courseDataToUse); // Use the potentially empty object
            initializeRaceScene(players, options); // options might still be needed for start positions etc.
            raceInitialized = true;
           
    } else {
             console.log("Race already initialized, updating players only.");
              // Update players even if race was already initialized
             updatePlayerObjects(); // Use the function to add/update players
        }
        
    } else if (state === 'character-selection') {
        showCharacterSelection();
        waitingScreenOverlay.style.display = 'none';
        characterSelectionOverlay.style.display = 'block';
    }
});

socket.on('playerJoined', (playerId, playerData) => {
    console.log('Player joined:', playerId, playerData);
    players[playerId] = playerData; // Add to local cache
    // Add visual object only if the race scene is active
    if (currentGameState === 'racing' && playerData.characterId) {
        console.log('Adding player object for new player:', playerId, playerData);
         addPlayerObject(playerId, playerData);
    }
});

socket.on('playerLeft', (playerId) => {
    console.log('Player left:', playerId);
    if (playerObjects[playerId]) {
    removePlayerObject(playerId); // Remove visual object if it exists
    }
    delete players[playerId]; // Remove from local cache
});

socket.on('updatePlayerPosition', (playerId, position, rotation) => {
     // console.log(`Received updatePlayerPosition for ${playerId}`);
    if (!players[playerId]) return; // Ignore if player doesn't exist locally

     // --- RESTORED Cooldown logic --- 
     if (playerId === localPlayerId) {
         console.log("<-- Received server correction. Applying cooldown.");
         canSendUpdate = false;
         // Clear the cooldown after a short delay
         setTimeout(() => {
              console.log("Client update cooldown finished.");
              canSendUpdate = true;
         }, CLIENT_UPDATE_COOLDOWN);
     }

     // Store the received state (ground level X/Z)
     if (position) {
        // CRITICAL: Only update X and Z from server. Keep local Y (visual height) separate.
        players[playerId].position.x = position.x;
        players[playerId].position.z = position.z;
        // DO NOT update players[playerId].position.y here.
     }
     if (rotation) {
        players[playerId].rotation = rotation;
     }
    
    // Apply update directly to visual object, ensuring correct Y position
    if (playerObjects[playerId]) {
         const sprite = playerObjects[playerId];
         if (position) {
             // Apply visual position immediately, ALWAYS using calculated visual height
             const visualY = playerSpriteScale / 2; // Calculate the correct visual height
             sprite.position.set(
                 position.x, // Use X from server/update
                 visualY,    // Use calculated visual Y, ignore server Y
                 position.z  // Use Z from server/update
             );
             // console.log(`---> Applied position correction to ${playerId}: X=${position.x.toFixed(2)}, Z=${position.z.toFixed(2)}, VisualY=${visualY.toFixed(2)}`); // Log Y application
         }
         // Rotation is handled by sprite angle updates
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
    if (playerObjects[playerId]) return; // Already exists
    if (!playerData.characterId) {
        console.warn(`Player ${playerId} has no characterId, cannot create sprite.`);
             return;
        }

    const characterId = playerData.characterId;
    const initialAngleCode = 'b'; // Default to back view

    // Create fallback sprite material first
    const fallbackMaterial = new THREE.SpriteMaterial({
        color: 0x888888, // Grey fallback color
            transparent: true,
        alphaTest: 0.1
        });
    const sprite = new THREE.Sprite(fallbackMaterial);
        sprite.scale.set(playerSpriteScale, playerSpriteScale, playerSpriteScale);
        sprite.userData = { characterId: characterId, currentAngleCode: initialAngleCode };
    playerObjects[playerId] = sprite;

        if (playerData.position) {
        sprite.position.set(
            playerData.position.x,
            playerData.position.y + playerSpriteScale / 2, // Use correct height
            playerData.position.z
        );
        } else {
        sprite.position.set(0, playerSpriteScale / 2, 0); // Default position with height
             console.warn(`Player ${playerId} created without initial position.`);
        }
        scene.add(sprite);
    console.log(`Added fallback sprite for player ${playerId} (char ${characterId})`);

    // Now try to load the actual texture asynchronously
    getCharacterTexture(characterId, initialAngleCode)
        .then(texture => {
            // No need to check if playerObjects[playerId] here, promise resolves quickly if cached
            if (texture) { 
                // Only create/assign if the sprite hasn't been removed in the meantime
                const sprite = playerObjects[playerId]; 
                if(sprite) { 
                    const material = new THREE.SpriteMaterial({
                        map: texture,
                        transparent: true,
                        alphaTest: 0.1,
                    });
                    sprite.material = material; // Replace material
                    sprite.material.needsUpdate = true;
                    // console.log(`Successfully applied texture for player ${playerId} (char ${characterId})`); // Reduce logs
                }
            } else {
                // Only log if the sprite still exists
                if(playerObjects[playerId]) {
                     console.warn(`Texture resolved as null/falsy for player ${playerId} (char ${characterId}), keeping fallback.`);
                }
            }
        }); // No .catch needed here, getCharacterTexture handles errors internally by resolving null
        
    // Create visual effects (flame, particles)
    createPlayerVisualEffects(playerId, sprite);
}

function createPlayerVisualEffects(playerId, sprite) {
    // Create Boost Flame
        const boostMaterial = new THREE.SpriteMaterial({
            map: flameTextures[0],
            transparent: true,
            alphaTest: 0.1,
        depthTest: false,
        depthWrite: false
        });
        const boostFlame = new THREE.Sprite(boostMaterial);
    boostFlame.scale.set(1.0, 1.0, 1.0);
    boostFlame.position.set(0, 0.01, 0);
        boostFlame.visible = false;
    scene.add(boostFlame);

    // Create Drift Particles
    const particleCount = 40;
        const particlesGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
        particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const driftParticles = new THREE.Points(particlesGeometry, particlesMaterial);
        driftParticles.position.copy(sprite.position);
    driftParticles.position.y = 0.05;
        driftParticles.visible = false;
    scene.add(driftParticles);

        // Store visual components
        playerVisuals[playerId] = { sprite, boostFlame, driftParticles };
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
    if (!playerObjects[playerId]) return;
    const sprite = playerObjects[playerId];
    
    if (position) {
        sprite.position.set(
            position.x,
            playerSpriteScale / 2, // Visual height offset
            position.z
        );
        // Ensure the data object also reflects the latest server/local position (ground level)
        if (players[playerId]) {
            players[playerId].position = { ...position, y: 0 }; 
        }
    }
    
    if (rotation) {
        // Sprites don't rotate, but we store the data for angle calculation
        if (players[playerId]) {
             players[playerId].rotation = rotation; 
        }
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
    if (!player.position) player.position = { 
        x: playerObject.position.x, 
        y: 0, // Keep Y at 0 in the data
        z: playerObject.position.z 
    };
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
            moveVector.copy(driftMoveDirection);
        } else {
            moveVector.set(0, 0, -1).applyAxisAngle(THREE.Object3D.DEFAULT_UP, player.rotation.y);
        }

        moveVector.multiplyScalar(player.velocity);

        // Update position, keeping Y at 0 in the data
        player.position.x += moveVector.x;
        player.position.z += moveVector.z;
        positionChanged = true;
    }

    // Update the visual object with proper height
    if (positionChanged) {
        playerObject.position.set(
            player.position.x,
            playerSpriteScale / 2, // Always maintain this height for visual
            player.position.z
        );
        
        // Send update to server with ground-level position
        socket.emit('playerUpdateState', {
            position: { ...player.position, y: 0 },
            rotation: player.rotation,
            velocity: player.velocity
        });
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
// RESTORED Cooldown Logic
let canSendUpdate = true; // Flag to control sending updates
const CLIENT_UPDATE_COOLDOWN = 150; // ms to wait after receiving server correction

function sendLocalPlayerUpdate() {
    const now = Date.now();
    // Check player data existence AND cooldown flag before sending
    if (canSendUpdate && now - lastUpdateTime > updateInterval && localPlayerId && players[localPlayerId] && players[localPlayerId].position && players[localPlayerId].rotation) {
        const playerState = players[localPlayerId];
        // Send only necessary data
        const updateData = {
            position: { ...playerState.position, y: 0 }, // Ensure ground level Y is sent
            rotation: playerState.rotation,
            velocity: playerState.velocity // Send velocity too
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
            newAngleIndex = (localPlayerDriftState.direction === -1) ? 5 : 3; // 5='bl', 3='br'
        } else {
            const now = Date.now();
            if ((keyStates['a'] || keyStates['arrowleft']) && leftTurnStartTime && (now - leftTurnStartTime > TURN_SPRITE_DELAY)) {
                newAngleIndex = 5;
            } else if ((keyStates['d'] || keyStates['arrowright']) && rightTurnStartTime && (now - rightTurnStartTime > TURN_SPRITE_DELAY)) {
                newAngleIndex = 3;
            } else {
                newAngleIndex = calculateSpriteAngleIndex(sprite, playerData);
            }
        }
    } else {
        newAngleIndex = calculateSpriteAngleIndex(sprite, playerData);
    }

    const newAngleCode = characterSpriteAngles[newAngleIndex];

    if (newAngleCode !== sprite.userData.currentAngleCode) {
        const currentDesiredAngle = newAngleCode; // Store the angle we want NOW
        sprite.userData.currentAngleCode = currentDesiredAngle; // Update code immediately

        getCharacterTexture(sprite.userData.characterId, currentDesiredAngle)
            .then(newTexture => {
                // CRITICAL CHECK: Ensure the sprite still exists AND the angle we WANT is STILL the one we just loaded
                if (playerObjects[playerId] && sprite && sprite.userData.currentAngleCode === currentDesiredAngle) {
                    if (newTexture) {
                        // Avoid unnecessary updates if map is already correct (can happen with fast toggles)
                        if (sprite.material.map !== newTexture) {
            sprite.material.map = newTexture;
            sprite.material.needsUpdate = true;
                        }
                    } else {
                        console.warn(`Texture resolved as null/falsy for angle ${currentDesiredAngle} player ${playerId}`);
                        // If texture failed, consider reverting to a known good texture (like 'b')?
                        // Or just leave the current (potentially wrong angle) texture?
                        // For now, do nothing, keep the fallback or previous texture.
                    }
                }
            }); // No .catch needed
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
    console.log('Creating course with data (received):', courseData); // Log exactly what was received
    
    // Ensure courseData exists and provide defaults for missing arrays
    const safeCourseData = {
        terrain: Array.isArray(courseData?.terrain) ? courseData.terrain : [],
        road: Array.isArray(courseData?.road) ? courseData.road : [],
        obstacles: Array.isArray(courseData?.obstacles) ? courseData.obstacles : [],
        decorations: Array.isArray(courseData?.decorations) ? courseData.decorations : []
    };

    if (!courseData || (safeCourseData.terrain.length === 0 && safeCourseData.road.length === 0 && safeCourseData.obstacles.length === 0 && safeCourseData.decorations.length === 0)) {
        console.warn("Received empty or invalid course data structure. Course will be empty.");
        // We still proceed to clear old elements, but don't add new ones if data is empty.
    }

    // Clear existing course elements (ensure this works robustly)
    const objectsToRemove = [];
    scene.children.forEach(child => {
        if (child.userData && child.userData.isCourseElement) {
            objectsToRemove.push(child);
        }
    });
    objectsToRemove.forEach(child => {
        scene.remove(child);
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (child.material.map) child.material.map.dispose();
            child.material.dispose();
        }
    });
    currentCourseObjects = []; // Reset tracking array

    // Define render order offsets
    const RENDER_ORDER_TERRAIN = 0;
    const RENDER_ORDER_ROAD = 1;
    const RENDER_ORDER_STRIPE = 2; // <<< ADDED Stripe Layer
    const RENDER_ORDER_OBSTACLE = 3;
    const RENDER_ORDER_DECORATION = 4;

    const Y_OFFSET_TERRAIN = 0.00;
    const Y_OFFSET_ROAD = 0.01;
    const Y_OFFSET_STRIPE = 0.015; // <<< ADDED Stripe Y-Offset (slightly above road)
    const Y_OFFSET_OBSTACLE = 0.02;
    const Y_OFFSET_DECORATION = 0.03;

    // Define which types should be sprites vs. ground planes
    const spriteElementTypes = new Set([
        'blueblock',
        'greenblock',
        'darkgreenblock',
        'redblock',
        'yellowblock',
        'tiresred',
        'tireswhite'
        // <<< REMOVED 'startgate'
    ]);
    // <<< FIXED: Use fixed world sizes for sprites, not undefined EDITOR_TILE_SIZE >>>
    const obstacleSpriteScale = 3; // <<< REDUCED scale further again
    const decorationSpriteScale = 25; // Base scale for decoration sprites (adjust as needed)

    // --- Helper Function for Stripes --- 
    function getTileFromGrid(x, y, editorTileGrid) { // <<< Takes editor tile grid
        if (!editorTileGrid) return null;
        // Find the tile in the flat array 
        return editorTileGrid.find(t => t.x === x && t.y === y);
    }
    
    function addStripe(x, z, angle) { 
        // <<< Use REGULAR texture for BOTH orientations >>>
        // const isHorizontal = (angle === 0);
        // const stripeTextureKey = isHorizontal ? '/textures/stripedline.png' : '/textures/stripedlineflip.png'; 
        const stripeTextureKey = '/textures/stripedline.png'; // Use regular stripe for all edges
        
        const stripeTexture = textures[stripeTextureKey];
        if (!stripeTexture) {
            console.warn(`Stripe texture missing: ${stripeTextureKey}`);
            return;
        }
        // Use fixed world size for stripe geometry based on server tile size
        const TILE_WORLD_SIZE = 25; 
        const stripeWidth = TILE_WORLD_SIZE * 0.1; // Make stripe thinner relative to tile size
        const stripeLength = TILE_WORLD_SIZE;
        
        const geometry = new THREE.PlaneGeometry(stripeLength, stripeWidth); // Corrected: Length first for horizontal base
        geometry.rotateX(-Math.PI / 2); // Lay flat
        geometry.rotateY(angle); // Rotate around Y axis based on direction
        
        const material = new THREE.MeshBasicMaterial({
            map: stripeTexture,
            transparent: true,
            depthWrite: false, 
            depthTest: true, 
             polygonOffset: true, 
             polygonOffsetFactor: -1.0, // <<< Increased offset factor
             polygonOffsetUnits: -2.0 // <<< Increased offset units
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, Y_OFFSET_STRIPE, z); 
        mesh.renderOrder = RENDER_ORDER_STRIPE;
        mesh.userData = { isCourseElement: true, type: 'stripe' };
        scene.add(mesh);
        currentCourseObjects.push(mesh);
    }
    // --- End Helper --- 

    // Add terrain elements first (lowest layer)
    safeCourseData.terrain.forEach(terrain => {
        const geometry = new THREE.PlaneGeometry(terrain.width, terrain.length);
        geometry.rotateX(-Math.PI / 2);
        
        const texture = textures[`/textures/${terrain.type}.png`];
        if (!texture) {
            console.warn(`Texture not preloaded for terrain type: ${terrain.type}`);
            return; // Skip if texture is missing
        }
        
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthWrite: true, // <<< CHANGE: Terrain SHOULD write depth
            polygonOffset: true, 
            polygonOffsetFactor: -1.0, 
            polygonOffsetUnits: -4.0
        });
        
        material.map.repeat.set(
            terrain.width / 10, 
            terrain.length / 10
        );
        material.map.wrapS = material.map.wrapT = THREE.RepeatWrapping;
        material.map.needsUpdate = true; // Ensure repeat settings apply

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(terrain.x, Y_OFFSET_TERRAIN, terrain.z);
        mesh.renderOrder = RENDER_ORDER_TERRAIN;
        mesh.userData = { isCourseElement: true, type: terrain.type };
        scene.add(mesh);
        currentCourseObjects.push(mesh); // Track object
    });

    // Add road elements (on top of terrain)
    safeCourseData.road.forEach(roadSegment => {
        const geometry = new THREE.PlaneGeometry(roadSegment.width, roadSegment.length);
        geometry.rotateX(-Math.PI / 2);
        
        const texture = textures[`/textures/road.png`]; // Assuming road.png for all road
        if (!texture) {
            console.warn(`Texture not preloaded for road`);
            return;
        }

        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthWrite: true, // <<< CHANGE: Road SHOULD write depth
            polygonOffset: true,
            polygonOffsetFactor: -0.8, 
            polygonOffsetUnits: -3.0
        });

        material.map.repeat.set(
            roadSegment.width / 10, 
            roadSegment.length / 10
        );
        material.map.wrapS = material.map.wrapT = THREE.RepeatWrapping;
        material.map.needsUpdate = true;

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(roadSegment.x, Y_OFFSET_ROAD, roadSegment.z);
        mesh.renderOrder = RENDER_ORDER_ROAD;
        mesh.userData = { isCourseElement: true, type: 'road' };
        scene.add(mesh);
        currentCourseObjects.push(mesh);

        // --- Calculate Stripe Positions based on Neighbors --- 
        // Reverse calculate grid coordinates from world coordinates
        const TILE_SIZE_ON_CLIENT = 25; // Need the same scale factor used on server
        const GRID_WIDTH_ON_CLIENT = 40; 
        const GRID_HEIGHT_ON_CLIENT = 30;
        
        const xGrid = Math.round((roadSegment.x / TILE_SIZE_ON_CLIENT) + GRID_WIDTH_ON_CLIENT / 2);
        const yGrid = Math.round((roadSegment.z / TILE_SIZE_ON_CLIENT) + GRID_HEIGHT_ON_CLIENT / 2);

        const neighbors = {
            n: getTileFromGrid(xGrid, yGrid - 1, currentCourseEditorTiles),
            s: getTileFromGrid(xGrid, yGrid + 1, currentCourseEditorTiles),
            e: getTileFromGrid(xGrid + 1, yGrid, currentCourseEditorTiles),
            w: getTileFromGrid(xGrid - 1, yGrid, currentCourseEditorTiles)
        };
        
        // Check if neighbor tile is a road type from the editor data
        const isRoad = (t) => t && (t.type?.startsWith('road_') || t.type === 'startfinish');

        const halfTile = TILE_SIZE_ON_CLIENT / 2;
        
        // Add stripes based on neighbor checks
        if (!isRoad(neighbors.n)) addStripe(roadSegment.x, roadSegment.z - halfTile, 0); 
        if (!isRoad(neighbors.s)) addStripe(roadSegment.x, roadSegment.z + halfTile, 0);
        if (!isRoad(neighbors.w)) addStripe(roadSegment.x - halfTile, roadSegment.z, Math.PI / 2);
        if (!isRoad(neighbors.e)) addStripe(roadSegment.x + halfTile, roadSegment.z, Math.PI / 2);
    });

    // Add obstacles (could be ground textures like mud or sprites like blocks)
    safeCourseData.obstacles.forEach(obstacle => {
        const texturePath = `/Sprites/courseelements/${obstacle.type}.png`; 
        const texture = textures[texturePath]; // Get from preloaded textures
        if (!texture) {
            console.warn(`Texture not preloaded for obstacle type: ${obstacle.type} at path: ${texturePath}`);
            return;
        }

        let obstacleObject;

        if (spriteElementTypes.has(obstacle.type)) {
            // --- Create Sprite for Billboarding Obstacles --- 
            const material = new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                alphaTest: 0.1,
                depthTest: true,
                depthWrite: true
            });
            obstacleObject = new THREE.Sprite(material);
            obstacleObject.scale.set(obstacleSpriteScale, obstacleSpriteScale, obstacleSpriteScale);
            // <<< FIXED: Position sprite so BOTTOM is at ground offset >>>
            obstacleObject.position.set(obstacle.x, Y_OFFSET_OBSTACLE + obstacleSpriteScale / 2, obstacle.z);
            obstacleObject.renderOrder = RENDER_ORDER_OBSTACLE;
        } else {
            // --- Create Ground Plane for Non-Sprite Obstacles (like mud) --- 
            const geometry = new THREE.PlaneGeometry(obstacle.width, obstacle.length);
            geometry.rotateX(-Math.PI / 2);
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                depthWrite: false, 
                polygonOffset: true,
                polygonOffsetFactor: -0.6,
                polygonOffsetUnits: -2.0
            });
            obstacleObject = new THREE.Mesh(geometry, material);
            obstacleObject.position.set(obstacle.x, Y_OFFSET_OBSTACLE, obstacle.z);
            obstacleObject.renderOrder = RENDER_ORDER_OBSTACLE;
        }
        
        obstacleObject.userData = { isCourseElement: true, type: obstacle.type };
        scene.add(obstacleObject);
        currentCourseObjects.push(obstacleObject);
    });

    // Add decorations (could be ground like finish line or sprites like start gate)
    safeCourseData.decorations.forEach(decoration => {
        let texturePath;
        let isSprite = spriteElementTypes.has(decoration.type); // startgate is NOT in the set anymore

        if (decoration.type === 'startfinishline') { 
             texturePath = `/textures/${decoration.type}.png`;
             isSprite = false; // Finish line is ground plane
        } else { // Includes startgate now, which is NOT a sprite
             texturePath = `/Sprites/courseelements/${decoration.type}.png`;
        }

        const texture = textures[texturePath];
        if (!texture) {
            console.warn(`Texture not preloaded for decoration type: ${decoration.type} at path: ${texturePath}`);
            return;
        }

        let decorationObject;
        
        if (isSprite) {
            // --- Create Sprite for Billboarding Decorations (e.g., future items) --- 
             const material = new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                alphaTest: 0.1, 
                depthTest: true,
                depthWrite: true
            });
            decorationObject = new THREE.Sprite(material);
             // Use obstacle scale for any generic decoration sprites for now
            decorationObject.scale.set(obstacleSpriteScale, obstacleSpriteScale, obstacleSpriteScale); 
            // <<< FIXED: Position sprite so BOTTOM is at ground offset >>>
            decorationObject.position.set(decoration.x, Y_OFFSET_DECORATION + obstacleSpriteScale / 2, decoration.z);
            decorationObject.renderOrder = RENDER_ORDER_DECORATION; 
        } else {
            // --- Create Ground Plane / Static Mesh (Finish Line, Start Gate) --- 
             // Use specific size for start gate mesh, otherwise default
            const width = (decoration.type === 'startgate') ? 25 : (decoration.width || 10); 
            const height = (decoration.type === 'startgate') ? 10 : (decoration.length || 10); // Use height for vertical gate
            const length = (decoration.type === 'startgate') ? 1 : (decoration.length || 10); // Use length for depth if needed (finish line)

            let geometry;
            if (decoration.type === 'startgate') {
                // <<< FIXED: Create VERTICAL plane for start gate >>>
                geometry = new THREE.PlaneGeometry(width, height);
                // NO X rotation needed, plane is vertical by default
            } else { // Finish line or other flat decorations
                 geometry = new THREE.PlaneGeometry(width, length); 
                 geometry.rotateX(-Math.PI / 2); // Rotate flat
            }
            
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true, 
                depthWrite: (decoration.type === 'startgate'), 
                depthTest: true, 
                polygonOffset: (decoration.type !== 'startgate'), 
                polygonOffsetFactor: (decoration.type !== 'startgate') ? -0.4 : 0,
                polygonOffsetUnits: (decoration.type !== 'startgate') ? -1.0 : 0,
                side: THREE.DoubleSide // Make sure gate is visible from both sides
            });
            decorationObject = new THREE.Mesh(geometry, material);
            
            // <<< FIXED: Position gate so BOTTOM is at ground offset >>>
            const yPos = (decoration.type === 'startgate') ? Y_OFFSET_DECORATION + height / 2 : Y_OFFSET_DECORATION; 
            decorationObject.position.set(decoration.x, yPos, decoration.z);
            decorationObject.renderOrder = RENDER_ORDER_DECORATION;
        }

        if (decoration.rotation && !isSprite) { // Apply rotation only to non-sprites (meshes)
            decorationObject.rotation.y = decoration.rotation.y;
        }
        
        decorationObject.userData = { isCourseElement: true, type: decoration.type };
        scene.add(decorationObject);
        currentCourseObjects.push(decorationObject);
    });

    console.log(`Course creation completed. Added ${currentCourseObjects.length} elements.`);
}

// --- Race Initialization ---
function initializeRaceScene(initialPlayers, options) {
    console.log("Initializing race scene...");
    if (raceInitialized) { 
        cleanupRaceScene();
    }
    raceInitialized = true;
    isSceneInitialized = true;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Light sky blue

    // Enhanced lighting setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    scene.add(hemisphereLight);

    // Camera setup
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    // Enable shadows
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Setup post-processing
    composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // Load course
    console.log("Loading course data:", options?.courseData);
    if (options?.courseData) {
        createCourseFromData(options.courseData);
    } else {
        console.log("No course data provided, loading default course");
        createCourse(courseLayouts[1]);
    }

    // Add players
    console.log("Adding initial player objects:", initialPlayers);
    Object.entries(initialPlayers).forEach(([playerId, playerData]) => {
        addPlayerObject(playerId, playerData);
    });

    // Set camera for local player
    if (localPlayerId && players[localPlayerId]) {
        const localPlayer = players[localPlayerId];
        camera.position.set(
            localPlayer.position.x,
            localPlayer.position.y + 6,
            localPlayer.position.z + 6
        );
        camera.lookAt(
            localPlayer.position.x,
            localPlayer.position.y + 3.5,
            localPlayer.position.z
        );
        console.log("Initial camera set for local player", localPlayerId);
        console.log("  -> Cam Pos:", camera.position.x.toFixed(2), camera.position.y.toFixed(2), camera.position.z.toFixed(2));
        console.log("  -> LookAt:", localPlayer.position.x.toFixed(2), (localPlayer.position.y + 3.5).toFixed(2), localPlayer.position.z.toFixed(2));
    } else {
        // Default camera position for spectators
        camera.position.set(0, 10, 15);
        camera.lookAt(0, 0, 0);
        console.log("Setting default camera position (spectator/no local player).");
    }

    // Initialize effects
    initializeSharedSparkSystem(); // RENAMED FUNCTION CALL
    initializeSpeedLines();

    // Start animation loop if not already running
    if (!animationFrameId) {
        animate();
    }
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
    updateSpeedLines(); // <<< ADDED: Update speed lines

    composer.render(); // Render via EffectComposer

    // Update spark system if it exists
    if (sparkSystem) {
        updateSharedSparks(); // Use the renamed function
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
const flameYPosition = 0.1; // <<< Increased Y position slightly

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
        flameTargetPosition.y = flameYPosition; // Use defined Y offset

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

// NEW Function to create course from loaded data (already exists, just referencing)
function createCourseFromData(courseData) {
    if (!courseData) {
        console.error('No course data provided to createCourseFromData.');
        // Fallback still creates potentially empty course if layout 1 is also broken
        // return createCourse(courseLayouts[1]); 
        return createCourse({}); // Pass empty object to trigger guards
    }

    console.log('Creating course from data structure:', courseData);

    // Create course using the provided data - already passes to createCourse
    createCourse(courseData);

    return true; 
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
// REMOVED OLD DECLARATIONS
// let sparkSystem; // Line 2109
// const MAX_SPARKS = 50; // Line 2110
// let sparkParticles = []; // Line 2111
// const sparkTexturesLoaded = []; // Line 2112
// const SPARK_LIFESPAN = 300; // Line 2113

// --- Collision Handling ---
// ... existing code ...

