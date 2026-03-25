const fs = require('fs');
const https = require('https');
const path = require('path');
const { execSync } = require('child_process');

// Ensure public/images directory exists
const imgDir = path.join(process.cwd(), 'public', 'images');
if (!fs.existsSync(imgDir)) {
    fs.mkdirSync(imgDir, { recursive: true });
}

// Ensure glob is available
try {
    require.resolve('glob');
} catch (e) {
    console.log('glob not found, installing locally without saving...');
    execSync('npm install glob --no-save', { stdio: 'inherit' });
}
const glob = require('glob');

async function downloadImage(url, dest) {
    if (fs.existsSync(dest)) return true; // Already downloaded
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                // handle redirect
                return downloadImage(response.headers.location, dest).then(resolve).catch(reject);
            }
            if (response.statusCode !== 200) {
                return reject(new Error(`Failed to download ${url} Status: ${response.statusCode}`));
            }
            const file = fs.createWriteStream(dest);
            response.pipe(file);
            file.on('finish', () => {
                file.close(() => resolve(true));
            });
            file.on('error', (err) => {
                fs.unlink(dest, () => reject(err));
            });
        }).on('error', reject);
    });
}

async function processFiles() {
    console.log('Finding all Astro files...');
    const files = glob.sync('src/**/*.astro');
    console.log(`Found ${files.length} Astro files.`);
    
    const urlRegex = /https?:\/\/(?:www\.)?bob24\.be\/[^\s\"\'\>]*\.(png|jpg|jpeg|webp|svg)/gi;
    const urlRegexProtocolLess = /\/\/(?:www\.)?bob24\.be\/[^\s\"\'\>]*\.(png|jpg|jpeg|webp|svg)/gi;

    let totalDownloads = 0;
    
    for (const file of files) {
        let content = fs.readFileSync(file, 'utf8');
        let fileUpdated = false;
        
        const allMatches1 = [...content.matchAll(urlRegex)].map(m => m[0]);
        const allMatches2 = [...content.matchAll(urlRegexProtocolLess)].map(m => m[0]);
        const uniqueUrls = [...new Set([...allMatches1, ...allMatches2])];
        
        if (uniqueUrls.length > 0) {
            console.log(`\nProcessing ${uniqueUrls.length} images in ${file}...`);
        }
        
        for (let url of uniqueUrls) {
            let fullUrl = url.startsWith('//') ? 'https:' + url : url;
            
            try {
                const urlObj = new URL(fullUrl);
                let filename = path.basename(urlObj.pathname);
                
                const localPath = path.join(imgDir, filename);
                const relativePath = '/images/' + filename;
                
                await downloadImage(fullUrl, localPath);
                console.log(`Downloaded ${fullUrl} -> ${relativePath}`);
                
                // Escape regex special chars for replacement to avoid weird substring matches
                const escapedUrlForRegex = url.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
                const globalReplaceRegex = new RegExp(escapedUrlForRegex, 'g');
                content = content.replace(globalReplaceRegex, relativePath);
                
                fileUpdated = true;
                totalDownloads++;
            } catch (e) {
                console.error(`Error processing ${fullUrl}: ${e.message}`);
            }
        }
        
        if (fileUpdated) {
            fs.writeFileSync(file, content, 'utf8');
            console.log(`Updated references in ${file}`);
        }
    }
    
    console.log(`\nCompleted. Success for ${totalDownloads} images processing lines.`);
}

processFiles().catch(console.error);
