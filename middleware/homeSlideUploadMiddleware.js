import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 1,
    fields: 0,
    parts: 1,
  },
}).single("media");

export function receiveHomeSlide(req, res, next) {
  upload(req, res, (error) => {
    if (error) {
      return res.status(400).json({
        error: "Upload one file no larger than 20 MB.",
      });
    }

    if (!req.file?.buffer) {
      return res.status(400).json({
        error: "Choose an image or MP4 video.",
      });
    }

    next();
  });
}