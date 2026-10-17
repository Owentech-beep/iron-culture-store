import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
    fields: 0,
    parts: 1,
  },
}).single("image");

export function receiveProductImage(req, res, next) {
  upload(req, res, (error) => {
    if (error) {
      return res.status(400).json({
        error: "Upload one image file no larger than 5 MB.",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "Choose an image to upload.",
      });
    }

    next();
  });
}