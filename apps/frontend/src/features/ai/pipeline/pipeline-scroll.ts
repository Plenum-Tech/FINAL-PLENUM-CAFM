/** Scroll so the top of `el` aligns with the top of its nearest scrollable ancestor. */
export function scrollElementStartIntoScrollParent(el: HTMLElement, padding = 16) {
  let parent: HTMLElement | null = el.parentElement;
  while (parent) {
    const { overflowY } = getComputedStyle(parent);
    const scrollable =
      (overflowY === "auto" || overflowY === "scroll") && parent.scrollHeight > parent.clientHeight + 1;
    if (scrollable) {
      const top =
        el.getBoundingClientRect().top -
        parent.getBoundingClientRect().top +
        parent.scrollTop;
      parent.scrollTo({ top: Math.max(0, top - padding), behavior: "smooth" });
      return;
    }
    parent = parent.parentElement;
  }
  el.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
}
