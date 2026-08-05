//! API keys, kept where the operating system keeps secrets.
//!
//! Until 5 Aug 2026 a key sat in `ayarlar.json` in plain text. What that loses
//! is worth naming precisely, because the usual assumption is wrong: an OS
//! credential store does **not** protect you from malware running as you — it
//! can call the same API and read the same secret. What it protects is the key
//! *leaving its machine*: a backup, a synced folder (and the settings now live
//! under the home folder, which is exactly what OneDrive and Dropbox point at),
//! a folder shown to somebody, a file pasted into a bug report, an accidental
//! commit. A plain-text key loses to every one of those; a stored one to none.
//!
//! Windows Credential Manager, macOS Keychain, Linux Secret Service — the
//! `keyring` crate is the same door every editor of this kind already uses.
//!
//! The key is addressed by the connection's id, never by its name: names are
//! the user's to change, and a renamed connection must not lose its key.

use keyring::Entry;

const SERVICE: &str = "MD Plus";

fn entry(id: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn secret_set(id: String, value: String) -> Result<(), String> {
    entry(&id)?
        .set_password(&value)
        .map_err(|error| error.to_string())
}

/// `None` when there is no key for this id — which is an answer, not a failure:
/// most connections (Ollama, the CLI agents) never have one.
#[tauri::command]
pub fn secret_get(id: String) -> Result<Option<String>, String> {
    match entry(&id)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

/// Deleting what is not there is success, not an error: this is called to make
/// sure a key is gone, and it being already gone is that.
#[tauri::command]
pub fn secret_delete(id: String) -> Result<(), String> {
    match entry(&id)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
