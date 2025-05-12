/**
 * Image Gallery Generator (Static Version)
 * This script creates a static HTML gallery from extracted images using Nunjucks templates
 */
const fs = require('fs-extra');
const path = require('path');
const nunjucks = require('nunjucks');

// Configuration
const config = {
    imagesDir: path.join(__dirname, 'output', 'extracted_images'),
    outputDir: path.join(__dirname, 'output', 'gallery'),
    templatesDir: path.join(__dirname, 'templates')};

// Configure Nunjucks
nunjucks.configure(config.templatesDir, {
    autoescape: true
});

// Ensure output directory exists
fs.ensureDirSync(config.outputDir);

/**
 * Check if a file is an image by its extension
 * @param {string} filename - Name of the file
 * @return {boolean} - True if the file is an image
 */
function isImageFile(filename) {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
    const ext = path.extname(filename).toLowerCase();
    return imageExtensions.includes(ext);
}

/**
 * Check if a file is an SVG based on extension or content
 * @param {string} filePath - Path to the file
 * @return {boolean} - True if the file is an SVG
 */
function isSvgFile(filePath) {
    // First check by extension
    if (path.extname(filePath).toLowerCase() === '.svg') {
        return true;
    }
    
    // Then check by content
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return content.trim().startsWith('<svg') || content.includes('<svg');
    } catch (err) {
        return false;
    }
}

/**
 * Read SVG file content
 * @param {string} filePath - Path to the SVG file
 * @return {string} - SVG content or empty string on error
 */
function readSvgContent(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        console.error(`Error reading SVG file ${filePath}:`, err);
        return '';
    }
}

/**
 * Get base64 encoded content of an image file
 * @param {string} filePath - Path to the image file
 * @param {boolean} isSvg - Whether the file is an SVG
 * @return {string} - Base64 encoded image content with data URL prefix
 */
function getBase64Image(filePath, isSvg) {
    try {
        const data = fs.readFileSync(filePath);
        const base64 = data.toString('base64');
        const ext = path.extname(filePath).toLowerCase();
        let mimeType;
        
        if (isSvg) {
            mimeType = 'image/svg+xml';
        } else {
            switch (ext) {
                case '.jpg':
                case '.jpeg':
                    mimeType = 'image/jpeg';
                    break;
                case '.png':
                    mimeType = 'image/png';
                    break;
                case '.gif':
                    mimeType = 'image/gif';
                    break;
                case '.webp':
                    mimeType = 'image/webp';
                    break;
                case '.bmp':
                    mimeType = 'image/bmp';
                    break;
                default:
                    mimeType = 'application/octet-stream';
            }
        }
        
        return `data:${mimeType};base64,${base64}`;
    } catch (err) {
        console.error(`Error encoding image ${filePath}:`, err);
        return '';
    }
}

/**
 * Generate the image gallery
 */
async function generateGallery() {
    console.log('Scanning image directories...');
    
    try {
        const folderImages = {};
        
        // Get all folders in the images directory
        const folders = await fs.readdir(config.imagesDir);
        
        for (const folder of folders) {
            const folderPath = path.join(config.imagesDir, folder);
            const stats = await fs.stat(folderPath);
            
            if (!stats.isDirectory()) continue;
            
            console.log(`Processing folder: ${folder}`);
            
            try {
                // Get all files in the folder
                const files = await fs.readdir(folderPath);
                const items = [];
                
                for (const file of files) {
                    const filePath = path.join(folderPath, file);
                    
                    try {
                        const fileStats = await fs.stat(filePath);
                        
                        if (!fileStats.isFile()) continue;
                        
                        // Check if it's an image file (including SVG)
                        if (isImageFile(file) || isSvgFile(filePath)) {
                            const isSvg = isSvgFile(filePath);
                            
                            items.push({
                                filename: file,
                                // Create a relative path that works in the browser
                                path: '../extracted_images/' + folder + '/' + file,
                                isSvg: isSvg,
                                content: isSvg ? readSvgContent(filePath) : '',
                                base64Data: getBase64Image(filePath, isSvg)
                            });
                        }
                    } catch (fileErr) {
                        console.warn(`Skipping file ${file} due to error:`, fileErr.message);
                    }
                }
                
                if (items.length > 0) {
                    folderImages[folder] = items;
                }
            } catch (folderErr) {
                console.warn(`Error processing folder ${folder}:`, folderErr.message);
            }
        }
        
        console.log('Rendering template...');
        
        // Render the template
        const html = nunjucks.render('gallery.njk', { 
            folderImages,
            currentPage: 1,
            totalPages: 1 
        });
        
        // Write the HTML file
        const outputPath = path.join(config.outputDir, "gallery.html");
        await fs.writeFile(outputPath, html);
        
        console.log(`Gallery generated at ${outputPath}`);
        
    } catch (err) {
        console.error('Error generating gallery:', err);
    }
}

// Run the gallery generator
generateGallery();
