import { test, expect, chromium } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const gatewayEnv = path.join(projectRoot, "infrastructure/asterisk/.env");

function envValue(name: string) {
  const line = readFileSync(gatewayEnv, "utf8")
    .split(/\r?\n/)
    .find((item) => item.startsWith(`${name}=`));
  if (!line) throw new Error(`Missing ${name} in local gateway .env`);
  return line.slice(name.length + 1).trim();
}

function makeToneWav(file: string) {
  const rate = 8000;
  const samples = rate * 3;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 7000), 44 + i * 2);
  writeFileSync(file, buffer);
}

test("browser WebRTC registers over WSS and receives Asterisk Echo audio", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "asterisk-webrtc-"));
  const tonePath = path.join(tempDir, "microphone-tone.wav");
  makeToneWav(tonePath);
  const browser = await chromium.launch({
    args: [
      "--ignore-certificate-errors",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${tonePath}`,
    ],
  });
  try {
    const context = await browser.newContext({
      permissions: ["microphone"],
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.error("Smoke page error:", error.message));
    page.on("console", (message) => {
      if (message.type() === "error") console.error("Smoke page console:", message.text());
    });
    page.on("requestfailed", (request) =>
      console.error("Smoke page request failed:", request.url(), request.failure()?.errorText),
    );
    page.on("websocket", (socket) => {
      console.log("Smoke page WebSocket:", socket.url());
      socket.on("close", () => console.log("Smoke page WebSocket closed:", socket.url()));
      socket.on("socketerror", (error) => console.error("Smoke page WebSocket error:", error));
    });
    await page.goto(
      `${process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4173"}/asterisk-smoke.html`,
    );
    await page.locator("#password").fill(envValue("WEBRTC_AGENT_PASSWORD"));
    await page.locator("#connect").click();
    await expect(page.locator("#status")).toContainText("Registered over WSS", { timeout: 20_000 });
    await page.locator("#echo").click();
    await expect(page.locator("#status")).toContainText("WebRTC session established", {
      timeout: 20_000,
    });
    const audio = page.locator("#remote-audio");
    await expect
      .poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime), {
        timeout: 10_000,
      })
      .toBeGreaterThan(0.5);
    const hasRemoteTrack = await audio.evaluate((element: HTMLAudioElement) =>
      Boolean(element.srcObject?.getAudioTracks().some((track) => track.readyState === "live")),
    );
    expect(hasRemoteTrack).toBe(true);
    await page.locator("#hangup").click();
    await expect(page.locator("#status")).toContainText("Call ended", { timeout: 10_000 });
    await context.close();
  } finally {
    await browser.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
