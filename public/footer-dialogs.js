// Footer dialogs (Disclaimer, Contact), shared by the homepage and the /portals/* pages.
// An opener has data-dialog="<dialog id>". The × and Close buttons close natively (<form method="dialog">); Escape is native too.
for (const opener of document.querySelectorAll("[data-dialog]")) {
  const dialog = document.getElementById(opener.dataset.dialog);
  if (!dialog || typeof dialog.showModal !== "function") continue;
  opener.addEventListener("click", () => dialog.showModal());
  // The form fills the dialog box, so a click whose target is the dialog itself landed on the backdrop.
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => opener.focus());
}

// Copy buttons: data-copy="<text>" copies the text and briefly shows "Copied".
for (const btn of document.querySelectorAll("[data-copy]")) {
  const label = btn.textContent;
  let timer = 0;
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      btn.textContent = "Copied";
      clearTimeout(timer);
      timer = setTimeout(() => { btn.textContent = label; }, 1500);
    } catch {
      // No clipboard access: select the address so it can be copied by hand.
      const text = btn.parentElement.querySelector("[data-copy-source]");
      if (text) getSelection().selectAllChildren(text);
    }
  });
}
