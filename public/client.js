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

// --- Mobile Device Detection ---
const isMobileDevice = () => {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
           (window.innerWidth <= 800 && window.innerHeight <= 900);
};

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
    console.log('Connected to server!', socket.id);
    localPlayerId = socket.id; // Store our own ID
    
    // Ensure character selection is shown immediately on connect
    characterSelectionOverlay.style.display = 'flex';
    waitingScreenOverlay.style.display = 'none';
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

const clock = new THREE.Clock(); // Add clock initialization

let composer; // Declare composer globally

// --- Game State ---
let currentGameState = 'character-selection'; // Renamed from gameState to avoid conflict
let players = {}; // Store player data { id: { position, rotation, characterId, ... } }
let localPlayerId = null;
let raceInitialized = false; // Track if race scene is set up
let isSceneInitialized = false; // <<< ADD Declaration for this flag
let currentCourseEditorTiles = []; // <<< ADDED Declaration

// <<< ADDED: Client-side constants for grid calculation >>>
const TILE_SIZE_ON_CLIENT = 25;
const GRID_WIDTH_ON_CLIENT = 40;
const GRID_HEIGHT_ON_CLIENT = 30;

// <<< ADDED: Helper function to get ground type at position >>>
function getLocalGroundType(worldX, worldZ) {
    if (!currentCourseEditorTiles || currentCourseEditorTiles.length === 0) {
        return 'unknown'; // No tile data available
    }
    const gridX = Math.round(worldX / TILE_SIZE_ON_CLIENT + GRID_WIDTH_ON_CLIENT / 2);
    const gridY = Math.round(worldZ / TILE_SIZE_ON_CLIENT + GRID_HEIGHT_ON_CLIENT / 2); // Editor uses Y for Z-axis

    if (gridX < 0 || gridX >= GRID_WIDTH_ON_CLIENT || gridY < 0 || gridY >= GRID_HEIGHT_ON_CLIENT) {
        return 'out_of_bounds';
    }

    const tileIndex = gridY * GRID_WIDTH_ON_CLIENT + gridX;
    const groundTile = currentCourseEditorTiles[tileIndex];

    return groundTile ? groundTile.type : 'unknown';
}

// Global variable to track which course to load locally
let localSelectedCourseId = 1;

// --- DOM Elements ---
const characterSelectionOverlay = document.getElementById('character-selection');
const waitingScreenOverlay = document.getElementById('waiting-screen');
const characterGrid = document.getElementById('character-grid');
const selectedCharacterNameElement = document.getElementById('selected-character-name');
const speedometerElement = document.getElementById('speedometer'); // <<< ADDED

// --- Character Data ---
const characters = {
    1: { name: "Turbo Hank", baseSpritePath: "Sprites/characters" },
    2: { name: "Stella Vroom", baseSpritePath: "Sprites/characters" },
    3: { name: "Bongo Blitz", baseSpritePath: "Sprites/characters" },
    4: { name: "Krash Krawl", baseSpritePath: "Sprites/characters" },
    5: { name: "Kara Krawl", baseSpritePath: "Sprites/characters" },
    6: { name: "Freddy", baseSpritePath: "Sprites/characters" },
    7: { name: "Laurette", baseSpritePath: "Sprites/characters" },
    8: { name: "Fierry Farez", baseSpritePath: "Sprites/characters" },
    9: { name: "Revving Robot", baseSpritePath: "Sprites/characters" },
    10: { name: "Accelerating Agnieszka", baseSpritePath: "Sprites/characters" }
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

// Add after texture declarations
const coinTextures = []; // Array to hold coin animation frames
const glitterTextures = []; // Array to hold glitter textures
let coinSprites = new Map(); // Map to store coin sprites by ID
let playerCoins = 0; // Track local player's coin count

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

    // Add grass textures to preload list
    for (let i = 1; i <= 9; i++) {
        assetsToLoad.push({ 
            key: `/Sprites/grass/grass${i}.png`, 
            type: 'texture' 
        });
    }

    // Add mud textures to preload list
    for (let i = 1; i <= 9; i++) {
        assetsToLoad.push({ 
            key: `/Sprites/mud/mud${i}.png`, 
            type: 'texture' 
        });
    }

    // Add smoke textures to preload list
    for (let i = 1; i <= 7; i++) {
        assetsToLoad.push({ 
            key: `/Sprites/smoke/smoke${i}.png`, 
            type: 'texture' 
        });
    }

    // Add element textures to preload list dynamically
    elementTexturesToPreload.forEach(elementType => {
        assetsToLoad.push({ 
            key: `/Sprites/courseelements/${elementType}.png`, 
            type: 'texture' 
        });
    });

    // Add spark textures to preload list
    for (let i = 1; i <= 5; i++) {
        assetsToLoad.push({
            key: `/Sprites/sparks/spark${i}.png`,
            type: 'texture'
        });
    }

    // Add coin textures
    for (let i = 1; i <= 12; i++) {
        assetsToLoad.push({
            key: `/Sprites/coin/coin${i}.png`,
            type: 'texture',
            isCoin: true // Mark as coin texture
        });
    }

    // Add glitter textures
    for (let i = 1; i <= 5; i++) {
        assetsToLoad.push({
            key: `/Sprites/glitter/glitter${i}.png`,
            type: 'texture'
        });
    }

    let assetsLoaded = 0;
    const totalAssets = assetsToLoad.length + 7; // Just flame textures remaining in total

    const checkAllAssetsLoaded = () => {
        assetsLoaded++;
        console.log(`Assets loaded: ${assetsLoaded}/${totalAssets}`);
        if (assetsLoaded === totalAssets) {
            console.log("All essential assets preloaded.");
            // Sort coin textures after loading
            for (let i = 1; i <= 12; i++) {
                const coinKey = `/Sprites/coin/coin${i}.png`;
                if (textures[coinKey]) {
                    coinTextures[i-1] = textures[coinKey];
                }
            }
            console.log(`Loaded ${coinTextures.length} coin textures for animation`);
        }
    };

    // Preload all textures including sparks
    assetsToLoad.forEach(asset => {
        if (asset.type === 'texture') {
            textures[asset.key] = textureLoader.load(
                asset.key,
                (tex) => {
                    tex.magFilter = THREE.NearestFilter;
                    tex.minFilter = THREE.NearestFilter;
                    console.log(`Loaded texture: ${asset.key}`);
                    // If it's a spark texture, add it to sparkTexturesLoaded array
                    if (asset.key.includes('/sparks/spark')) {
                        sparkTexturesLoaded.push(tex);
                        console.log(`Added spark texture to sparkTexturesLoaded: ${asset.key}`);
                    }
                    checkAllAssetsLoaded();
                },
                undefined,
                (err) => {
                    console.error(`Failed to load texture: ${asset.key}`, err);
                    checkAllAssetsLoaded();
                }
            );
        }
    });

    // Preload flame textures
    for (let i = 1; i <= 7; i++) {
        const path = `/Sprites/flame/flame${i}.png`;
        flameTextures[i - 1] = textureLoader.load(
            path,
            (tex) => {
                tex.magFilter = THREE.NearestFilter;
                tex.minFilter = THREE.NearestFilter;
                checkAllAssetsLoaded();
            },
            undefined,
            (err) => {
                console.error(`Failed to load flame texture: ${path}`, err);
                checkAllAssetsLoaded();
            }
        );
    }

    // Create dust particle material
    particlesMaterial = new THREE.PointsMaterial({
         color: 0xffffff,
         size: 0.08,
         depthTest: false,
         depthWrite: false,
         transparent: true
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
    console.log("Showing character selection screen");
    
    // Hide the race scene elements if they're visible
    if (isSceneInitialized) {
        // Make the scene invisible but don't destroy it completely
        scene.visible = false;
    }
    
    // Ensure the character selection overlay is visible with flex display
    characterSelectionOverlay.style.display = 'flex';
    waitingScreenOverlay.style.display = 'none';
    
    // Hide mobile controls during character selection
    const mobileControls = document.getElementById('mobile-controls');
    mobileControls.style.display = 'none';
    
    // Show mobile select button if on mobile
    const mobileSelectBtn = document.getElementById('mobile-select-btn');
    if (mobileSelectBtn && isMobileDevice()) {
        mobileSelectBtn.style.display = 'block';
    }
    
    // Set up the character selection UI
    setupCharacterSelection();
    
    // Re-attach the keydown event listener to ensure it's active
    document.removeEventListener('keydown', handleCharacterSelectionInput);
    document.addEventListener('keydown', handleCharacterSelectionInput);
    console.log("Character selection keydown handler attached");
}

// Initialize mobile controls if on a mobile device
function initializeMobileControls() {
    const mobileControls = document.getElementById('mobile-controls');
    const mobileSelectBtn = document.getElementById('mobile-select-btn');
    
    if (isMobileDevice()) {
        console.log("Mobile device detected, initializing touch controls");
        mobileControls.style.display = 'block';
        
        // Also show the mobile character selection button
        if (mobileSelectBtn) {
            mobileSelectBtn.style.display = 'block';
            
            // Add event listener for character selection
            mobileSelectBtn.addEventListener('click', () => {
                confirmCharacterSelection();
            });
            
            mobileSelectBtn.addEventListener('touchstart', (e) => {
                e.preventDefault(); // Prevent scrolling
                confirmCharacterSelection();
            });
        }
        
        // Setup touch event listeners
        const leftBtn = document.getElementById('left-btn');
        const rightBtn = document.getElementById('right-btn');
        const driftBtn = document.getElementById('drift-btn');
        const driveBtn = document.getElementById('drive-btn');
        
        // Left button
        leftBtn.addEventListener('touchstart', (e) => {
            e.preventDefault(); // Prevent scrolling
            keyStates['arrowleft'] = true;
            leftTurnStartTime = Date.now();
        });
        
        leftBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            keyStates['arrowleft'] = false;
            leftTurnStartTime = 0;
        });
        
        // Right button
        rightBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            keyStates['arrowright'] = true;
            rightTurnStartTime = Date.now();
        });
        
        rightBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            keyStates['arrowright'] = false;
            rightTurnStartTime = 0;
        });
        
        // Drift button
        driftBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            keyStates['shift'] = true;
            const now = Date.now();
            // Check if turning when hop starts
            const turningLeft = keyStates['arrowleft'];
            const turningRight = keyStates['arrowright'];

            if (turningLeft || turningRight) {
                // Initiate Hop/Drift only if turning
                localPlayerDriftState.state = 'hopping';
                localPlayerDriftState.startTime = now;
                localPlayerDriftState.direction = turningLeft ? -1 : 1;
                localPlayerDriftState.miniTurboLevel = 0; // Reset turbo level
                // Emit drift start state
                socket.emit('playerDriftStateChange', true, localPlayerDriftState.direction);
            }
        });
        
        driftBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            keyStates['shift'] = false;
            if (localPlayerDriftState.state === 'driftingLeft' || localPlayerDriftState.state === 'driftingRight') {
                releaseDrift(); // Handle boost and state reset
            } else if (localPlayerDriftState.state === 'hopping') {
                // If shift released during hop (no drift established), just cancel
                localPlayerDriftState.state = 'none';
                localPlayerDriftState.currentSidewaysAdjustment = 0;
                console.log("Hop Cancelled");
            }
        });
        
        // Drive button
        driveBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            keyStates['w'] = true;
            keyStates['arrowup'] = true;
        });
        
        driveBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            keyStates['w'] = false;
            keyStates['arrowup'] = false;
        });
    } else {
        mobileControls.style.display = 'none';
        if (mobileSelectBtn) {
            mobileSelectBtn.style.display = 'none';
        }
    }
}

