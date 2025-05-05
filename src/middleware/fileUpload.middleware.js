// src/middleware/fileUpload.middleware.js
// Middleware for handling file uploads using Multer

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger'); // Use logger

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../uploads');
try {
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
        logger.info('Uploads directory created:', { path: uploadsDir });
    } else {
        logger.debug('Uploads directory already exists.', { path: uploadsDir });
    }
} catch (err) {
    logger.error('Error ensuring uploads directory exists:', { error: err });
    // Depending on the error, might want to throw or handle differently
}


// Define allowed mime types directly in the middleware config
const allowedMimeTypes = {
    image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    document: [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
        'text/plain', // .txt
        'text/markdown' // .md
    ]
};

// Combine all allowed types for the filter
const allAllowedTypes = [...allowedMimeTypes.image, ...allowedMimeTypes.document];

// File filter function
const fileFilter = (req, file, cb) => {
    if (allAllowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        logger.warn('Upload rejected: Unsupported file type', { mimetype: file.mimetype });
        // Reject file with a specific error message the controller can catch
        cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `Unsupported file type: ${file.mimetype}`), false);
    }
};

// Multer disk storage configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir); // Use the verified uploads directory path
    },
    filename: function (req, file, cb) {
        // Generate a unique filename to avoid conflicts
        const uniqueSuffix = uuidv4();
        const extension = path.extname(file.originalname);
        cb(null, `${uniqueSuffix}${extension}`);
    }
});

// Multer instance configuration
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10 MB limit (adjust as needed)
    },
    fileFilter: fileFilter
});

// Export the configured Multer middleware for single file uploads
// And the allowed types map if needed elsewhere
module.exports = {
    uploadSingleFile: upload.single('file'), // 'file' matches the form field name
    allowedMimeTypes // Export the types map
}; 