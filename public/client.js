import * as THREE from 'three';

// --- Basic Setup ---
const socket = io({ path: "/socket.io" });
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
const playerSpriteScale = 2; // Adjust scale of sprites as needed

function addPlayerObject(playerId, playerData) {
    if (!playerObjects[playerId] && playerData.characterId) { // Ensure character is selected
        const characterId = playerData.characterId;
        // Start with 'b' view or calculate initial angle? Let's start with 'b'.
        const initialAngleCode = 'b';
        const texture = getCharacterTexture(characterId, initialAngleCode);

        if (!texture) {
             console.error(`Cannot create sprite for player ${playerId}, texture not loaded/failed for char ${characterId}`);
             return; // Don't add object if texture is missing
        }

        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true, // Needed for PNG transparency
            alphaTest: 0.1,    // Adjust if needed to clip transparent edges
            // sizeAttenuation: false // Optional: make sprite size fixed regardless of distance
        });
        // material.map.needsUpdate = true; // No need, happens on load/get

        const sprite = new THREE.Sprite(material);
        sprite.scale.set(playerSpriteScale, playerSpriteScale, playerSpriteScale);
        // Store characterId for easy access during angle updates
        sprite.userData = { characterId: characterId, currentAngleCode: initialAngleCode };


        // Set initial position based on playerData received from server (start position)
        if (playerData.position) {
            sprite.position.set(playerData.position.x, playerData.position.y + playerSpriteScale / 2, playerData.position.z);
        } else {
             sprite.position.set(0, playerSpriteScale / 2, 0);
             console.warn(`Player ${playerId} created without initial position.`);
        }

        playerObjects[playerId] = sprite;
        scene.add(sprite);
        console.log(`Added player sprite for: ${playerId} with char ${characterId}`);

        // Calculate initial sprite angle immediately after adding
        updatePlayerSpriteAngle(playerId, sprite, playerData);

    } else if (!playerData.characterId) {
         console.warn(`Player ${playerId} has no characterId, cannot create sprite.`);
    }
}


