export default defineAppConfig({
  ui: {
    colors: {
      primary: "green",
      neutral: "slate",
    },
    // Surfaces (main.css): cards are `surface-card`, the floating layer (dialogs, menus, popovers, tooltips) is
    // `surface-glass`, so a theme restyles them through tokens. Popper content is `relative` to anchor the rim.
    card: { slots: { root: "surface-card" } },
    modal: { slots: { content: "surface-glass" } },
    slideover: { slots: { content: "surface-glass" } },
    drawer: { slots: { content: "surface-glass" } },
    popover: { slots: { content: "surface-glass relative" } },
    dropdownMenu: { slots: { content: "surface-glass relative" } },
    contextMenu: { slots: { content: "surface-glass relative" } },
    select: { slots: { content: "surface-glass relative" } },
    selectMenu: { slots: { content: "surface-glass relative" } },
    inputMenu: { slots: { content: "surface-glass relative" } },
    tooltip: { slots: { content: "surface-glass relative" } },
    // Less space above the page title on phones.
    pageHeader: {
      slots: {
        root: "relative border-b border-default py-4 sm:py-8",
        description: "text-base sm:text-lg text-pretty text-muted",
      },
      variants: { title: { true: { description: "mt-2 sm:mt-4" } } },
    },
  },
});
