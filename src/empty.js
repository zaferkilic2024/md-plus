// The opening / welcome screen.
//
// Nothing is open. Instead of a small centred block on an empty page, this fills
// the window like a real first screen: a hero that names the product and offers
// the ways in, four quadrants for the four legs of the product (tabs, Aktarma,
// mark-and-comment, AI), and a strip of the quieter powers underneath. The
// composition is the writer-approved variant B (tasarim/28_acilis-b.html), skinned
// with the app's own kılıf tokens — one accent, one neutral ramp, concept icons,
// no filled buttons. It sits inside .body between the tab strip and the surface,
// so the window frame and tab bar already around it are NOT redrawn here.
//
// Still no library (KR-14). The invitation never lived in a button; the ways in
// carry no fill — "Yeni belge" is set apart by accent ink + edge + weight, not by
// a slab. Laid out once with flex so it fills the height without a jump: hero and
// power bar hold their size, the quadrants take the slack, and a short window
// scrolls the canvas rather than clipping a card.

const svg = (paths, size = 19) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export function createEmptyState({ onOpen, onNew, recents }) {
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.innerHTML = `
    <div class="ic">
      <div class="marka"><span>md</span><i>+</i></div>
      <h2>Yazın, okuyun, düzenleyin. Hepsi tek pencerede.</h2>
      <p class="spot">Markdown'ın gücü, işaretlerin ötesinde. Sadece içeriğe odaklanın.</p>

      <div class="girisler">
        <div class="giris" data-act="new">
          ${svg('<path d="M12 5v14M5 12h14"/>', 17)}
          <span class="et">Yeni belge</span>
        </div>
        <div class="ayrac-d"></div>
        <div class="giris" data-act="open">
          ${svg('<path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>', 17)}
          <span class="et">Belge aç</span>
        </div>
      </div>
      <p class="empty-hint">…ya da bir <code>.md</code> dosyasını buraya sürükleyin.</p>
    </div>`;

  const ic = empty.querySelector(".ic");

  // Two faces, never both. On first run (no history) the four-legged intro is
  // shown once — this whole screen is a first-and-only-time thing (Zafer, 18
  // Tem). The moment there is a history, the returning writer gets their own
  // shelf INSTEAD of the cards: their documents matter more than the pitch.
  if (recents) {
    ic.append(recents);
  } else {
    ic.insertAdjacentHTML(
      "beforeend",
      `<div class="kartlar">
        <div class="kart">
          <div class="kart-ikon">${svg('<rect x="4" y="8" width="11" height="11" rx="1.4"/><path d="M9 8V5.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-2"/>', 34)}</div>
          <div><h3>Çok sekmeli çalışma</h3><p>Bütün belgeleriniz tek pencerede, sekme sekme elinizin altında.</p></div>
        </div>
        <div class="kart">
          <div class="kart-ikon">${svg('<path d="M4 12h11"/><path d="M11 8l4 4-4 4"/><path d="M19.5 5v14"/>', 34)}</div>
          <div><h3>Belgeler arası aktarma</h3><p>Bir metnin öne çıkan parçalarını başka bir belgeye saniyeler içinde taşıyın.</p></div>
        </div>
        <div class="kart">
          <div class="kart-ikon">${svg('<path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>', 34)}</div>
          <div><h3>İşaretle ve yorumla</h3><p>Önemli yerleri işaretleyin, notlar alın. Belgeniz tamamen sizin olsun.</p></div>
        </div>
        <div class="kart">
          <div class="kart-ikon">${svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.2 6.2l2.6 2.6M15.2 15.2l2.6 2.6M17.8 6.2l-2.6 2.6M8.8 15.2l-2.6 2.6"/>', 34)}</div>
          <div><h3>Yapay zekâ desteği</h3><p>Metni toparlasın, kelimelere ilham versin. Kalem yine sizde.</p></div>
        </div>
      </div>`,
    );
  }

  empty.querySelector('[data-act="new"]').onclick = onNew;
  empty.querySelector('[data-act="open"]').onclick = onOpen;
  return empty;
}

/**
 * A file that is not Markdown is refused, and says why (UC-01/A2). It fades on
 * its own; nothing to dismiss, nothing to click.
 */
export function sayNotMarkdown(parent, fileName) {
  const existing = parent.querySelector(".refused");
  existing?.remove();

  const note = document.createElement("div");
  note.className = "refused";
  note.innerHTML = `${icon('<path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="9"/>')}<span><b>${fileName}</b> açılmadı — MD Plus yalnız <code>.md</code> açar.</span>`;
  parent.append(note);

  setTimeout(() => note.remove(), 5000);
}