// Call this function when the game initializes
document.addEventListener('DOMContentLoaded', () => {
    initializeMobileControls();
});

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
    
    // Hide character selection screen
    characterSelectionOverlay.style.display = 'none'; 
    
    // Hide mobile select button if visible
    const mobileSelectBtn = document.getElementById('mobile-select-btn');
    if (mobileSelectBtn) {
        mobileSelectBtn.style.display = 'none';
    }
    
    // Show waiting screen
    waitingScreenOverlay.style.display = 'block'; 
    
    // Clean up character rotation animations and event listeners
    stopCharacterRotation(null, null);
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
    console.log('Received game state update:', state, options);
    
    // Store the previous state to detect transitions
    const previousState = currentGameState;
    
    // Update current state
    currentGameState = state;
    players = serverPlayers || {}; // Ensure players is initialized even if empty
    
    // Store received editor tiles
    if (options?.editorTiles) {
        currentCourseEditorTiles = options.editorTiles;
    } else {
        currentCourseEditorTiles = []; // Clear if not received
    }

    // Handle racing state
    if (state === 'racing') {
        console.log('Racing state detected. Players:', players);
        
        // Make character selection invisible
        characterSelectionOverlay.style.display = 'none';
        waitingScreenOverlay.style.display = 'none';
        
        // Hide mobile select button
        const mobileSelectBtn = document.getElementById('mobile-select-btn');
        if (mobileSelectBtn) {
            mobileSelectBtn.style.display = 'none';
        }
        
        // If scene was hidden, make it visible again
        if (isSceneInitialized && !scene.visible) {
            scene.visible = true;
        }
        
        // Check if the race needs to be initialized
        if (!isSceneInitialized) {
            console.log('Initializing race with options:', options);
            const courseDataToUse = options?.courseData || {}; 
            console.log('Creating course with data:', courseDataToUse);
            initializeRaceScene(players, options);
            
            // Ensure the proper camera view for the player
            if (localPlayerId && players[localPlayerId]) {
                setupInitialCameraPosition();
                console.log("Camera positioned for racing view");
            }
        } else {
            console.log("Race already initialized, updating players only");
            // Update players even if race was already initialized
            updatePlayerObjects();
            
            // If this is a late join, ensure camera is positioned correctly
            if (localPlayerId && players[localPlayerId] && playerObjects[localPlayerId]) {
                setupInitialCameraPosition();
                console.log("Late join - Camera positioned for racing view");
            }
        }
    } 
    // Handle character selection state
    else if (state === 'character-selection') {
        console.log('Character selection state detected');
        
        // Always show character selection again, even if we were previously in racing
        showCharacterSelection();
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

socket.on('updatePlayerPosition', (playerId, position, rotation, velocity) => { // <<< ADDED velocity parameter
     // console.log(`Received updatePlayerPosition for ${playerId}`);
    if (!players[playerId]) return; // Ignore if player doesn't exist locally

     // --- RESTORED Cooldown logic --- 
     if (playerId === localPlayerId) {
         console.log(`<-- Received server correction for pos(${position.x.toFixed(1)}, ${position.z.toFixed(1)}) rot(${rotation.y.toFixed(2)}) vel(${velocity.toFixed(2)}). Applying cooldown.`); // <<< ADDED velocity to log
         canSendUpdate = false;
         // Clear the cooldown after a short delay
         setTimeout(() => {
              console.log("Client update cooldown finished.");
              canSendUpdate = true;
         }, CLIENT_UPDATE_COOLDOWN);
     }

     // Store the received state (ground level X/Z)
     if (position) {
        // Store the ground-level position in the main player data
        players[playerId].position.x = position.x;
        players[playerId].position.z = position.z;
        // DO NOT update players[playerId].position.y here.

        // If this is a remote player, store the target position for lerping
        if (playerId !== localPlayerId && playerObjects[playerId]) {
            const visualY = playerObjects[playerId].position.y; // Keep current visual Y
            playerObjects[playerId].userData.targetPosition = new THREE.Vector3(position.x, visualY, position.z);
        }
     }
     if (rotation) {
        players[playerId].rotation = rotation;
     }
     // <<< ADDED: Apply server's velocity if this update is for the local player >>>
     if (playerId === localPlayerId && velocity !== undefined && !isNaN(velocity)) {
         players[playerId].velocity = velocity;
         console.log(`   Applied server velocity: ${velocity.toFixed(3)}`);
     } else if (playerId !== localPlayerId && velocity !== undefined && !isNaN(velocity)) {
         // Store velocity for remote players too (for effects calculation)
         players[playerId].velocity = velocity; 
     }
    
    // Apply update directly to LOCAL player's visual object, ensuring correct Y position
    if (playerId === localPlayerId && playerObjects[playerId]) {
         const sprite = playerObjects[playerId];
         if (position) {
             const visualY = playerSpriteScale / 2; // Calculate the correct visual height
             sprite.position.set(
                 position.x, // Use X from server/update
                 visualY,    // Use calculated visual Y, ignore server Y
                 position.z  // Use Z from server/update
             );
         }
    } 
    // Remote player visuals are updated via lerping in the animate loop
});

// Listener for effect state updates from the server
socket.on('updatePlayerEffectsState', (playerId, effectsState) => {
    const playerData = players[playerId];
    if (playerData) {
        Object.assign(playerData, effectsState);
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

// <<< ADDED: Off-road physics constants >>>
const OFF_ROAD_ACCELERATION = 0.002; // Significantly lower acceleration
const OFF_ROAD_MAX_SPEED = 0.2;      // Much lower top speed
const OFF_ROAD_DECELERATION = 0.015; // Higher friction off-road

// <<< ADDED: Gradual slowdown constant >>>
const OFF_ROAD_TRANSITION_DURATION_MS = 3000; // 3 seconds

// <<< ADDED: Post-boost decay constant >>>
const POST_BOOST_TRANSITION_DURATION_MS = 3000; // 3 seconds

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

// <<< ADDED: State for gradual post-boost speed decay >>>
let boostEndTimestamp = 0;
let velocityAtBoostEnd = 0;
let isPostBoostDecaying = false;

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

    // Initialize physics state if missing (moved up)
    if (player.velocity === undefined) player.velocity = 0;
    if (!player.position) player.position = { x: playerObject.position.x, y: 0, z: playerObject.position.z };
    if (!player.rotation) player.rotation = { y: 0 };

    // --- Ground Type Detection and Transition --- 
    const groundType = getLocalGroundType(player.position.x, player.position.z);
    const isCurrentlyOnRoad = !(groundType === 'grass' || groundType === 'mud');
    const isCurrentlyOffRoad = !isCurrentlyOnRoad;

    if (isCurrentlyOnRoad) {
        if (previousGroundType === 'off-road') {
            // Just returned to road
            console.log("Returned to road.");
        }
        previousGroundType = 'road';
        offRoadEntryTimestamp = 0; // Reset timestamp when back on road
    } else { // Player is off-road
        if (previousGroundType === 'road') {
            // Just entered off-road
            offRoadEntryTimestamp = now;
            console.log("Entered off-road area. Timestamp:", offRoadEntryTimestamp);
        }
        previousGroundType = 'off-road';
    }

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

    // --- Acceleration / Deceleration --- (Modified for gradual max speed and post-boost decay)
    let currentMaxSpeed; // Declare ONCE here
    let currentAcceleration = isCurrentlyOffRoad ? OFF_ROAD_ACCELERATION : ACCELERATION;
    let currentDeceleration = isCurrentlyOffRoad ? OFF_ROAD_DECELERATION : DECELERATION;

    // Determine the target max speed based SOLELY on ground type (including off-road transition)
    let targetMaxSpeed;
    if (isCurrentlyOffRoad && offRoadEntryTimestamp > 0) {
        const timeOffRoad = now - offRoadEntryTimestamp;
        const transitionProgress = Math.min(timeOffRoad / OFF_ROAD_TRANSITION_DURATION_MS, 1.0); 
        targetMaxSpeed = lerp(MAX_SPEED, OFF_ROAD_MAX_SPEED, transitionProgress);
    } else if (isCurrentlyOffRoad) {
        targetMaxSpeed = OFF_ROAD_MAX_SPEED;
    } else {
        targetMaxSpeed = MAX_SPEED;
    }

    // --- Handle Boost State and Post-Boost Decay --- 
    const wasBoosting = (boostEndTime > 0 && now >= boostEndTime); // Check if boost just ended THIS frame
    if (wasBoosting) {
        console.log("Boost ended. Starting decay.");
        isPostBoostDecaying = true;
        boostEndTimestamp = now;
        velocityAtBoostEnd = player.velocity; // Capture speed when boost ended
        boostEndTime = 0; // Reset boost end time
    }

    if (isPostBoostDecaying) {
        const timeSinceBoostEnd = now - boostEndTimestamp;
        const decayProgress = Math.min(timeSinceBoostEnd / POST_BOOST_TRANSITION_DURATION_MS, 1.0);
        
        // Interpolate from the speed when boost ended down to the current target max speed
        currentMaxSpeed = lerp(velocityAtBoostEnd, targetMaxSpeed, decayProgress);
        // Ensure we don't go below the actual target max speed
        currentMaxSpeed = Math.max(currentMaxSpeed, targetMaxSpeed);
        
        // console.log(`Post-boost decay: ${decayProgress.toFixed(2)}, Max Speed: ${currentMaxSpeed.toFixed(3)}`); // Debug log

        if (decayProgress >= 1.0) {
            console.log("Post-boost decay finished.");
            isPostBoostDecaying = false; // Decay finished
            boostEndTimestamp = 0;
            velocityAtBoostEnd = 0;
        }
    } else if (now < boostEndTime) {
        // Actively boosting - use the higher of target or boosted speed
        currentMaxSpeed = Math.max(targetMaxSpeed, MAX_SPEED + BOOST_LEVEL_2_STRENGTH);
    } else {
        // Not boosting, not decaying - just use the target speed based on ground
        currentMaxSpeed = targetMaxSpeed;
    }

    // --- Apply Movement --- 
    if (!isHopping && (keyStates['w'] || keyStates['arrowup'])) {
        player.velocity += currentAcceleration;
        player.velocity = Math.min(player.velocity, currentMaxSpeed); // Apply calculated max speed
    } else if (!isHopping && (keyStates['s'] || keyStates['arrowdown'])) {
        player.velocity -= BRAKING_FORCE;
        player.velocity = Math.max(player.velocity, MAX_REVERSE_SPEED);
    } else {
        // Apply friction/deceleration based on ground type
        if (player.velocity > 0) {
            player.velocity -= currentDeceleration;
            player.velocity = Math.max(0, player.velocity);
        } else if (player.velocity < 0) {
            player.velocity += currentDeceleration;
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
            transparent: false, // <<< CHANGED: Terrain is now opaque
            depthWrite: true, // <<< CHANGE: Terrain SHOULD write depth
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
            transparent: false, // <<< CHANGED: Road is now opaque
            depthWrite: true, // <<< CHANGE: Road SHOULD write depth
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

    // Create coins
    if (courseData.collectibles) {
        courseData.collectibles.forEach(coin => {
            createCoinSprite(coin);
        });
    }

    console.log(`Course creation completed. Added ${currentCourseObjects.length} elements.`);
}

function createCoinSprite(coin) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: coinTextures[0],
        transparent: true,
        alphaTest: 0.1,
        depthTest: true,
        depthWrite: false
    }));
    
    sprite.position.set(coin.x, 2, coin.z); // Float 2 units above ground
    sprite.scale.set(3, 3, 1); // Adjust size as needed
    sprite.renderOrder = 2; // Increased from 1 to render above track lines
    
    // Add animation properties
    sprite.userData = {
        frameIndex: 0,
        lastFrameUpdate: 0,
        frameDuration: 50, // ms per frame
        collected: false,
        coinId: coin.id
    };
    
    scene.add(sprite);
    coinSprites.set(coin.id, sprite);
    return sprite;
}

function updateCoinAnimations() {
    const now = Date.now();
    coinSprites.forEach(sprite => {
        if (sprite.userData.collected) return;
        
        if (now - sprite.userData.lastFrameUpdate > sprite.userData.frameDuration) {
            sprite.userData.frameIndex = (sprite.userData.frameIndex + 1) % 12;
            sprite.material.map = coinTextures[sprite.userData.frameIndex];
            sprite.userData.lastFrameUpdate = now;
        }
    });
}

function updateCoinCounter() {
    coinCounterElement.textContent = `Coins: ${playerCoins}`;
}

// Add to socket event handlers section
socket.on('coinCollected', (data) => {
    const { coinId, collectorId, totalCoins } = data;
    
    // Update coin counter only for the collector
    if (collectorId === localPlayerId) {
        playerCoins = totalCoins;
        updateCoinCounter();
    }
    
    const coinSprite = coinSprites.get(coinId);
    if (coinSprite && players[collectorId]) {
        // Create more glitter particles
        const glitterParticles = [];
        // Create 8 main glitter particles
        for (let i = 0; i < 8; i++) {
            glitterParticles.push(createGlitterParticle(coinSprite.position.clone(), coinSprite));
        }
        // Create 4 random "stray" glitter particles with larger radius
        for (let i = 0; i < 4; i++) {
            const strayGlitter = createGlitterParticle(coinSprite.position.clone(), coinSprite);
            strayGlitter.userData.radius *= 1.5; // Larger radius
            strayGlitter.userData.speed *= 1.2; // Faster movement
            glitterParticles.push(strayGlitter);
        }
        
        coinSprite.userData.collected = true;
        coinSprite.userData.collectionStartTime = Date.now();
        coinSprite.userData.initialScale = coinSprite.scale.x;
        coinSprite.userData.initialY = coinSprite.position.y;
        coinSprite.userData.glitterParticles = glitterParticles;
        coinSprite.userData.collectorId = collectorId;
        
        const animateCoinCollection = () => {
            const elapsed = (Date.now() - coinSprite.userData.collectionStartTime) / 1000; // seconds
            const duration = 0.5; // collection animation duration in seconds
            
            if (elapsed < duration && players[collectorId]) {
                const playerPos = players[collectorId].position;
                // Spiral around player
                const angle = elapsed * Math.PI * 4; // 2 full rotations
                const radius = 3 * (1 - elapsed / duration); // Decreasing radius from 3 to 0
                const heightGain = 3 * (elapsed / duration); // Rise up to 3 units
                
                // Update coin position relative to collector
                coinSprite.position.x = playerPos.x + Math.cos(angle) * radius;
                coinSprite.position.y = playerPos.y + 2 + heightGain; // Start 2 units above player
                coinSprite.position.z = playerPos.z + Math.sin(angle) * radius;
                
                const scale = coinSprite.userData.initialScale * (1 - elapsed / duration);
                coinSprite.scale.set(scale, scale, 1);
                
                // Update glitter particles to follow coin
                glitterParticles.forEach((glitter, index) => {
                    const particleAngle = angle + glitter.userData.offset + (glitter.userData.speed * elapsed * Math.PI * 2);
                    const particleRadius = glitter.userData.radius * (1 - elapsed / duration);
                    const heightOffset = Math.sin(elapsed * Math.PI * 4 + glitter.userData.offset) * 0.5;
                    
                    glitter.position.x = coinSprite.position.x + Math.cos(particleAngle) * particleRadius;
                    glitter.position.y = coinSprite.position.y - 0.5 + heightOffset;
                    glitter.position.z = coinSprite.position.z + Math.sin(particleAngle) * particleRadius;
                    
                    // Fade out glitter with slight randomization
                    glitter.material.opacity = (1 - (elapsed / duration)) * (0.8 + Math.sin(elapsed * 10 + glitter.userData.offset) * 0.2);
                });
                
                requestAnimationFrame(animateCoinCollection);
            } else {
                // Cleanup glitter particles
                glitterParticles.forEach(glitter => {
                    scene.remove(glitter);
                });
                
                // Hide coin immediately
                coinSprite.visible = false;
            }
        };
        
        // Store initial position for respawn
        coinSprite.userData.initialX = coinSprite.position.x;
        coinSprite.userData.initialY = coinSprite.position.y;
        coinSprite.userData.initialZ = coinSprite.position.z;
        
        animateCoinCollection();
    }
});

// Add handler for coin respawn event
socket.on('coinRespawned', (data) => {
    const { coinId } = data;
    const coinSprite = coinSprites.get(coinId);
    if (coinSprite) {
        // Reset coin position and make it visible again
        coinSprite.position.set(
            coinSprite.userData.initialX,
            coinSprite.userData.initialY,
            coinSprite.userData.initialZ
        );
        coinSprite.scale.set(
            coinSprite.userData.initialScale,
            coinSprite.userData.initialScale,
            1
        );
        coinSprite.material.opacity = 1;
        coinSprite.userData.collected = false;
        coinSprite.visible = true;
    }
});

function initializeSharedSparkSystem() { 
    console.log("Initializing Shared Spark System...");
    console.log("Number of spark textures loaded:", sparkTexturesLoaded.length);
    
    // Cache loaded spark textures (ensure textures are preloaded)
    for (let i = 1; i <= 5; i++) {
        const path = `/Sprites/sparks/spark${i}.png`;
        if (textures[path]) {
            sparkTexturesLoaded.push(textures[path]);
            console.log(`Added spark texture ${i} to sparkTexturesLoaded`);
        } else {
            console.warn(`Spark texture not preloaded: ${path}`);
        }
    }
    
    if (sparkTexturesLoaded.length === 0) {
        console.error("No spark textures loaded, cannot initialize spark system.");
        return;
    }

    const sparkGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_SPARKS * 3);
    for (let i = 0; i < MAX_SPARKS; i++) {
        positions[i * 3 + 1] = -10000; // Y position far away
    }
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    sparkGeometry.setDrawRange(0, 0); // Initially draw nothing

    const sparkMaterial = new THREE.PointsMaterial({
        size: 1.2, // Increased size for better visibility
        map: sparkTexturesLoaded[0],
        transparent: true,
        alphaTest: 0.01,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
        vertexColors: false
    });

    sparkSystem = new THREE.Points(sparkGeometry, sparkMaterial);
    sparkSystem.frustumCulled = false;
    scene.add(sparkSystem);
    console.log("Added spark system to scene");

    // Initialize particle data pool
    sparkParticles = [];
    for (let i = 0; i < MAX_SPARKS; i++) {
        sparkParticles.push({ 
            life: 0, 
            velocity: new THREE.Vector3(), 
            baseSize: 0 
        });
    }
    console.log("Initialized spark particle pool with", MAX_SPARKS, "particles");
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

    // Initialize effects
    initializeSharedSparkSystem();
    
    // Initialize smoke system
    smokeSystem = new SmokeSystem(scene);

    // Initialize ground particle systems
    grassParticleSystem = new GroundParticleSystem(scene, 'grass');
    mudParticleSystem = new GroundParticleSystem(scene, 'mud');

    // Show mobile controls if on a mobile device
    if (isMobileDevice()) {
        const mobileControls = document.getElementById('mobile-controls');
        mobileControls.style.display = 'block';
    }

    // Start animation loop if not already running
    if (!animationFrameId) {
        animate();
    }

    // Show coin counter
    coinCounterElement.style.display = 'block';
    playerCoins = 0;
    updateCoinCounter();
    
    // Initialize coin textures if not already loaded
    if (coinTextures.length === 0) {
        for (let i = 1; i <= 12; i++) {
            const coinKey = `/Sprites/coin/coin${i}.png`;
            if (textures[coinKey]) {
                coinTextures[i-1] = textures[coinKey];
            }
        }
        console.log(`Initialized ${coinTextures.length} coin textures for animation`);
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
// let localSmokeSystem = null; // REMOVED: No longer needed, using per-player systems

function animate() {
    // Loop should continue as long as race is initialized (racing or spectator)
    if (!raceInitialized) {
        animationFrameId = null; // Ensure loop stops if scene cleaned up
        return;
    };
    animationFrameId = requestAnimationFrame(animate);
    frameCount++; // Increment frame counter
    const now = Date.now(); // Get current time for effects
    const delta = clock.getDelta();

    // --- Update Remote Player Positions (Lerp) --- BEFORE calculating velocity
     for (const playerId in playerObjects) {
         if (playerId !== localPlayerId && playerObjects[playerId].userData.targetPosition) {
             const sprite = playerObjects[playerId];
             // Initialize lastPosition if it doesn't exist
             if (!sprite.userData.lastPosition) {
                 sprite.userData.lastPosition = sprite.position.clone();
             }
             sprite.position.lerp(sprite.userData.targetPosition, lerpFactor);
         }
     }

    // --- Local Player Input & Update ---
    if (currentGameState === 'racing' && localPlayerId && players[localPlayerId]) {
        handleDrivingInput();
        sendLocalPlayerUpdate();
        
        const localVelocity = players[localPlayerId].velocity;
        if (speedometerElement && localVelocity !== undefined) {
            const displaySpeed = Math.abs(localVelocity * 100).toFixed(0);
            speedometerElement.textContent = `Speed: ${displaySpeed}`;
        }
    }

    // --- Camera and Sprite Angles ---
    updateCameraPosition();
    updateAllSpriteAngles();

    // --- Update Visual Effects (Drift, Boost) for ALL players ---
    for (const playerId in playerObjects) {
        updateDriftParticles(playerId);
        updateBoostFlame(playerId, now);
    }
    
    // --- Render Scene ---
    composer.render(); // Render via EffectComposer

    // --- Update Shared Effects (Sparks) ---
    if (sparkSystem) {
        updateSharedSparks();
    }

    // --- Handle Smoke & Ground Effects for ALL Players (AFTER position updates) ---
    for (const playerId in players) {
        const player = players[playerId];
        const sprite = playerObjects[playerId];
        
        if (!player || !sprite) continue;
        
        // --- Smoke System Update & Spawning ---
        if (!player.smokeSystem && scene) {
            player.smokeSystem = new SmokeSystem(scene);
        }
        if (player.smokeSystem) {
            player.smokeSystem.update(delta);
            // (Smoke spawning logic based on movement and ground type remains here...)
            // ... existing smoke spawn logic ...
        }

        // --- Ground Particle Spawning ---
        let velocity;
        let actualDt = delta > 0 ? delta : 0.016; // Use actual delta if > 0, else fallback

        if (playerId === localPlayerId) {
            velocity = player.velocity; 
        } else {
            // Calculate velocity for remote players based on the LERPED position change
            if (sprite.userData.lastPosition) { // Ensure lastPosition exists
                const dx = sprite.position.x - sprite.userData.lastPosition.x;
                const dz = sprite.position.z - sprite.userData.lastPosition.z;
                // Avoid division by zero or tiny delta
                velocity = Math.sqrt(dx*dx + dz*dz) / actualDt; 
            }
        }
        
        // Spawn particles if moving and velocity is valid
        if (velocity && Math.abs(velocity) > 0.05) {
            const currentPosition = sprite.position; // Use interpolated position
            const groundType = getLocalGroundType(currentPosition.x, currentPosition.z);
            const isOnRoad = isPlayerOnRoad(currentPosition); // Check if on road

            if (isOnRoad && player.smokeSystem) { // << Check ON road
                // --- Spawn Smoke --- 
                const angle = player.rotation?.y || 0;
                const offsetX = Math.sin(angle) * -0.5;
                const offsetZ = Math.cos(angle) * -0.5;
                const smokePos = {
                    x: currentPosition.x + offsetX,
                    y: 0.2, // Low height
                    z: currentPosition.z + offsetZ
                };
                if (!isNaN(smokePos.x) && !isNaN(smokePos.z)) {
                    player.smokeSystem.spawnSmoke(smokePos, velocity);
                }
            } else if (!isOnRoad) { // << Check NOT on road (grass/mud)
                // --- Spawn Ground Particles ---
                if (groundType === 'grass' && grassParticleSystem) {
                    grassParticleSystem.spawnParticles(currentPosition, playerId, velocity);
                } else if (groundType === 'mud' && mudParticleSystem) {
                    mudParticleSystem.spawnParticles(currentPosition, playerId, velocity);
                }
            }
        }
        
        // --- IMPORTANT: Update lastPosition AFTER using it for velocity calc ---
        if (playerId !== localPlayerId) {
            sprite.userData.lastPosition = sprite.position.clone();
        }
    }

    // Update ground particle systems (lifetime, movement, etc.)
    if (grassParticleSystem) {
        grassParticleSystem.update(delta);
    }
    if (mudParticleSystem) {
        mudParticleSystem.update(delta);
    }

    updateCoinAnimations();
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
    
    // Clean up local smoke system
    if (localSmokeSystem) {
        localSmokeSystem.clear();
        localSmokeSystem = null;
        console.log("Cleared local smoke system");
    }
    
    // Clear all player objects and their smoke systems
    for (const playerId in playerObjects) {
        // Clean up smoke systems
        if (players[playerId] && players[playerId].smokeSystem) {
            players[playerId].smokeSystem.clear();
            players[playerId].smokeSystem = null;
        }
        removePlayerObject(playerId); // Use existing function to remove visuals
    }
    players = {}; // Clear player data cache
    playerObjects = {}; // Ensure visual object references are cleared
    playerVisuals = {}; // Ensure visual components references are cleared

    // Remove course objects 
    // Fallback: Remove meshes/sprites potentially added by createCourseFromData or createCourse
    // ... existing code ...

    if (grassParticleSystem) {
        grassParticleSystem.clear();
        grassParticleSystem = null;
    }
    
    if (mudParticleSystem) {
        mudParticleSystem.clear();
        mudParticleSystem = null;
    }

    // Hide coin counter and reset coins
    coinCounterElement.style.display = 'none';
    playerCoins = 0;
    
    // Clear coin sprites
    coinSprites.forEach(sprite => {
        scene.remove(sprite);
    });
    coinSprites.clear();
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

// --- RENAMED Shared Spark System --- 
let sparkSystem; // THREE.Points object
const MAX_SPARKS = 1000; 
const SPARK_LIFESPAN = 600; 
let sparkParticles = []; 
const sparkTexturesLoaded = []; 

// MOVED Function Definition UP

// RENAMED and MODIFIED Function (Remains here)
function createSparksAtPoint(origin, intensity = 0.5, range = 1.0) {
    if (!sparkSystem || sparkTexturesLoaded.length === 0) {
        console.error('Cannot create sparks - system not initialized');
        return;
    }

    const positions = sparkSystem.geometry.attributes.position;
    const numSparks = 1; // Always spawn exactly 1 spark
    
    for (let i = 0; i < numSparks; i++) {
        let particleIndex = -1;
        for (let j = 0; j < MAX_SPARKS; j++) {
            if (sparkParticles[j].life <= 0) {
                particleIndex = j;
                break;
            }
        }
        if (particleIndex === -1) continue;

        const particle = sparkParticles[particleIndex];
        particle.life = SPARK_LIFESPAN * 0.6; // Restored to 0.6 for longer duration
        
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.05 + Math.random() * 0.1 * intensity; // Increased speed
        particle.velocity.set(
            Math.cos(angle) * speed * range * 0.8, // Increased spread to 0.8
            0.06 + Math.random() * 0.1 * intensity, // Increased upward velocity
            Math.sin(angle) * speed * range * 0.8  // Increased spread to 0.8
        );

        positions.array[particleIndex * 3] = origin.x;
        positions.array[particleIndex * 3 + 1] = origin.y;
        positions.array[particleIndex * 3 + 2] = origin.z;
    }

    positions.needsUpdate = true;
    sparkSystem.geometry.setDrawRange(0, MAX_SPARKS);
}

// Update the collision event handler
socket.on('playerCollision', (collisionPoint) => {
    if (!sparkSystem || sparkTexturesLoaded.length === 0) {
        console.error('Spark system not ready! sparkSystem:', !!sparkSystem, 'textures loaded:', sparkTexturesLoaded.length);
        return;
    }
    const randomOffset = {
        x: (Math.random() - 0.5) * 0.25, // Increased from 0.15 to 0.25
        y: 0,
        z: (Math.random() - 0.5) * 0.25  // Increased from 0.15 to 0.25
    };
    const sparkPoint = {
        x: collisionPoint.x + randomOffset.x,
        y: collisionPoint.y + 0.7, // Increased from 0.5 to 0.7
        z: collisionPoint.z + randomOffset.z
    };
    createSparksAtPoint(sparkPoint, 0.6, 0.9); // Increased intensity from 0.4 to 0.6, range from 0.6 to 0.9
});

function updateSharedSparks() {
    if (!sparkSystem) return;

    const positions = sparkSystem.geometry.attributes.position;
    let activeCount = 0;

    for (let i = 0; i < MAX_SPARKS; i++) {
        const particle = sparkParticles[i];
        if (particle.life > 0) {
            positions.array[i * 3] += particle.velocity.x;
            positions.array[i * 3 + 1] += particle.velocity.y;
            positions.array[i * 3 + 2] += particle.velocity.z;

            // Increased gravity effect for faster falloff
            particle.velocity.y -= 0.008; // Increased from 0.005 to 0.008

            particle.life--;
            activeCount++;
        } else {
            positions.array[i * 3 + 1] = -10000;
        }
    }

    positions.needsUpdate = true;
    sparkSystem.geometry.setDrawRange(0, activeCount);
}

// Smoke particle system
class SmokeParticle {
    constructor(position, texture) {
        // Validate position
        if (!position || typeof position.x !== 'number' || typeof position.z !== 'number' ||
            isNaN(position.x) || isNaN(position.z)) {
            console.error('Invalid position for smoke particle:', position);
            position = { x: 0, y: 1, z: 0 }; // Fallback to avoid errors
        }
    
        // Create a smaller particle
        const size = 0.8 + Math.random() * 0.4; // Reduced size significantly
        const geometry = new THREE.PlaneGeometry(size, size);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: 0.7, // Slightly reduced opacity
            depthWrite: false, 
            depthTest: true,
            blending: THREE.NormalBlending,
            side: THREE.DoubleSide
        });
        
        this.mesh = new THREE.Mesh(geometry, material);
        
        // Position directly without using Vector3 methods
        const x = position.x;
        const y = typeof position.y === 'number' ? position.y : 0.2; // Lower default height
        const z = position.z;
        
        // Set position explicitly
        this.mesh.position.set(x, y, z);
        
        // Lower height (just 0.2 units above ground)
        if (this.mesh.position.y > 0.3) {
            this.mesh.position.y = 0.2;
        }
        
        this.mesh.rotation.z = Math.random() * Math.PI * 2;
        this.mesh.renderOrder = 10;
        
        // Make particle always face camera (billboarding)
        this.mesh.userData.isBillboard = true;
        
        this.velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 0.03, // Less horizontal movement
            0.03 + Math.random() * 0.04,  // Less upward movement
            (Math.random() - 0.5) * 0.03  // Less horizontal movement
        );
        
        this.life = 1.0;
        this.fadeSpeed = 0.3 + Math.random() * 0.2; // Slightly faster fade
        
        console.log("Created smoke particle at", x.toFixed(2), z.toFixed(2), "with size", size.toFixed(2));
    }
    
    update(delta) {
        this.life -= this.fadeSpeed * delta;
        this.mesh.position.add(this.velocity.clone().multiplyScalar(delta * 60));
        
        // Scale up slightly as it rises
        const scale = 1.0 + (1.0 - this.life) * 0.5;
        this.mesh.scale.set(scale, scale, scale);
        
        this.mesh.material.opacity = this.life * 0.8;
        this.mesh.rotation.z += delta * 0.2;
        
        // Make particle always face camera (billboarding)
        if (this.mesh.userData.isBillboard && camera) {
            this.mesh.quaternion.copy(camera.quaternion);
        }
        
        return this.life > 0;
    }
}

