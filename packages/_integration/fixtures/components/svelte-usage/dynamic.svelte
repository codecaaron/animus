<script lang="ts">
  import { badge as dynamicBadge } from './definition';

  let { tone, gap }: {
    tone: 'quiet' | 'loud' | 'urgent';
    gap: string;
  } = $props();
  const attrs = $derived(dynamicBadge.attrs({ tone, gap }));
</script>

<Badge {...attrs} />
