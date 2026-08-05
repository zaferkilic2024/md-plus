// API keys — the one thing of the user's we hold that is worth stealing.
//
// They live in the OS credential store (Windows Credential Manager, macOS
// Keychain, Linux Secret Service) and never in a file of ours. The Rust side
// does the storing; this is the door to it. `secrets.rs` says what that does
// and does not protect against.
//
// Everything here fails quietly and reports it. A key that cannot be read is a
// connection that cannot answer — which the app already knows how to say
// ("anahtar yok"). A key that cannot be written must never take the settings
// down with it.

import { invoke } from "@tauri-apps/api/core";

/** The key for a connection, or "" when it has none (Ollama, the CLI agents). */
export async function readSecret(id) {
  try {
    return (await invoke("secret_get", { id })) ?? "";
  } catch (error) {
    console.warn("anahtar okunamadı:", error);
    return "";
  }
}

export async function writeSecret(id, value) {
  try {
    if (value) await invoke("secret_set", { id, value });
    else await invoke("secret_delete", { id });
    return true;
  } catch (error) {
    console.warn("anahtar kaydedilemedi:", error);
    return false;
  }
}

export async function forgetSecret(id) {
  try {
    await invoke("secret_delete", { id });
  } catch (error) {
    console.warn("anahtar silinemedi:", error);
  }
}
