<script setup lang="ts">
// Link a movie by hand (#17, decision #14): search Trakt's movies or AniList's anime movies (for MAL), pick one of
// the real results, and the link is stored once the source confirms the pick. Nothing at the sources changes.
type Target = "trakt" | "mal";
interface Candidate {
  id: number;
  title: string;
  year: number | null;
  detail: string | null;
  url: string;
  onList: boolean;
}

const props = defineProps<{ rowKey: string; title: string; target: Target }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ linked: [] }>();

const query = ref("");
const titles = ref<string[]>([]);
const year = ref<number | null>(null);
const results = ref<Candidate[] | null>(null);
const searching = ref(false);
const saving = ref<number | null>(null);
const error = ref<string | null>(null);

const errorText = (e: unknown) =>
  (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? (e as Error).message;
const sourceLabel = computed(() => (props.target === "trakt" ? "Trakt" : "MAL"));

async function search() {
  if (query.value.trim().length < 2) return;
  searching.value = true;
  error.value = null;
  try {
    results.value = await $fetch<Candidate[]>("/api/movies/link-search", {
      query: { target: props.target, q: query.value.trim(), year: year.value ?? undefined },
    });
  } catch (e) {
    error.value = errorText(e);
  } finally {
    searching.value = false;
  }
}

watch(
  open,
  async (o) => {
    if (!o) return;
    results.value = null;
    error.value = null;
    query.value = props.title;
    try {
      const res = await $fetch<{ titles: string[]; year: number | null }>(
        "/api/movies/link-titles",
        { query: { rowKey: props.rowKey } },
      );
      titles.value = res.titles;
      year.value = res.year;
      if (res.titles[0]) query.value = res.titles[0];
    } catch {
      titles.value = [];
    }
    search();
  },
  { immediate: true },
);

function useTitle(t: string) {
  query.value = t;
  search();
}

async function pick(c: Candidate) {
  saving.value = c.id;
  error.value = null;
  try {
    await $fetch("/api/movies/links", {
      method: "POST",
      body: { rowKey: props.rowKey, target: props.target, id: c.id },
    });
    emit("linked");
    open.value = false;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    saving.value = null;
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="`Link to ${sourceLabel}`" :description="title">
    <template #body>
      <div class="space-y-3">
        <p class="text-sm text-muted">
          <template v-if="target === 'trakt'"
            >Pick the <SourceName source="trakt" /> movie this is.</template
          >
          <template v-else
            >An anime movie? Pick its <SourceName source="mal" /> entry (found through
            <SourceName source="anilist" />).</template
          >
          Only the link is saved; nothing is written to the source.
        </p>
        <form class="flex gap-2" @submit.prevent="search">
          <UInput v-model="query" icon="i-lucide-search" class="flex-1" aria-label="Search" />
          <UButton
            type="submit"
            label="Search"
            color="neutral"
            variant="outline"
            :loading="searching"
          />
        </form>
        <div v-if="titles.length > 1" class="flex flex-wrap gap-1">
          <UButton
            v-for="t in titles"
            :key="t"
            :label="t"
            size="xs"
            color="neutral"
            :variant="t === query ? 'soft' : 'ghost'"
            @click="useTitle(t)"
          />
        </div>
        <UAlert v-if="error" color="error" icon="i-lucide-circle-alert" :title="error" />
        <ul
          v-if="results"
          class="max-h-80 overflow-y-auto rounded-md border border-default divide-y divide-default"
        >
          <li v-for="r in results" :key="r.id" class="flex items-center gap-3 px-3 py-2">
            <div class="min-w-0 flex-1">
              <ULink
                :to="r.url"
                target="_blank"
                external
                class="font-medium underline decoration-dotted underline-offset-2"
              >
                {{ r.title }}
              </ULink>
              <div class="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <span v-if="r.year">{{ r.year }}</span>
                <span v-if="r.detail">{{ r.detail }}</span>
                <UBadge
                  v-if="r.onList"
                  label="on your list"
                  color="primary"
                  variant="subtle"
                  size="sm"
                />
              </div>
            </div>
            <UButton
              label="Pick"
              size="xs"
              variant="soft"
              :loading="saving === r.id"
              :disabled="saving !== null"
              @click="pick(r)"
            />
          </li>
          <li v-if="!results.length" class="px-3 py-2 text-sm text-muted">Nothing found.</li>
        </ul>
      </div>
    </template>
  </UModal>
</template>