class SmokeSystem {
    constructor(scene) {
        this.scene = scene;
        this.particles = [];
        this.lastSpawnTime = 0;
        this.spawnInterval = 100; // Milliseconds between spawns
        
        // Cache smoke textures
        this.smokeTextures = [];
        for (let i = 1; i <= 7; i++) {
            const texturePath = `/Sprites/smoke/smoke${i}.png`;
            if (textures[texturePath]) {
                console.log(`Found smoke texture: ${texturePath}`);
                this.smokeTextures.push(textures[texturePath]);
            } else {
                console.warn(`Missing smoke texture: ${texturePath}`);
            }
        }
        
        console.log(`SmokeSystem: Loaded ${this.smokeTextures.length} smoke textures.`);
        
        if (this.smokeTextures.length === 0) {
            console.error('No smoke textures loaded! Smoke will not be visible.');
        }
    }
    
    spawnSmoke(position, velocity) {
        if (this.smokeTextures.length === 0) {
            console.warn('Cannot spawn smoke: No textures loaded.');
            return;
        }
        
        // Validate position values
        if (!position || 
            typeof position.x !== 'number' || 
            typeof position.z !== 'number' ||
            isNaN(position.x) || 
            isNaN(position.z)) {
            console.error('Invalid position for smoke:', position);
            return;
        }
        
        const now = Date.now();
        if (now - this.lastSpawnTime < this.spawnInterval) return;
        
        this.lastSpawnTime = now;
        
        // Use direct coordinates rather than Vector3
        const x = position.x;
        const y = typeof position.y === 'number' ? position.y : 0.5;
        const z = position.z;
        
        // Spawn a burst of 2-3 particles
        const numParticles = 2 + Math.floor(Math.random() * 2);
        console.log(`Spawning ${numParticles} smoke particles at ${x.toFixed(2)}, ${z.toFixed(2)}`);
        
        for (let i = 0; i < numParticles; i++) {
            // Simple offset calculation without Vector3
            const offsetX = (Math.random() - 0.5) * 0.5;
            const offsetY = (Math.random() - 0.5) * 0.1;
            const offsetZ = (Math.random() - 0.5) * 0.5;
            
            // Position with offsets
            const particlePos = {
                x: x + offsetX,
                y: y + offsetY,
                z: z + offsetZ
            };
            
            const texture = this.smokeTextures[Math.floor(Math.random() * this.smokeTextures.length)];
            const particle = new SmokeParticle(particlePos, texture);
            this.scene.add(particle.mesh);
            this.particles.push(particle);
        }
    }
    
