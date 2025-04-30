const multer = require('multer');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger').childLogger('FileUploadService');

// Define allowed file types
const allowedMimeTypes = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  document: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
};

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../../uploads');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
      logger.info(`Created upload directory: ${uploadDir}`);
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniquePrefix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const filename = uniquePrefix + '-' + file.originalname.replace(/\s+/g, '_'); // Replace spaces
    logger.debug(`Generated filename: ${filename}`);
    cb(null, filename);
  }
});

// Configure multer file filter
const fileFilter = (req, file, cb) => {
    // Combine all allowed types for a general check
    const allAllowedTypes = [...allowedMimeTypes.image, ...allowedMimeTypes.document];
    if (allAllowedTypes.includes(file.mimetype)) {
        logger.debug(`Accepting file: ${file.originalname} (${file.mimetype})`);
        cb(null, true);
    } else {
        logger.warn(`Rejected file type: ${file.mimetype} for file ${file.originalname}`);
        // Reject file with a specific error message
        cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `Unsupported file type: ${file.mimetype}`), false);
    }
};

// Create multer instance
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: fileFilter
});

// Export the configured multer middleware for single file uploads
module.exports = {
    uploadSingleFile: upload.single('file'), // Middleware expects field named 'file'
    allowedMimeTypes // Export allowed types if needed elsewhere
}; 