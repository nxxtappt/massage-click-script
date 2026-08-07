(() => {
  async function submitEmailCapture(form) {
    const input = form.querySelector("input[name='email']");
    const status = form.querySelector("[data-email-capture-status]");
    const button = form.querySelector("button[type='submit']");
    const email = String(input?.value || "").trim();
    const source = String(form.dataset.emailSource || "unknown").trim();

    if (!email) return;

    if (status) status.textContent = "Saving...";
    if (button) button.disabled = true;

    try {
      const response = await fetch("/api/email-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          source,
          consent: {
            productUpdates: source === "landing"
          }
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not save your email.");
      }

      if (status) status.textContent = "Thanks — you're on the list.";
      form.reset();
    } catch (error) {
      if (status) status.textContent = error.message;
    } finally {
      if (button) button.disabled = false;
    }
  }

  document.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-email-capture-form]");
    if (!form) return;
    event.preventDefault();
    submitEmailCapture(form);
  });
})();