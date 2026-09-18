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
    const container = document.createElement("div");
    container.className = "webdav-archive-progress";

    const titleEl = document.createElement("div");
    titleEl.className = "webdav-archive-progress__title";
    titleEl.textContent = title;

    const detailsEl = document.createElement("div");
    detailsEl.className = "webdav-archive-progress__details";
    this.statusEl = document.createElement("div");
    this.statusEl.className = "webdav-archive-progress__status";
    this.percentEl = document.createElement("span");
    this.percentEl.className = "webdav-archive-progress__percent";
    detailsEl.append(this.statusEl, this.percentEl);

    this.progressEl = document.createElement("progress");
    this.progressEl.className = "webdav-archive-progress__bar";
    this.progressEl.max = 100;

    container.append(titleEl, detailsEl, this.progressEl);
    fragment.append(container);
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