    update(delta) {
        // Update existing particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const particle = this.particles[i];
            const isAlive = particle.update(delta);
            
            if (!isAlive) {
                this.scene.remove(particle.mesh);
                if (particle.mesh.material) {
                    particle.mesh.material.dispose();
                }
                if (particle.mesh.geometry) {
                    particle.mesh.geometry.dispose();
                }
                this.particles.splice(i, 1);
            }
        }
    }
    
    clear() {
        for (const particle of this.particles) {
            this.scene.remove(particle.mesh);
            if (particle.mesh.material) {
                particle.mesh.material.dispose();
            }
            if (particle.mesh.geometry) {
                particle.mesh.geometry.dispose();
            }
        }
        this.particles = [];
    }
}

let smokeSystem;

// Helper function to get tile from grid coordinates
function getTileFromGrid(x, y, editorTileGrid) {
    if (!editorTileGrid || !Array.isArray(editorTileGrid)) return null;
    // Find the tile in the flat array 
    return editorTileGrid.find(t => t.x === x && t.y === y);
}

// Add helper function to check if player is on road
function isPlayerOnRoad(position) {
    if (!position) {
        console.warn("isPlayerOnRoad called with null position");
        return false;
    }
    
    if (!currentCourseEditorTiles || !Array.isArray(currentCourseEditorTiles) || currentCourseEditorTiles.length === 0) {
        console.warn("isPlayerOnRoad: No course data available");
        return true; // Default to true if we can't check
    }
    
    // Convert world position to grid coordinates
    const gridX = Math.round(position.x / TILE_SIZE_ON_CLIENT + GRID_WIDTH_ON_CLIENT / 2);
    const gridY = Math.round(position.z / TILE_SIZE_ON_CLIENT + GRID_HEIGHT_ON_CLIENT / 2);
    
    // Check bounds
    if (gridX < 0 || gridX >= GRID_WIDTH_ON_CLIENT || gridY < 0 || gridY >= GRID_HEIGHT_ON_CLIENT) {
        // console.log(`Position out of bounds: (${position.x.toFixed(1)}, ${position.z.toFixed(1)}) -> Grid(${gridX}, ${gridY})`);
        return false;
    }
    
    // Find tile at this grid position
    const tileIndex = gridY * GRID_WIDTH_ON_CLIENT + gridX;
    const tile = currentCourseEditorTiles[tileIndex];
    
    if (!tile) {
        console.warn(`No tile data at grid position (${gridX}, ${gridY})`);
        return false;
    }
    
    // Check if this is a road or startfinish tile
    const isRoadTile = tile.type && (
        tile.type.startsWith('road') || 
        tile.type === 'startfinish' ||
        tile.type === 'road_h' ||
        tile.type === 'road_v' ||
        tile.type === 'road_ne' ||
        tile.type === 'road_nw' ||
        tile.type === 'road_se' ||
        tile.type === 'road_sw'
    );
    
    // For debugging
    if (frameCount % 30 === 0) { // Only log every 30 frames to avoid spam
        console.log(`Tile at (${position.x.toFixed(1)}, ${position.z.toFixed(1)}) -> Grid(${gridX}, ${gridY}) = ${tile.type} (isRoad: ${isRoadTile})`);
    }
    
    return isRoadTile;
}

