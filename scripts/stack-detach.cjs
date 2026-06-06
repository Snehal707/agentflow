/**
 * Windows: spawn a new PowerShell window running `npm run dev:stack` at repo root.
 * Avoids IDE background shells killing concurrently with exit status 4294967295.
 */
const { spawn } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");

if (process.platform !== "win32") {
  console.error(
    "stack:detach is for Windows only. From the repo root run: npm run dev:stack"
  );
  process.exit(1);
}

const systemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
const exe = path.join(
  systemRoot,
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe"
);

const child = spawn(
  exe,
  [
    "-NoProfile",
    "-NoExit",
    "-WorkingDirectory",
    root,
    "-Command",
    "npm run dev:stack",
  ],
  {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    windowsVerbatimArguments: false,
  }
);

child.unref();
console.info("Opening a new PowerShell window: npm run dev:stack (%s)", root);

child.once("error", (err) => {
  console.error("stack:detach: failed to start PowerShell:", err.message || err);
  process.exitCode = 1;
});
