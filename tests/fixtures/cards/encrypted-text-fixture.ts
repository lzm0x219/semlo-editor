import "../../../packages/core/src/styles/style.css";
import { createEditor } from "../../../packages/core/src/index";

const host = document.createElement("div");
host.id = "encrypted-fixture";
document.body.append(host);
const observations: unknown[] = [];
const provider = {
  async encrypt({ plaintext, password }: { plaintext: string; password: string }) {
    if (Reflect.get(window, "failEncryption")) throw new Error("fake provider error");
    if (password !== "test-password") throw new Error("wrong password");
    const result = btoa(unescape(encodeURIComponent(plaintext)));
    if (Reflect.get(window, "delayEncryption")) {
      await new Promise<void>((resolve) => Reflect.set(window, "resolveEncryption", resolve));
    }
    return result;
  },
  async decrypt({ ciphertext, password }: { ciphertext: string; password: string }) {
    if (password !== "test-password") throw new Error("wrong password");
    const result = decodeURIComponent(escape(atob(ciphertext)));
    if (Reflect.get(window, "delayDecryption")) {
      await new Promise<void>((resolve) => Reflect.set(window, "resolveDecryption", resolve));
    }
    return result;
  },
};
Object.assign(window, {
  encryptedProvider: provider,
  createEncryptedTestEditor: createEditor,
  encryptedObservations: observations,
  encryptedEditor: createEditor({
    element: host,
    outline: false,
    encryptedTextProvider: provider,
    onChange: (s) => observations.push(s),
  }),
});