// <<< ADDED: Lerp function >>>
function lerp(start, end, t) {
    return start * (1 - t) + end * t;
}

// <<< ADDED: State for gradual off-road transition >>>
let previousGroundType = 'road'; // Assume starting on road
let offRoadEntryTimestamp = 0;

// Handle joining an in-progress race
socket.on('playerJoinedRace', (data) => {
    // Show a notification that player joined an in-progress race
    console.log("Joined race in progress:", data.message);
    
    // Optionally show a UI notification to the player
    const notification = document.createElement('div');
    notification.className = 'race-notification';
    notification.textContent = data.message;
    notification.style.position = 'absolute';
    notification.style.top = '20%';
    notification.style.left = '50%';
    notification.style.transform = 'translate(-50%, -50%)';
    notification.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    notification.style.color = 'white';
    notification.style.padding = '10px 20px';
    notification.style.borderRadius = '5px';
    notification.style.zIndex = '1000';
    notification.style.fontWeight = 'bold';
    
    document.body.appendChild(notification);
    
    // Remove notification after a few seconds
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 1s';
        setTimeout(() => {
            notification.remove();
        }, 1000);
    }, 5000);
});

// Listen for player driving effects (e.g., smoke)

// ... existing code ...
// --- Socket Event Handlers ---
socket.on('playerCollision', (collisionPoint) => {
    // Create 3 random sparks at the collision point
    for (let i = 0; i < 3; i++) {
        const sparkIndex = Math.floor(Math.random() * 5) + 1; // Random number between 1 and 5
        const sparkTexture = textures[`/Sprites/sparks/spark${sparkIndex}.png`];
        if (sparkTexture) {
            createSparksAtPoint(collisionPoint, 1.0, 2.0);
        }
    }
});

