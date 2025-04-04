import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const files = [
    { 
        path: 'postprocessing/EffectComposer.js',
        url: 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js'
    },
    {
        path: 'postprocessing/Pass.js',
        url: 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/Pass.js'
    },
    {
        path: 'postprocessing/RenderPass.js',
        url: 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/RenderPass.js'
    },
    {
        path: 'postprocessing/UnrealBloomPass.js',
        url: 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js'
    },
    {
        path: 'postprocessing/OutputPass.js',
        url: 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/OutputPass.js'
    },
    {
        path: 'postprocessing/ShaderPass.js',
        url: 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/ShaderPass.js'
    },
    {
        path: 'postprocessing/MaskPass.js',
        url: 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/MaskPass.js'
    },
    {
        path: 'shaders/CopyShader.js',
        url: 'https://unpkg.com/three@0.160.0/examples/jsm/shaders/CopyShader.js'
    },
    {
        path: 'shaders/LuminosityHighPassShader.js',
        url: 'https://unpkg.com/three@0.160.0/examples/jsm/shaders/LuminosityHighPassShader.js'
    },
    {
        path: 'shaders/OutputShader.js',
        url: 'https://unpkg.com/three@0.160.0/examples/jsm/shaders/OutputShader.js'
    }
];

async function downloadFile(file) {
    const outputPath = path.join(__dirname, 'public', 'jsm', file.path);
    
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
        console.log('All files downloaded successfully!');
    } catch (error) {
        console.error('Error downloading files:', error);
    }
}

downloadAll(); 