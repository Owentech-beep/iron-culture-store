import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
    fields: 1,
    parts: 2,
  },
}).single("logo");

export function receiveBrandLogo(req, res, next) {
  upload(req, res, (error) => {
    if (error) {
      return res.status(400).json({
        error: "Upload one JPEG, PNG or WebP logo, no larger than 5 MB.",
      });
    }

    next();
  });
}