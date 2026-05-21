/**
 * Wires up the about modal: open on trigger click, close on backdrop/button/Escape.
 */
export function initAbout(): void {
  const trigger = document.getElementById("about-trigger")!;
  const modal = document.getElementById("about-modal")!;
  const backdrop = document.getElementById("about-backdrop")!;
  const closeBtn = document.getElementById("about-close")!;

  function open() {
    modal.classList.add("visible");
    backdrop.classList.add("visible");
  }

  function close() {
    modal.classList.remove("visible");
    backdrop.classList.remove("visible");
  }

  const panel = modal.querySelector(".about-panel")!;

  trigger.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  // Close when clicking the full-screen container outside the panel
  modal.addEventListener("click", close);
  // Prevent clicks inside the panel from bubbling up to the container
  panel.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) close();
  });
}
