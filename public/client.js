import * as THREE from 'three';

// --- Basic Setup ---
const socket = io();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
// Ensure renderer preserves pixelated style if desired
renderer.setPixelRatio(window.devicePixelRatio); // Adjust for high DPI screens if needed
renderer.domElement.style.imageRendering = 'pixelated'; // CSS approach
document.getElementById('game-container').appendChild(renderer.domElement);

window.addEventListener('resize', onWindowResize, false);

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Game State ---
let currentGameState = 'character-selection'; // Renamed from gameState to avoid conflict
let players = {}; // Store player data { id: { position, rotation, characterId, ... } }
let localPlayerId = null;
let raceInitialized = false; // Track if race scene is set up

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
};

const characterSpriteAngles = ['f', 'fr', 'r', 'br', 'b', 'bl', 'l', 'fl'];
// --- Texture Loading ---
const textureLoader = new THREE.TextureLoader();
const characterTextures = {}; // Cache for loaded textures { 'charId_angle': THREE.Texture }
const flameTextures = [];
let particlesMaterial;

function preloadAssets() {
    // Preload flame textures
    for (let i = 1; i <= 7; i++) {
        const path = `/Sprites/flame/flame${i}.png`;
        flameTextures[i - 1] = textureLoader.load(
            path,
            (tex) => {
                tex.magFilter = THREE.NearestFilter;
                tex.minFilter = THREE.NearestFilter;
            },
            undefined,
            (err) => console.error(`Failed to load flame texture: ${path}`, err)
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
const characterIds = Object.keys(characters).map(Number);

// --- Character Selection Logic ---
function setupCharacterSelection() {
    characterGrid.innerHTML = ''; // Clear previous slots
    characterIds.forEach((id, index) => {
        const char = characters[id];
        const slot = document.createElement('div');
        slot.classList.add('character-slot');
        slot.dataset.characterId = id;
        slot.dataset.index = index;

        const preview = document.createElement('img'); // Using img for simplicity now
        preview.classList.add('character-preview');
        // Try loading the 'front' sprite for the selection screen preview
        const previewTexturePath = `${char.baseSpritePath}f.png`;
        preview.src = previewTexturePath;
        preview.alt = char.name;
        preview.onerror = () => { // Handle missing images gracefully
            console.warn(`Preview sprite not found: ${preview.src}`);
            preview.alt = `${char.name} (Image Missing)`;
           // Maybe display a placeholder or the name text
           preview.style.backgroundColor = '#555'; // Placeholder background
           preview.style.border = '1px dashed white';
        };
        slot.appendChild(preview);

        characterGrid.appendChild(slot);

        slot.addEventListener('click', () => {
            selectCharacter(index);
        });
    });
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

socket.on('updateGameState', (newGameState, serverPlayers) => {
    console.log("Received game state update:", newGameState, serverPlayers);
    const oldGameState = currentGameState;
    currentGameState = newGameState; // Update local state tracker
    players = serverPlayers; // Update local player state copy

    // Update UI based on state
    characterSelectionOverlay.style.display = (currentGameState === 'character-selection') ? 'flex' : 'none';
    waitingScreenOverlay.style.display = (currentGameState === 'waiting') ? 'flex' : 'none';

    if (currentGameState === 'character-selection') {
        // If transitioning back to character selection, ensure scene is cleared and loop stopped
        if (raceInitialized) {
             cleanupRaceScene();
        }
        setupCharacterSelection(); // Re-setup selection screen
        document.addEventListener('keydown', handleCharacterSelectionInput);
    } else {
        document.removeEventListener('keydown', handleCharacterSelectionInput);
         stopCharacterRotation(null, null); // Ensure rotation stops if state changes unexpectedly
    }

    if (currentGameState === 'racing') {
        // Initialize the race visuals ONLY if not already initialized
        if (!raceInitialized) {
            initializeRaceScene();
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
            initializeRaceScene(); // Initialize scene to view ongoing race
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
             playerObjects[playerId].userData.targetPosition = new THREE.Vector3(position.x, position.y + playerSpriteScale / 2, position.z);
        } else if (position) {
             // Update local player or non-lerped position directly
             players[playerId].position = position;
             updatePlayerObjectTransform(playerId, position, rotation); // Update visual immediately
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
let localPlayerDriftState = {
    state: 'none', // 'none', 'hopping', 'driftingLeft', 'driftingRight'
    direction: 0, // -1 for left, 1 for right
    startTime: 0,
    hopEndTime: 0,
    miniTurboLevel: 0, // 0: none, 1: blue, 2: orange/red
    currentSidewaysAdjustment: 0 // Added for smoothing radius changes
};

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
                 initiateDrift(turningLeft ? -1 : 1, now); // -1 left, 1 right
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
        leftTurnStartTime = 0;
    } else if (key === 'd' || key === 'arrowright') {
        rightTurnStartTime = 0;
    } else if (key === 'shift') {
        releaseDrift(); // Handle drift button release
    }
});

// Driving Physics Constants
const ACCELERATION = 0.006; // Decreased for slower ramp-up
const DECELERATION = 0.007; // DECREASED Friction slightly
const BRAKING_FORCE = 0.015;
const MAX_SPEED = 0.5; // Increased top speed
const MAX_REVERSE_SPEED = -0.1;
const TURN_SPEED_BASE = 0.025; // Base radians per frame

// Drift Physics Constants
const HOP_DURATION = 150; // ms
const DRIFT_TURN_RATE = 0.035; // How sharply the kart turns automatically during drift
const DRIFT_COUNTER_STEER_FACTOR = 0.4; // How much player input affects drift angle WHEN NOT adjusting radius (keep for now?)
const DRIFT_SIDEWAYS_FACTOR = 0.4; // INCREASED: More base sideways slide
const DRIFT_COUNTER_STEER_RADIUS_EFFECT = 25.0; // EXTREME potential effect
const DRIFT_RADIUS_LERP_FACTOR = 0.005; // DECREASED AGAIN: Very slow smoothing
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
             }
        }
         // Reset drift state
         localPlayerDriftState.state = 'none';
         localPlayerDriftState.direction = 0;
         localPlayerDriftState.startTime = 0;
         localPlayerDriftState.hopEndTime = 0;
         localPlayerDriftState.miniTurboLevel = 0;
         localPlayerDriftState.currentSidewaysAdjustment = 0; // Reset smoothed value
    } else if (localPlayerDriftState.state === 'hopping') {
         // Cancel hop if button released too early
         localPlayerDriftState.state = 'none';
         localPlayerDriftState.currentSidewaysAdjustment = 0; // Also reset here
         console.log("Hop Cancelled");
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
        const offset = new THREE.Vector3(0, 4, 8); // Base offset (Up, Back)
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
    const planeMaterial = new THREE.MeshStandardMaterial({
         map: roadTexture,
         side: THREE.DoubleSide
    });
    const plane = new THREE.Mesh(planeGeometry, planeMaterial);
    plane.rotation.x = -Math.PI / 2; 
    plane.position.y = 0; 
    plane.receiveShadow = true; 
    scene.add(plane);
    currentCourseObjects.push(plane);

    // --- Create Walls --- 
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x888888 }); // Reusable material
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
                currentCourseObjects.push(wallMesh);
            } 
            // Add else if for cylinders, custom shapes etc.
        });
    }

    // Add more course elements based on courseData (e.g., item boxes, boost pads)
}