// --- Race Initialization ---
// ... existing code ...

// Add after SmokeSystem class
class GroundParticle {
    constructor(position, texture, type) {
        if (!position || typeof position.x !== 'number' || typeof position.z !== 'number' ||
            isNaN(position.x) || isNaN(position.z)) {
            console.error('Invalid position for ground particle:', position);
            position = { x: 0, y: 0.1, z: 0 };
        }
    
        // Increase size for better visibility
        const size = 1.0 + Math.random() * 0.5;
        const geometry = new THREE.PlaneGeometry(size, size);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: 0.8,
            depthWrite: false,
            depthTest: true,
            blending: THREE.NormalBlending,
            side: THREE.DoubleSide
        });
        
        this.mesh = new THREE.Mesh(geometry, material);
        const x = position.x;
        const y = typeof position.y === 'number' ? position.y : 0.1;
        const z = position.z;
        
        this.mesh.position.set(x, y, z);
        
        // Make particles face the camera
        this.mesh.userData.isBillboard = true;
        
        // Slower movement for ground particles
        this.velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 0.1, // Increased spread
            0.05 + Math.random() * 0.05, // Small upward velocity
            (Math.random() - 0.5) * 0.1  // Increased spread
        );
        
        this.life = 1.0;
        this.fadeSpeed = 0.8 + Math.random() * 0.4; // Faster fade
        
        // Add random rotation
        this.rotationSpeed = (Math.random() - 0.5) * 2;
        this.mesh.rotation.z = Math.random() * Math.PI * 2;
    }
    
    update(delta) {
        this.life -= this.fadeSpeed * delta;
        this.mesh.position.add(this.velocity.clone().multiplyScalar(delta * 60));
        
        // Update rotation
        this.mesh.rotation.z += this.rotationSpeed * delta;
        
        // Make particle always face camera
        if (this.mesh.userData.isBillboard && camera) {
            this.mesh.quaternion.copy(camera.quaternion);
        }
        
        // Scale down as it fades
        const scale = this.life * 0.8 + 0.2;
        this.mesh.scale.set(scale, scale, scale);
        
        this.mesh.material.opacity = this.life;
        return this.life > 0;
    }
}

