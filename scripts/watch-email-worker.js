import "dotenv/config";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { getEmailConfig } from "../config/email.js";

const workerPath = fileURLToPath(
  new URL("./send-one-email.js", import.meta.url),
);

let child = null;
let timer = null;
let stopping = false;

function stop() {
  if (stopping) return;
  stopping = true;

  clearTimeout(timer);

  console.log(
    "Stopping email watcher. Waiting for any active attempt to finish.",
  );

  // Do not interrupt a request whose delivery outcome may be uncertain.
  if (!child) {
    process.exitCode = 0;
  }
}

function runWorker() {
  if (stopping) return;

  child = spawn(process.execPath, [workerPath], {
    stdio: "inherit",
    shell: false,
  });

  let failedToStart = false;

  child.once("error", (error) => {
    failedToStart = true;
    console.error("Could not start email worker:", error.message);
  });

  child.once("close", (code, signal) => {
    child = null;

    if (stopping) return;

    if (failedToStart || code !== 0) {
      stopping = true;
      process.exitCode = 1;

      console.error(
        `Email watcher stopped after worker failure (${signal ?? code}).`,
      );
      console.error("Fix the error before restarting the watcher.");
      return;
    }

    timer = setTimeout(runWorker, 15_000);
  });
}

try {
  const config = getEmailConfig();

  if (!config.enabled) {
    throw new Error("Set EMAIL_SENDING_ENABLED=true before starting.");
  }

  if (process.env.DATABASE_URL) {
    throw new Error("This watcher is for local PostgreSQL testing only.");
  }

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log("Local demo email watcher started.");
  console.log("Checking the queue every 15 seconds. Press Ctrl+C to stop.");

  runWorker();
} catch (error) {
  console.error("EMAIL WATCHER FAILED:", error.message);
  process.exitCode = 1;
}