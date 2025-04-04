import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const characterAngles = ['f', 'fr', 'r', 'br', 'b', 'bl', 'l', 'fl'];
const characterCount = 7;

// Base URL for the sprite assets
const SPRITE_BASE_URL = 'https://raw.githubusercontent.com/Chadbychoice/Karts/master/public/Sprites';

const files = [
    // Character sprites
    ...Array(characterCount).fill().flatMap((_, charId) =>
        characterAngles.map(angle => ({
            path: `characters/${charId + 1}/${angle}.png`,
            url: `${SPRITE_BASE_URL}/characters/${charId + 1}/${angle}.png`
        }))
    ),
    // Flame sprites
    ...Array(7).fill().map((_, i) => ({
        path: `flame/flame${i + 1}.png`,
        url: `${SPRITE_BASE_URL}/flame/flame${i + 1}.png`
    })),
    // Spark sprites
    ...Array(5).fill().map((_, i) => ({
        path: `sparks/spark${i + 1}.png`,
        url: `${SPRITE_BASE_URL}/sparks/spark${i + 1}.png`
    }))
];

async function downloadFile(file) {
    const outputPath = path.join(__dirname, 'public', 'Sprites', file.path);
    
    // Ensure directory exists
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    
    return new Promise((resolve, reject) => {
        https.get(file.url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download ${file.url}: ${response.statusCode}`));
                return;
            }
            
            const fileStream = fs.createWriteStream(outputPath);
            response.pipe(fileStream);
            
            fileStream.on('finish', () => {
                fileStream.close();
                console.log(`Downloaded: ${file.path}`);
                resolve();
            });
        }).on('error', reject);
    });
}

async function downloadAll() {
    try {
        for (const file of files) {
            await downloadFile(file);
        }
        console.log('All sprite files downloaded successfully!');
    } catch (error) {
        console.error('Error downloading files:', error);
    }
}

downloadAll(); 