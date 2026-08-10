<script lang="ts">
  import { dynamicNotice, literalNotice } from './definitions';

  interface Props {
    dynamicTone?: 'calm' | 'urgent';
    gap?: string;
  }

  let { dynamicTone = 'urgent', gap = '13px' }: Props = $props();

  const literalAttributes = literalNotice.attrs({ tone: 'quiet' });
  const dynamicAttributes = $derived(
    dynamicNotice.attrs({ tone: dynamicTone, gap })
  );
</script>

<main>
  <p data-animus-probe="literal" {...literalAttributes}>Literal notice</p>
  <section data-animus-probe="dynamic" {...dynamicAttributes}>
    Dynamic notice
  </section>
</main>