// --- Race Initialization ---
function initializeRaceScene(receivedGameState) { 
    console.log("Initializing race scene...");
    if (raceInitialized) { 
         cleanupRaceScene();
    }
    raceInitialized = true;

    // ... (lighting setup remains the same) ...
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); 
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 15);
    directionalLight.castShadow = true;
    scene.add(directionalLight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // --- Load Course based on received data OR local selection --- 
    let courseIdToLoad = localSelectedCourseId; // Default to local selection
    
    // If we received actual state from a server, prefer that (for future use)
    if (receivedGameState && receivedGameState.race && receivedGameState.race.courseId !== undefined) {
        courseIdToLoad = receivedGameState.race.courseId;
        console.log("Loading course based on received state:", courseIdToLoad);
    } else {
        console.log("Loading course based on local selection:", courseIdToLoad);
    }

    let courseDataToLoad = courseLayouts[courseIdToLoad];
    if (!courseDataToLoad) {
         console.warn(`Course ID ${courseIdToLoad} not found in layouts, loading default Course 1.`);
         courseDataToLoad = courseLayouts[1];
    }
    createCourse(courseDataToLoad); // Pass the selected layout data

    console.log("Adding initial player objects:", players); // Use current players data
    updatePlayerObjects();
    setupInitialCameraPosition();
    updateAllSpriteAngles();
}

