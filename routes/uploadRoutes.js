const express = require('express');
const router = express.Router();
const multer = require('multer');
const { bucket } = require('../config/firebase'); // Updated path
const { protect } = require('../middleware/authMiddleware');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

router.post('/', protect, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const file = req.file;
    const type = req.body.type || 'general'; // e.g., 'resume' or 'avatar'
    const isResume = type === 'resume';
    const isPdfFile = file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/octet-stream' ||
      /\.pdf$/i.test(file.originalname || '');
    const validType = isResume
      ? isPdfFile
      : (file.mimetype.startsWith('image/') || file.mimetype === 'application/octet-stream');

    if (!validType) {
      return res.status(400).json({
        message: type === 'resume'
          ? 'Invalid file type. Resume must be a PDF'
          : 'Invalid image type. Allowed: JPG, PNG, WEBP'
      });
    }
    
    // Generate a unique filename
    const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    const filename = `${type}s/${req.user._id}_${Date.now()}_${sanitizedFilename}`;
    
    const fileRef = bucket.file(filename);
    
    const { v4: uuidv4 } = require('uuid');
    const downloadToken = uuidv4();
    
    await fileRef.save(file.buffer, {
      metadata: { 
        contentType: file.mimetype,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken
        }
      },
    });

    const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filename)}?alt=media&token=${downloadToken}`;

    res.status(200).json({ url: fileUrl });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: 'File upload failed' });
  }
});

module.exports = router;
