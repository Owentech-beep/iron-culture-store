import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, checkDatabaseConnection } from "./config/database.js";
import indexRoutes from "./routes/indexRoutes.js";
import { notFound, errorHandler } from "./middleware/errorMiddleware.js";
import productRoutes from "./routes/productRoutes.js";
import productDetailRoutes from "./routes/productDetailRoutes.js";
import { sessionMiddleware } from "./config/session.js";
import { loadCurrentUser } from "./middleware/authMiddleware.js";
import { csrfProtection } from "./middleware/csrfMiddleware.js";
import authRoutes from "./routes/authRoutes.js";
import cartRoutes from "./routes/cartRoutes.js";
import { loadCartCount } from "./middleware/cartMiddleware.js";
import checkoutRoutes from "./routes/checkoutRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import payfastNotificationRoutes from "./routes/payfastNotificationRoutes.js";
import newsletterRoutes from "./routes/newsletterRoutes.js";
import { startEmailWorkerProcess } from "./services/emailWorkerProcess.js";
import seoRoutes from "./routes/seoRoutes.js";
import ozowNotificationRoutes from "./routes/ozowNotificationRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
} else if (
  process.env.NODE_ENV === "development" &&
  process.env.PAYFAST_MODE?.trim() === "sandbox"
) {
  app.set("trust proxy", "loopback");
}
const port = Number(process.env.PORT || 3000);

app.disable("x-powered-by");
// Lightweight process health check.
// Runs before sessions, authentication and database-backed middleware.
app.get("/healthz", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(200).json({ status: "ok" });
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(seoRoutes);
app.use("/payments/payfast", payfastNotificationRoutes);
app.use("/payments/ozow", ozowNotificationRoutes);

app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(express.json({ limit: "20kb" }));

app.use(express.static(path.join(__dirname, "public")));

// Expose only the required frontend distribution folders.
app.use(
  "/vendor/bootstrap",
  express.static(path.join(__dirname, "node_modules/bootstrap/dist")),
);

app.use(
  "/vendor/aos",
  express.static(path.join(__dirname, "node_modules/aos/dist")),
);

app.use((req, res, next) => {
  res.locals.currentYear = new Date().getFullYear();
  res.locals.currentUser = null;
  res.locals.csrfToken = "";
  res.locals.cartCount = 0;
  next();
});

app.use((req, res, next) => {
  const excludedPaths = [
    "/admin",
    "/account",
    "/cart",
    "/checkout",
    "/orders",
    "/payments",
    "/login",
    "/register",
    "/logout",
    "/forgot-password",
    "/reset-password",
    "/newsletter",
  ];

  const excludedPage = excludedPaths.some(
    (path) => req.path === path || req.path.startsWith(`${path}/`),
  );

  const filteredShopPage =
    req.path === "/shop" && req.originalUrl.includes("?");

  if (excludedPage || filteredShopPage) {
    res.set("X-Robots-Tag", "noindex");
  }

  next();
});

app.use(sessionMiddleware);
app.use(loadCurrentUser);
app.use(csrfProtection);
app.use(loadCartCount);

app.use("/admin", adminRoutes);

app.use("/checkout", checkoutRoutes);
app.use("/orders", paymentRoutes);
app.use("/orders", orderRoutes);
app.use("/cart", cartRoutes);
app.use("/newsletter", newsletterRoutes);
app.use("/", authRoutes);
app.use("/", indexRoutes);
app.use("/shop", productRoutes);
app.use("/product", productDetailRoutes);

app.use(notFound);
app.use(errorHandler);

async function startServer() {
  let emailWorker = null;

  try {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("PORT must be an integer between 1 and 65535.");
    }

    await checkDatabaseConnection();
    console.log("PostgreSQL connected.");

    emailWorker = startEmailWorkerProcess();

    const server = app.listen(port, () => {
      console.log(`Iron Culture is running at http://localhost:${port}`);
    });

    let shuttingDown = false;

    async function shutdown(reason, exitCode = 0) {
      if (shuttingDown) return;
      shuttingDown = true;

      console.log(`${reason}. Closing server and email watcher.`);

      const timeout = setTimeout(() => {
        console.error("Shutdown timed out.");
        process.exit(1);
      }, 45_000);

      timeout.unref();

      try {
        const httpClosed = new Promise((resolve, reject) => {
          server.close((error) => {
            if (error && error.code !== "ERR_SERVER_NOT_RUNNING") {
              reject(error);
              return;
            }

            resolve();
          });
        });

        await Promise.all([httpClosed, emailWorker.stop()]);

        await pool.end();
        clearTimeout(timeout);
        process.exit(exitCode);
      } catch (error) {
        console.error("Shutdown failed:", error.message);
        process.exit(1);
      }
    }

    server.on("error", (error) => {
      console.error("HTTP server error:", error.message);
      void shutdown("HTTP server failure", 1);
    });

    process.on("SIGINT", () => {
      void shutdown("SIGINT received");
    });

    process.on("SIGTERM", () => {
      void shutdown("SIGTERM received");
    });
  } catch (error) {
    console.error("Application startup failed:", {
      name: error.name,
      message: error.message,
      code: error.code,
      errors: error.errors?.map((item) => ({
        message: item.message,
        code: item.code,
        address: item.address,
        port: item.port,
      })),
    });

    await emailWorker?.stop();
    await pool.end();
    process.exit(1);
  }
}

startServer();
