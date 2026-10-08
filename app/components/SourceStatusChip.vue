<script setup lang="ts">
const props = defineProps<{
  status: 'ok' | 'rate_limited' | 'auth_expired' | 'error' | null
  connected: boolean
  needsAuth: boolean
  blockedUntil: string | null
  lastFetchAt: string | null
  lastError: string | null
}>()

// Ticks once a second so the rate limit countdown stays live.
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 1000)
})
onBeforeUnmount(() => clearInterval(timer))

const secondsLeft = computed(() =>
  props.blockedUntil ? Math.max(0, Math.ceil((new Date(props.blockedUntil).getTime() - now.value) / 1000)) : 0)

const chip = computed(() => {
  switch (props.status) {
    case 'ok': return { label: 'OK', color: 'success' as const, icon: 'i-lucide-circle-check' }
    case 'rate_limited': return { label: `Rate limited · ${secondsLeft.value}s`, color: 'warning' as const, icon: 'i-lucide-timer' }
    case 'auth_expired': return { label: 'Auth expired', color: 'error' as const, icon: 'i-lucide-key-round' }
    case 'error': return { label: 'Error', color: 'error' as const, icon: 'i-lucide-circle-alert' }
    default:
      return props.needsAuth && !props.connected
        ? { label: 'Not connected', color: 'neutral' as const, icon: 'i-lucide-plug' }
        : { label: 'Not checked yet', color: 'neutral' as const, icon: 'i-lucide-circle-dashed' }
  }
})

const tooltip = computed(() => {
  const parts: string[] = []
  if (props.lastFetchAt) parts.push(`Last fetch ${new Date(props.lastFetchAt).toLocaleString()}`)
  if (props.lastError) parts.push(props.lastError)
  return parts.join(' · ') || 'No calls yet'
})
</script>

<template>
  <UTooltip :text="tooltip">
    <UBadge
      :label="chip.label"
      :color="chip.color"
      :icon="chip.icon"
      variant="subtle"
    />
  </UTooltip>
</template>
