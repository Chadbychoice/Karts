const https = require('https');
const fs = require('fs');
const path = require('path');

const files = [
    // Core postprocessing files
    'postprocessing/EffectComposer.js',
    'postprocessing/Pass.js',
    'postprocessing/RenderPass.js',
    'postprocessing/UnrealBloomPass.js',
    'postprocessing/OutputPass.js',
    'postprocessing/ShaderPass.js',
    'postprocessing/MaskPass.js',
    // Required shader files
    'shaders/CopyShader.js',
    'shaders/LuminosityHighPassShader.js',
    'shaders/OutputShader.js'
];

const baseUrl = 'https://unpkg.com/three@0.160.0/examples/jsm/';
const outputDir = path.join(__dirname, 'public', 'jsm');

async function downloadFile(file) {
    const url = baseUrl + file;
    const outputPath = path.join(outputDir, file);
    
    // Ensure directory exists
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
                return;
            }
            
            const fileStream = fs.createWriteStream(outputPath);
            response.pipe(fileStream);
            
            fileStream.on('finish', () => {
                fileStream.close();
                console.log(`Downloaded: ${file}`);
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
        console.log('All files downloaded successfully!');
    } catch (error) {
        console.error('Error downloading files:', error);
    }
}

downloadAll(); 