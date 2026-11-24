import { Web } from "sip.js";

const SimpleUser = Web.SimpleUser;

const status = document.querySelector<HTMLParagraphElement>("#status")!;
const connectButton = document.querySelector<HTMLButtonElement>("#connect")!;
const echoButton = document.querySelector<HTMLButtonElement>("#echo")!;
const hangupButton = document.querySelector<HTMLButtonElement>("#hangup")!;
const remoteAudio = document.querySelector<HTMLAudioElement>("#remote-audio")!;
let user: SimpleUser | null = null;

function setStatus(message: string) {
  status.textContent = message;
}

connectButton.addEventListener("click", async () => {
  if (user) return;
  const server = document.querySelector<HTMLInputElement>("#server")!.value.trim();
  const aor = document.querySelector<HTMLInputElement>("#aor")!.value.trim();
  const username = document.querySelector<HTMLInputElement>("#username")!.value.trim();
  const password = document.querySelector<HTMLInputElement>("#password")!.value;
  if (!server.startsWith("wss://") || !aor.startsWith("sip:") || !username || !password) {
    setStatus("Enter a secure WSS URL and local test account credentials.");
    return;
  }

  setStatus("Requesting microphone and connecting to Asterisk…");
  user = new SimpleUser(server, {
    aor,
    media: { constraints: { audio: true, video: false }, remote: { audio: remoteAudio } },
    delegate: {
      onRegistered: () => {
        setStatus("Registered over WSS. Ready for local test calls.");
        echoButton.disabled = false;
      },
      onCallReceived: () => {
        setStatus("Incoming SIP test call. Answering browser media…");
        void user
          ?.answer()
          .then(() => {
            setStatus("Incoming WebRTC call answered; verify caller audio and microphone.");
            hangupButton.disabled = false;
          })
          .catch((error: unknown) => setStatus(`Could not answer: ${String(error)}`));
      },
      onCallAnswered: () => {
        setStatus("WebRTC session established; speak and listen to verify two-way audio.");
        hangupButton.disabled = false;
      },
      onCallHangup: () => {
        setStatus("Call ended.");
        hangupButton.disabled = true;
      },
      onServerDisconnect: (error) =>
        setStatus(`WSS disconnected${error ? `: ${error.message}` : ""}`),
    },
    userAgentOptions: { authorizationUsername: username, authorizationPassword: password },
  });
  try {
    await user.connect();
    await user.register();
    connectButton.disabled = true;
  } catch (error) {
    user = null;
    setStatus(`Registration failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});

echoButton.addEventListener("click", async () => {
  if (!user) return;
  try {
    await user.call("sip:5551000@localhost");
    setStatus("Calling Asterisk Echo; speak to test microphone and returned audio.");
    hangupButton.disabled = false;
  } catch (error) {
    setStatus(`Call failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});

hangupButton.addEventListener("click", async () => {
  try {
    await user?.hangup();
  } catch (error) {
    setStatus(`Hangup failed: ${String(error)}`);
  }
});

window.addEventListener("beforeunload", () => {
  void user?.unregister();
  void user?.disconnect();
});
