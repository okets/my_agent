/**
 * Chat controls — renders inline controls (buttons/cards) in assistant messages.
 * Text input is handled by the compose bar via compose_hint messages.
 */

function renderControls(controls, msgId) {
  let html = '<div class="chat-controls-container">';

  for (const control of controls) {
    switch (control.type) {
      case "buttons":
        html += renderButtons(control, msgId);
        break;
      case "cards":
        html += renderCards(control, msgId);
        break;
    }
  }

  html += "</div>";
  return html;
}

function renderButtons(control, msgId) {
  let html = `<div class="chat-controls-buttons" data-control-id="${control.id}" data-msg-id="${msgId}">`;
  for (const opt of control.options) {
    const cls =
      opt.variant === "primary"
        ? "chat-control-btn primary"
        : "chat-control-btn";
    html += `<button class="${cls}" onclick="submitControlFromButton(this, '${escapeAttr(control.id)}', '${escapeAttr(opt.value)}')">${escapeHtml(opt.label)}</button>`;
  }
  html += "</div>";
  return html;
}

function renderCards(control, msgId) {
  const cols = control.columns || 2;
  let html = `<div class="chat-controls-cards cols-${cols}" data-control-id="${control.id}" data-msg-id="${msgId}">`;
  for (const opt of control.options) {
    html += `<button class="chat-control-card" onclick="submitControlFromCard(this, '${escapeAttr(control.id)}', '${escapeAttr(opt.value)}')">`;
    if (opt.emoji) {
      html += `<span class="card-emoji">${opt.emoji}</span>`;
    }
    html += `<span class="card-label">${escapeHtml(opt.label)}</span>`;
    if (opt.description) {
      html += `<span class="card-desc">${escapeHtml(opt.description)}</span>`;
    }
    html += "</button>";
  }
  html += "</div>";
  return html;
}

function submitControlFromButton(btnEl, controlId, value) {
  // Mark as selected, disable all siblings
  const container = btnEl.parentElement;
  container.querySelectorAll(".chat-control-btn").forEach((b) => {
    b.disabled = true;
    b.classList.remove("primary");
  });
  btnEl.classList.add("selected");

  window.dispatchEvent(
    new CustomEvent("control-submit", {
      detail: { controlId, value, displayValue: btnEl.textContent },
    }),
  );
}

function submitControlFromCard(cardEl, controlId, value) {
  // Mark as selected, disable all siblings
  const container = cardEl.parentElement;
  container.querySelectorAll(".chat-control-card").forEach((c) => {
    c.setAttribute("disabled", "true");
  });
  cardEl.classList.add("selected");

  const label = cardEl.querySelector(".card-label")?.textContent || value;
  window.dispatchEvent(
    new CustomEvent("control-submit", {
      detail: { controlId, value, displayValue: label },
    }),
  );
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/'/g, "&#39;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
