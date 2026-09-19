import { Notice } from "obsidian";
import { t } from "./i18n";

export class ProgressNotice {
  private readonly notice: Notice;
  private readonly progressEl: HTMLProgressElement;
  private readonly statusEl: HTMLDivElement;
  private readonly percentEl: HTMLSpanElement;
  private hideTimer: number | null = null;

  constructor(title: string) {
    const fragment = document.createDocumentFragment();
    const container = fragment.createDiv({ cls: "webdav-archive-progress" });

    container.createDiv({ cls: "webdav-archive-progress__title", text: title });

    const detailsEl = container.createDiv({ cls: "webdav-archive-progress__details" });
    this.statusEl = detailsEl.createDiv({ cls: "webdav-archive-progress__status" });
    this.percentEl = detailsEl.createSpan({ cls: "webdav-archive-progress__percent" });

    this.progressEl = container.createEl("progress", { cls: "webdav-archive-progress__bar" });
    this.progressEl.max = 100;

    this.notice = new Notice(fragment, 0);
    this.update(0, t("progress.preparing"));
  }

  update(percent: number, status: string): void {
    const normalized = Math.max(0, Math.min(100, Math.round(percent)));
    this.progressEl.value = normalized;
    this.statusEl.textContent = status;
    this.percentEl.textContent = `${normalized}%`;
  }

  indeterminate(status: string): void {
    this.progressEl.removeAttribute("value");
    this.statusEl.textContent = status;
    this.percentEl.textContent = "";
  }

  succeed(status: string): void {
    this.update(100, status);
    this.progressEl.classList.add("is-success");
    this.scheduleHide(1800);
  }

  fail(status: string): void {
    this.progressEl.removeAttribute("value");
    this.progressEl.classList.add("is-error");
    this.statusEl.textContent = status;
    this.percentEl.textContent = t("progress.failed");
    this.scheduleHide(8000);
  }

  private scheduleHide(delay: number): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
    }
    this.hideTimer = window.setTimeout(() => this.notice.hide(), delay);
  }
}
