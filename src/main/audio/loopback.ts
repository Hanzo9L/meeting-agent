import { desktopCapturer, session } from "electron";

export function initializeLoopbackHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({ types: ["screen"] });
      callback({
        video: sources[0],
        audio: "loopback"
      });
    },
    { useSystemPicker: false }
  );
}