function setupInitialCameraPosition() {
     if (localPlayerId && players[localPlayerId] && playerObjects[localPlayerId]) {
        const playerObj = playerObjects[localPlayerId];
         const targetPosition = playerObj.position;
         const playerRotationY = players[localPlayerId].rotation?.y || 0;
         const offset = new THREE.Vector3(0, 4, 8); // Base offset
         offset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, playerRotationY); // Apply rotation
         camera.position.copy(targetPosition).add(offset);
         camera.lookAt(targetPosition.clone().add(new THREE.Vector3(0, 1.5, 0))); // Look slightly above base
         console.log(`Initial camera set for local player ${localPlayerId}`);
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
    animationFrameId = requestAnimationFrame(animate);
    frameCount++; // Increment frame counter

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

    // --- Update Visual Effects ---
    updateDriftParticles(localPlayerId); // Update local player's particles
    updateBoostFlame(localPlayerId, Date.now()); // Update local player's flame
    // TODO: Update effects for remote players based on server state if needed

    renderer.render(scene, camera);
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

    const isDrifting = (playerId === localPlayerId) && (localPlayerDriftState.state === 'driftingLeft' || localPlayerDriftState.state === 'driftingRight');

    // --- Set Particle Color based on Mini-Turbo Level ---
    if (playerId === localPlayerId) {
        const level = localPlayerDriftState.miniTurboLevel;
        let targetColor = 0xffffff; // Default: White
        if (level === 1) {
            targetColor = 0xff0000; // Level 1: Red
        } else if (level >= 2) {
            targetColor = 0x0000ff; // Level 2: Blue
        }
        // Check if color needs updating to avoid unnecessary material updates
        if (particlesMaterial.color.getHex() !== targetColor) {
             particlesMaterial.color.setHex(targetColor);
        }
    } else {
         // Ensure non-local players' potential (but invisible) particles use default if logic changes
         if (particlesMaterial.color.getHex() !== 0xffffff) {
              particlesMaterial.color.setHex(0xffffff);
         }
    }

    driftParticles.visible = isDrifting;

    if (driftParticles.visible) {
        const playerRotationY = playerData.rotation?.y || 0;

        // 1. Calculate Emitter World Position & Rotation
        particleWorldOffset.copy(particleEmitterOffset).applyAxisAngle(THREE.Object3D.DEFAULT_UP, playerRotationY);
        particleEmitterPosition.copy(playerSprite.position).add(particleWorldOffset);
        particleEmitterPosition.y = particleEmitterOffset.y; // Use the LOWERED offset Y (-0.1)
        driftParticles.position.copy(particleEmitterPosition);
        driftParticles.rotation.y = playerRotationY; // RE-ENABLED emitter rotation

        // 2. Calculate Player's World Right Vector (needed for initial spread)
        particlePlayerRight.set(1, 0, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, playerRotationY);

        // 3. Update Individual Particles (Testing inverted local axes)
        const positions = driftParticles.geometry.attributes.position.array;
        const particleSpeed = 0.1 + Math.random() * 0.1;
        const spread = 1.0; // Increased spread width
        const maxParticleDist = 2.5; // Max distance along local Z
        const velocityFactor = (playerData.velocity > 0 ? playerData.velocity / MAX_SPEED : 0.5);
        const sidewaysDriftFactor = 0.02;

        for (let i = 0; i < positions.length; i += 3) {
            // Reset based on distance along local Z (assuming it's visually forward now)
            if (positions[i+2] > maxParticleDist || Math.random() < 0.05) { // Check positive distance
                 // Reset particle: Spread local X, slightly positive initial Y (visually down?)
                 const randomSpread = (Math.random() - 0.5) * spread;
                 positions[i]   = randomSpread; // Local X
                 positions[i+1] = (Math.random() * 0.05); // Start slightly positive Y (visually down?)
                 positions[i+2] = (Math.random() - 0.5) * 0.1; // Start near Z=0
            } else {
                // Move particles "backward" (local +Z, visually backward?)
                positions[i+2] += particleSpeed * velocityFactor;

                 // Sideways drift (local X)
                 const driftAmount = localPlayerDriftState.direction * sidewaysDriftFactor * velocityFactor;
                 positions[i] += driftAmount;

                 // Add "downward" movement (local +Y, visually down?)
                 positions[i+1] += 0.01; // ADDING to Y
            }
        }
        driftParticles.geometry.attributes.position.needsUpdate = true;
    }
}