class GroundParticleSystem {
    constructor(scene, type) {
        this.scene = scene;
        this.type = type; // 'grass' or 'mud'
        this.particles = [];
        this.lastSpawnTimes = {}; // Track last spawn time per player
        this.baseSpawnInterval = 400; // Base interval of 400ms
        this.fastSpawnInterval = 200; // Fast interval of 200ms
        this.speedThreshold = 40; // Speed threshold for faster spawning
        
        // Cache textures
        this.textures = [];
        for (let i = 1; i <= 9; i++) {
            const texturePath = `/Sprites/${type}/${type}${i}.png`;
            if (textures[texturePath]) {
                const texture = textures[texturePath];
                // Set texture properties
                texture.magFilter = THREE.NearestFilter;
                texture.minFilter = THREE.NearestFilter;
                texture.encoding = THREE.sRGBEncoding;
                this.textures.push(texture);
                console.log(`[${type}] Loaded texture: ${texturePath}`);
            } else {
                console.warn(`[${type}] Missing texture: ${texturePath}`);
            }
        }
        
        console.log(`[${type}] GroundParticleSystem initialized with ${this.textures.length} textures`);
    }
    
    spawnParticles(position, playerId, velocity) {
        if (this.textures.length === 0) {
            console.warn(`[${this.type}] Cannot spawn particles: No textures loaded`);
            return;
        }
        
        const now = Date.now();
        if (!this.lastSpawnTimes[playerId]) {
            this.lastSpawnTimes[playerId] = 0;
        }

        // Determine spawn interval based on velocity
        const speed = Math.abs(velocity);
        const spawnInterval = speed > this.speedThreshold ? this.fastSpawnInterval : this.baseSpawnInterval;
        
        if (now - this.lastSpawnTimes[playerId] < spawnInterval) {
            return;
        }
        
        this.lastSpawnTimes[playerId] = now;
        
        // Spawn 3-5 particles
        const numParticles = 3 + Math.floor(Math.random() * 3);
        
        for (let i = 0; i < numParticles; i++) {
            // Spawn around the wheels with more spread
            const side = i % 2 === 0 ? 1 : -1; // Alternate sides for wheels
            const front = i < 2 ? 0.5 : -0.5; // Front and back wheels
            
            const offsetX = side * 0.8 + (Math.random() - 0.5) * 0.4;
            const offsetZ = front + (Math.random() - 0.5) * 0.4;
            
            const particlePos = {
                x: position.x + offsetX,
                y: 0.1,
                z: position.z + offsetZ
            };
            
            const texture = this.textures[Math.floor(Math.random() * this.textures.length)];
            const particle = new GroundParticle(particlePos, texture, this.type);
            this.scene.add(particle.mesh);
            this.particles.push(particle);
        }
    }
    
