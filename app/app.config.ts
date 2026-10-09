export default defineAppConfig({
  ui: {
    colors: {
      primary: 'green',
      neutral: 'slate'
    },
    // Less space above the page title on phones.
    pageHeader: {
      slots: {
        root: 'relative border-b border-default py-4 sm:py-8',
        description: 'text-base sm:text-lg text-pretty text-muted'
      },
      variants: { title: { true: { description: 'mt-2 sm:mt-4' } } }
    }
  }
})