let flameAnimationIndex = 0;
let lastFlameUpdateTime = 0;
const FLAME_ANIMATION_SPEED = 50; // ms per frame
const FLAME_LOOP_START_INDEX = 4; // flame5

// Temporary vectors for calculations
const playerForwardFlame = new THREE.Vector3(0, 0, -1);
const flameTargetPosition = new THREE.Vector3();
const flameOffsetDistance = -0.6; // How far behind the player center
const flameYPosition = 0.02; // Keep flame low, slightly increased to avoid z-fighting with road

function updateBoostFlame(playerId, now) {
    if (!playerVisuals[playerId] || !players[playerId] || !playerObjects[playerId]) return;

    const { boostFlame } = playerVisuals[playerId];
    const playerSprite = playerObjects[playerId];
    const playerData = players[playerId];

    const isBoosting = (playerId === localPlayerId) && (now < boostEndTime);
    // Get the boost level that triggered this boost (stored when boost starts)
    const boostLevel = boostTriggerLevel; 

    boostFlame.visible = isBoosting;

    if (isBoosting) {
        // Calculate target position based on player's actual rotation
        const playerRotationY = playerData.rotation?.y || 0;
        playerForwardFlame.set(0, 0, -1); // Reset base forward
        playerForwardFlame.applyAxisAngle(THREE.Object3D.DEFAULT_UP, playerRotationY); // Apply player's Y rotation

        flameTargetPosition.copy(playerSprite.position); // Start at sprite center (which includes Y offset)
        flameTargetPosition.addScaledVector(playerForwardFlame, flameOffsetDistance); // Move backward along player's forward
        flameTargetPosition.y = flameYPosition; // Set fixed low Y position

        boostFlame.position.copy(flameTargetPosition);

        // --- Tint flame based on boost level ---
        let targetColor = 0xffffff; // Default: White/Yellowish flame
        if (boostLevel >= 2) {
             targetColor = 0x6666ff; // Level 2 Boost: More intense Blue Tint
        }
        if (boostFlame.material.color.getHex() !== targetColor) {
             boostFlame.material.color.setHex(targetColor);
             boostFlame.material.needsUpdate = true;
        }

        // Animate texture
        if (now - lastFlameUpdateTime > FLAME_ANIMATION_SPEED) {
            flameAnimationIndex++;
            let textureIndex;
            if (flameAnimationIndex < flameTextures.length) {
                textureIndex = flameAnimationIndex;
            } else {
                // Loop between flame5, flame6, flame7 (indices 4, 5, 6)
                const loopIndex = (flameAnimationIndex - FLAME_LOOP_START_INDEX) % (flameTextures.length - FLAME_LOOP_START_INDEX);
                textureIndex = FLAME_LOOP_START_INDEX + loopIndex;
            }

            if (flameTextures[textureIndex]) {
                boostFlame.material.map = flameTextures[textureIndex];
                boostFlame.material.needsUpdate = true;
            } else {
                 console.warn(`Missing flame texture for index: ${textureIndex}`);
            }
            lastFlameUpdateTime = now;
        }
    } else {
        // Reset color and animation when not boosting
        if (boostFlame.material.color.getHex() !== 0xffffff) {
            boostFlame.material.color.setHex(0xffffff);
            boostFlame.material.needsUpdate = true;
        }
        flameAnimationIndex = 0; 
        boostTriggerLevel = 0; // Reset the trigger level
    }
} 