function removePlayerObject(playerId) {
    if (playerObjects[playerId]) {
        const sprite = playerObjects[playerId];
        scene.remove(sprite);
        if (sprite.material) {
             // Don't dispose map texture (cached)
             sprite.material.dispose();
        }
        delete playerObjects[playerId];
        console.log("Removed player object for:", playerId);
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

function updatePlayerSpriteAngle(playerId, sprite, playerData) {
    if (!sprite || !sprite.userData || !playerData) return;

    const newAngleIndex = calculateSpriteAngleIndex(sprite, playerData);
    const newAngleCode = characterSpriteAngles[newAngleIndex];

    // Only update texture if the angle code has changed
    if (newAngleCode !== sprite.userData.currentAngleCode) {
        const newTexture = getCharacterTexture(sprite.userData.characterId, newAngleCode);
        if (newTexture && sprite.material.map !== newTexture) {
            sprite.material.map = newTexture;
            sprite.material.needsUpdate = true;
            sprite.userData.currentAngleCode = newAngleCode;
            // console.log(`Player ${playerId} changed angle to ${newAngleCode} (${newAngleIndex})`);
        } else if (!newTexture) {
             console.warn(`Failed to get texture for angle ${newAngleCode} for player ${playerId}`);
        }
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


// --- Course Setup (Placeholders) ---
let currentCourseObjects = []; // Keep track of course objects for cleanup
function createCourse(courseId) {
    // TODO: Define 5 simple courses
    // For now, just a flat plane as Course 1
    console.log(`Creating course ${courseId}`);
    const planeGeometry = new THREE.PlaneGeometry(100, 200); // Example size
    const planeMaterial = new THREE.MeshStandardMaterial({ color: 0x55aa55, side: THREE.DoubleSide }); // Use StandardMaterial for lighting
    const plane = new THREE.Mesh(planeGeometry, planeMaterial);
    plane.rotation.x = -Math.PI / 2; // Rotate to be horizontal
    plane.position.y = 0; // Set plane at ground level
    plane.receiveShadow = true; // Allow ground to receive shadows
    scene.add(plane);
    currentCourseObjects.push(plane); // Track for cleanup

    // Add some simple boundaries?
    const wallHeight = 3;
    const wallThickness = 1;
    const wallMaterial = new THREE.MeshStandardMaterial({color: 0x888888}); // Use StandardMaterial
    const wallLeftGeo = new THREE.BoxGeometry(wallThickness, wallHeight, 200);
    const wallLeft = new THREE.Mesh(wallLeftGeo, wallMaterial);
    wallLeft.position.set(-50 - wallThickness/2, wallHeight/2, 0);
    wallLeft.castShadow = true;
    wallLeft.receiveShadow = true;
    scene.add(wallLeft);
    currentCourseObjects.push(wallLeft);

    const wallRightGeo = new THREE.BoxGeometry(wallThickness, wallHeight, 200);
    const wallRight = new THREE.Mesh(wallRightGeo, wallMaterial);
    wallRight.position.set(50 + wallThickness/2, wallHeight/2, 0);
    wallRight.castShadow = true;
    wallRight.receiveShadow = true;
    scene.add(wallRight);
    currentCourseObjects.push(wallRight);

     // Add more course elements here based on courseId
}

function cleanupRaceScene() {
     console.log("Cleaning up race scene...");
     // Stop animation loop
     if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
     }
     // Remove all player objects
     Object.keys(playerObjects).forEach(id => removePlayerObject(id));
     playerObjects = {};
     // Remove course objects
     currentCourseObjects.forEach(obj => {
         scene.remove(obj);
         if (obj.geometry) obj.geometry.dispose();
         if (obj.material) {
             // Dispose textures only if they are not shared/cached?
             // Check if material has a map and if it's not in our character cache before disposing
             if (obj.material.map && !Object.values(characterTextures).includes(obj.material.map)) {
                 // obj.material.map.dispose(); // Dispose non-character textures if needed
             }
             obj.material.dispose();
         }
     });
     currentCourseObjects = [];
     // Remove lights
     let lightsToRemove = [];
      scene.traverse(child => {
         if (child.isLight) {
             lightsToRemove.push(child);
         }
      });
      lightsToRemove.forEach(light => scene.remove(light));

      // Disable shadows on renderer? Optional.
      // renderer.shadowMap.enabled = false;

     raceInitialized = false; // Mark scene as not initialized
}


// --- Race Initialization ---
function initializeRaceScene() {
    console.log("Initializing race scene...");
    // Clear any potential remnants from previous states
    if (raceInitialized) { // Avoid redundant cleanup if already clean
         cleanupRaceScene();
    }

    raceInitialized = true; // Set flag immediately

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // Adjusted intensity
    scene.add(ambientLight);
    // No need to track ambient light for removal if we remove all lights in cleanup

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8); // Adjusted intensity
    directionalLight.position.set(10, 20, 15); // Adjusted position
    directionalLight.castShadow = true;
    // Configure shadow map resolution if needed
    // directionalLight.shadow.mapSize.width = 1024;
    // directionalLight.shadow.mapSize.height = 1024;
    scene.add(directionalLight);
    // No need to track directional light individually

     // Enable shadows on the renderer
     renderer.shadowMap.enabled = true;
     renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Softer shadows


    // TODO: Load the selected course based on server info (gameState.race.courseId)
    // For now, always load course 1
    createCourse(1); // Assuming gameState.race.courseId is available, or use default

    // Add player objects for players already in the game state
    console.log("Adding initial player objects:", players);
    updatePlayerObjects(); // Creates sprites with initial 'b' angle

    // Position camera behind the local player (initial setup)
    setupInitialCameraPosition(); // May need adjustment after first frame render

    // Update sprite angles based on initial camera position
    updateAllSpriteAngles();

    // Animation loop is started by the updateGameState handler when state becomes 'racing' or 'waiting'
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

function animate() {
    // Loop should continue as long as race is initialized (racing or spectator)
    if (!raceInitialized) {
        animationFrameId = null; // Ensure loop stops if scene cleaned up
        return;
    };
    animationFrameId = requestAnimationFrame(animate);

    // --- Update Remote Player Positions (Lerp) ---
     for (const playerId in playerObjects) {
         if (playerId !== localPlayerId && playerObjects[playerId].userData.targetPosition) {
             playerObjects[playerId].position.lerp(playerObjects[playerId].userData.targetPosition, lerpFactor);
         }
     }

    // Only run driving logic if actually racing and local player exists
    if (currentGameState === 'racing' && localPlayerId && players[localPlayerId]) {
        // --- Input Handling ---
        handleDrivingInput(); // Updates local player's position/rotation in `players` state and visual object

        // --- Player Updates (Sending local player's state) ---
        sendLocalPlayerUpdate();
    }

     // --- Camera Update (Always update if racing/spectating) ---
    updateCameraPosition(); // Make camera follow the local player smoothly

     // --- Update Sprite Angles based on Camera ---
     updateAllSpriteAngles();

    // --- Render Scene ---
    renderer.render(scene, camera);
}

// --- Input Handling ---
const keyStates = {}; // Keep track of pressed keys
window.addEventListener('keydown', (event) => { keyStates[event.key.toLowerCase()] = true; });
window.addEventListener('keyup', (event) => { keyStates[event.key.toLowerCase()] = false; });

function handleDrivingInput() {
    if (!localPlayerId || !playerObjects[localPlayerId] || !players[localPlayerId]) return;

    const player = players[localPlayerId];
    const playerObject = playerObjects[localPlayerId];
    let moved = false;
    let positionChanged = false;
    let rotationChanged = false;

    // Simple movement example (replace with proper physics later)
    const moveSpeed = 0.15;
    const turnSpeed = 0.03;

    let deltaRotation = 0;
    let deltaPosition = new THREE.Vector3();

    // Initialize position and rotation in local state if missing (should be set by server)
    if (!player.position) {
        player.position = { x: playerObject.position.x, y: playerObject.position.y - playerSpriteScale / 2, z: playerObject.position.z };
        console.warn("Local player state initialized position from object");
    }
    if (!player.rotation) {
        player.rotation = { y: 0 };
        console.warn("Local player state initialized rotation");
    }


    if (keyStates['w'] || keyStates['arrowup']) {
        deltaPosition.z -= moveSpeed; // Move along local Z (using Three.js convention: -Z is forward)
        moved = true;
    }
    if (keyStates['s'] || keyStates['arrowdown']) {
        deltaPosition.z += moveSpeed * 0.7; // Slower backward movement
        moved = true;
    }
    if (keyStates['a'] || keyStates['arrowleft']) {
        deltaRotation += turnSpeed;
        moved = true;
    }
    if (keyStates['d'] || keyStates['arrowright']) {
        deltaRotation -= turnSpeed;
        moved = true;
    }

    if (moved) {
        // Apply rotation change
        if (deltaRotation !== 0) {
            player.rotation.y = (player.rotation.y + deltaRotation);
            // Normalize Y rotation to [-PI, PI] or [0, 2*PI] - using [0, 2*PI] for consistency with angle calc
             player.rotation.y = (player.rotation.y + Math.PI * 2) % (Math.PI * 2);
            rotationChanged = true;
        }

        // Apply position change based on new rotation
        if (deltaPosition.lengthSq() > 0) { // Only move if there's displacement
             // Apply rotation to the movement vector
             const moveVector = deltaPosition.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, player.rotation.y);

             player.position.x += moveVector.x;
             player.position.y += moveVector.y; // Should remain 0 for flat ground
             player.position.z += moveVector.z;
             positionChanged = true;
        }

        // Update the visual object immediately for responsiveness
        if (positionChanged || rotationChanged) {
             updatePlayerObjectTransform(localPlayerId, player.position, player.rotation);
             // Note: Visual rotation update happens via updatePlayerSpriteAngle called in animate()
        }
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
        const cameraLerpFactor = 0.08; // Adjust for camera responsiveness
        camera.position.lerp(cameraTargetPosition, cameraLerpFactor);

        // Lerp the lookAt target for smoother rotation following
        const lookAtLerpFactor = cameraLerpFactor * 1.5; // LookAt can be slightly faster
         const currentLookAt = new THREE.Vector3();
         // Get the point the camera is currently looking at
         camera.getWorldDirection(currentLookAt).multiplyScalar(10).add(camera.position); // Project forward
         currentLookAt.lerp(lookAtTarget, lookAtLerpFactor);
         camera.lookAt(currentLookAt);


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