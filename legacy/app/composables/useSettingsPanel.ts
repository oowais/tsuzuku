// Settings is a panel over the current page, not a page of its own, so a theme or card style shows on the page behind
// it as it is picked. It is open while the URL has `?settings` (opened by a push, so Back closes it; a refresh or a
// source's sign-in return keeps it open).
export function useSettingsPanel() {
  const route = useRoute();
  const router = useRouter();
  const isOpen = computed(() => "settings" in route.query);

  // The link that opens it on the current page.
  const openTo = computed(() => ({ query: { ...route.query, settings: null } }));

  function close() {
    const { settings: _, ...query } = route.query;
    // Opened from this page: step back to it, so Back does not reopen the panel. Else (a refresh, a sign-in return)
    // drop the query in place.
    const back = import.meta.client ? (window.history.state?.back as string | null) : null;
    const here = router.resolve({ path: route.path, query }).fullPath;
    if (back === here) router.back();
    else void router.replace({ path: route.path, query, hash: route.hash });
  }

  const open = computed({
    get: () => isOpen.value,
    set: (v: boolean) => (v ? router.push(openTo.value) : close()),
  });
  return { open, openTo };
}
