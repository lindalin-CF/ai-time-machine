// Footer "Disclaimer" dialog, shared by the homepage and the /portals/* pages.
// The × and Close buttons close it natively (<form method="dialog">); Escape is native too.
const dialog = document.getElementById("disclaimer");
const opener = document.querySelector("[data-open-disclaimer]");
if (dialog && opener && typeof dialog.showModal === "function") {
  opener.addEventListener("click", () => dialog.showModal());
  // The form fills the dialog box, so a click whose target is the dialog itself landed on the backdrop.
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => opener.focus());
}
