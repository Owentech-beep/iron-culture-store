import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { getEmailConfig } from "../config/email.js";

const watcherPath = fileURLToPath(
  new URL("../scripts/watch-email-worker.js", import.meta.url),
);

export function startEmailWorkerProcess() {
  const config = getEmailConfig();

  if (!config.enabled) {
    console.log("Order email processing is disabled.");

    return {
      stop: async () => {},
    };
  }

  const child = spawn(process.execPath, [watcherPath], {
    stdio: "inherit",
    shell: false,
  });

  let stopping = false;
  let closed = false;

  const finished = new Promise((resolve) => {
    child.once("error", (error) => {
      console.error("Email watcher could not start:", error.message);
    });

    child.once("close", (code, signal) => {
      closed = true;

      if (!stopping) {
        console.error(
          "Email watcher stopped unexpectedly. Inspect logs before restarting.",
          { code, signal },
        );
      }

      resolve();
    });
  });

  return {
    async stop() {
      if (!stopping && !closed) {
        stopping = true;

        // The watcher waits for its active email attempt to finish.
        child.kill("SIGTERM");
      }

      await finished;
    },
  };
}