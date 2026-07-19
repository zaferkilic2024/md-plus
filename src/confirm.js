// A three-way confirmation (UC-02/A1: "Kaydet / Kaydetme / Vazgeç").
//
// The system ask() dialog only offers two answers, and UC-02-K4 is explicit
// that nothing may be discarded silently — so "Vazgeç" has to be a real answer,
// not the absence of one.

import { t } from "./i18n.js";

/**
 * @param {string} message
 * @param {{label: string, value: string, primary?: boolean}[]} choices
 * @returns {Promise<string>} the chosen value ("cancel" if dismissed)
 */
export function askChoice(message, choices) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";

    const box = document.createElement("div");
    box.className = "dialog";

    const text = document.createElement("p");
    text.textContent = message;
    box.append(text);

    const row = document.createElement("div");
    row.className = "dialog-buttons";

    const finish = (value) => {
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(value);
    };

    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish("cancel");
      }
    }

    for (const choice of choices) {
      const button = document.createElement("button");
      button.textContent = choice.label;
      if (choice.primary) button.className = "primary";
      button.onclick = () => finish(choice.value);
      row.append(button);
    }

    box.append(row);
    overlay.append(box);
    document.body.append(overlay);

    window.addEventListener("keydown", onKey, true);
    row.querySelector("button")?.focus();
  });
}

/**
 * One line of text with an OK / Cancel. Resolves to the trimmed value, or null
 * when cancelled or left empty.
 */
export function askText(message, initial = "") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";

    const box = document.createElement("div");
    box.className = "dialog";

    const text = document.createElement("p");
    text.textContent = message;

    const field = document.createElement("input");
    field.className = "dialog-input";
    field.value = initial;

    const row = document.createElement("div");
    row.className = "dialog-buttons";

    const finish = (value) => {
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      const t = value?.trim();
      resolve(t ? t : null);
    };
    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(null);
      } else if (event.key === "Enter") {
        event.preventDefault();
        finish(field.value);
      }
    }

    const iptal = document.createElement("button");
    iptal.textContent = t("dialog.cancel");
    iptal.onclick = () => finish(null);

    const tamam = document.createElement("button");
    tamam.className = "primary";
    tamam.textContent = t("dialog.ok");
    tamam.onclick = () => finish(field.value);

    row.append(iptal, tamam);
    box.append(text, field, row);
    overlay.append(box);
    document.body.append(overlay);

    window.addEventListener("keydown", onKey, true);
    field.focus();
    field.select();
  });
}
