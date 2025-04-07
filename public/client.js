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

// --- Helper Function for Grid Tile Detection ---
function getTileFromGrid(x, y, editorTileGrid) {
    if (!editorTileGrid) return null;
    // Find the tile in the flat array 
    return editorTileGrid.find(t => t.x === x && t.y === y);
}

// --- Game State ---
let currentGameState = 'character-selection'; // Renamed from gameState to avoid conflict
let players = {}; // Store player data { id: { position, rotation, characterId, ... } }
let localPlayerId = null;
let raceInitialized = false; // Track if race scene is set up
let isSceneInitialized = false; // <<< ADD Declaration for this flag
let currentCourseEditorTiles = []; // <<< ADDED Declaration
let courseData = {}; // Add global courseData variable

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
const smokeTextures = []; // Add array for smoke textures

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

    // Preload smoke textures
    for (let i = 1; i <= 7; i++) {
        const path = `/Sprites/smoke/smoke${i}.png`;
        smokeTextures[i - 1] = textureLoader.load(
            path,
            (tex) => {
                tex.magFilter = THREE.NearestFilter;
                tex.minFilter = THREE.NearestFilter;
            },
            undefined,
            (err) => console.error(`Failed to load smoke texture: ${path}`, err)
        );
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
        
    // Create visual effects (flame, particles, smoke)
    createPlayerVisualEffects(playerId, sprite);
}
