// Images that failed to load, shared by every poster, so the next candidate is tried (a source's image server can
// refuse) and a refused image is not tried again on another page. Failures only happen in the browser.
const failed = reactive(new Set<string>());

export function usePosterImage() {
  return {
    imageFor: (images: string[] | undefined) => images?.find((u) => !failed.has(u)) ?? null,
    fail: (url: string) => failed.add(url),
  };
}
