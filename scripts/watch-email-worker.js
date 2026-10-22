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

  if (config.mode === "test" && process.env.DATABASE_URL) {
    throw new Error("Test email sending requires local PostgreSQL.");
  }

  if (
    config.mode === "live" &&
    !process.env.DATABASE_URL?.trim()
  ) {
    throw new Error("Live email sending requires DATABASE_URL.");
  }

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log(`Email watcher started in ${config.mode} mode.`);

  if (!config.enabled) {
    console.log(
      "Sending is disabled. Worker checks will not send emails or access the database.",
    );
  }

  console.log("Checking the queue every 15 seconds.");

  runWorker();
} catch (error) {
  console.error("EMAIL WATCHER FAILED:", error.message);
  process.exitCode = 1;
}
