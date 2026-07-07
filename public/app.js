// Progressive enhancement: modals, confirms, auto-submit filters, conditional
// fields, toast auto-hide, double-submit guard. Every action still works as a
// plain HTML form; this file only smooths the experience.

document.addEventListener('click', (e) => {
  // Clicking anywhere on a table row opens its item (link or edit modal),
  // unless the click was on an interactive element inside the row.
  const row = e.target.closest('tr[data-href], tr[data-row-modal]');
  if (row && !e.target.closest('a, button, input, select, textarea, label, form')) {
    if (row.dataset.href) {
      window.location.href = row.dataset.href;
      return;
    }
    document.getElementById(row.dataset.rowModal)?.showModal();
    return;
  }

  const opener = e.target.closest('[data-modal]');
  if (opener) {
    e.preventDefault();
    const dlg = document.getElementById(opener.dataset.modal);
    if (dlg) {
      dlg.showModal();
      const first = dlg.querySelector('input:not([type=hidden]), select, textarea');
      if (first) first.focus();
    }
  }
  const closer = e.target.closest('[data-close]');
  if (closer) closer.closest('dialog')?.close();
});

// Click on the backdrop closes the dialog.
document.querySelectorAll('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) {
    e.preventDefault();
    return;
  }
  // Immediate feedback + double-submit guard.
  const btn = form.querySelector('button[type="submit"][data-busy]');
  if (btn) {
    setTimeout(() => {
      btn.disabled = true;
      btn.textContent = btn.dataset.busy;
    }, 0);
  }
});

// Selects/inputs marked data-autosubmit submit their form on change (filters, impersonation).
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-autosubmit]')) e.target.form?.submit();

  // Conditional fields: data-show-when="fieldName:value1|value2" toggles visibility
  // based on a sibling control in the same form/dialog.
  const scope = e.target.closest('form');
  if (scope && e.target.name) {
    scope.querySelectorAll('[data-show-when]').forEach((el) => {
      const [field, values] = el.dataset.showWhen.split(':');
      if (field !== e.target.name) return;
      const show = values.split('|').includes(e.target.value);
      el.hidden = !show;
      el.querySelectorAll('input, select, textarea').forEach((ctrl) => {
        ctrl.disabled = !show;
        if (!show) ctrl.required = false;
        else if (ctrl.dataset.req) ctrl.required = true;
      });
    });
  }
});

// Initialise conditional fields on load.
document.querySelectorAll('[data-show-when]').forEach((el) => {
  const [field, values] = el.dataset.showWhen.split(':');
  const ctrl = el.closest('form')?.elements[field];
  const show = ctrl && values.split('|').includes(ctrl.value);
  el.hidden = !show;
  el.querySelectorAll('input, select, textarea').forEach((c) => (c.disabled = !show));
});

// Dialogs marked for auto-open (e.g. the "ready to close the visit?" prompt).
document.querySelectorAll('dialog[data-open-on-load]').forEach((d) => d.showModal());

// Toast: fade out after a few seconds.
const toast = document.querySelector('.toast');
if (toast) {
  setTimeout(() => {
    toast.classList.add('toast--hide');
    setTimeout(() => toast.remove(), 500);
  }, 4000);
}