    update(delta) {
        let activeCount = 0;
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const particle = this.particles[i];
            const isAlive = particle.update(delta);
            
            if (!isAlive) {
                this.scene.remove(particle.mesh);
                if (particle.mesh.material) {
                    particle.mesh.material.dispose();
                }
                if (particle.mesh.geometry) {
                    particle.mesh.geometry.dispose();
                }
                this.particles.splice(i, 1);
            } else {
                activeCount++;
            }
        }
        if (activeCount > 0) {
            console.log(`[${this.type}] Active particles: ${activeCount}`);
        }
    }
    
    clear() {
        console.log(`[${this.type}] Clearing ${this.particles.length} particles`);
        for (const particle of this.particles) {
            this.scene.remove(particle.mesh);
            if (particle.mesh.material) {
                particle.mesh.material.dispose();
            }
            if (particle.mesh.geometry) {
                particle.mesh.geometry.dispose();
            }
        }
        this.particles = [];
    }
}

// Add after other system declarations
let grassParticleSystem;
let mudParticleSystem;

// Add after the DOM Elements section
const coinCounterElement = document.createElement('div');
coinCounterElement.id = 'coin-counter';
coinCounterElement.style.position = 'fixed';
coinCounterElement.style.top = '20px';
coinCounterElement.style.right = '20px';
coinCounterElement.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
coinCounterElement.style.color = 'gold';
coinCounterElement.style.padding = '10px';
coinCounterElement.style.borderRadius = '5px';
coinCounterElement.style.fontFamily = 'Arial, sans-serif';
coinCounterElement.style.fontSize = '20px';
coinCounterElement.style.display = 'none';
document.body.appendChild(coinCounterElement);

// Add glitter particle system
function createGlitterParticle(position, parentSprite) {
    const glitterIndex = Math.floor(Math.random() * 5);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: textures[`/Sprites/glitter/glitter${glitterIndex + 1}.png`],
        transparent: true,
        alphaTest: 0.1,
        depthTest: true,
        depthWrite: false
    }));
    
    sprite.scale.set(1.5, 1.5, 1);
    sprite.position.copy(position);
    sprite.userData = {
        offset: Math.random() * Math.PI * 2,
        speed: 0.05 + Math.random() * 0.05,
        radius: 1 + Math.random(),
        parent: parentSprite,
        age: 0
    };
    
    scene.add(sprite);
    return sprite;
}


