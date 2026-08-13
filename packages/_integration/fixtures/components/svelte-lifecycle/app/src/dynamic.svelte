<script lang="ts">
  import { badge } from './definition';

  let { tone, gap }: {
    tone: 'quiet' | 'loud' | 'urgent';
    gap: string;
  } = $props();
  const attrs = $derived(badge.attrs({ tone, gap }));
</script>

<Badge {...attrs} />
