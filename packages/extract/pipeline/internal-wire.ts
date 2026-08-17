/**
 * The decode policy for animus's OWN wires.
 *
 * Every string routed through here is produced by this repository — the
 * QuickJS system loader's serialization of a `SystemInstance`, a NAPI scan
 * result, a plugin's `buildPathAliasesJson` encoder. No consumer-authored text
 * reaches these decoders, so a `JSON.parse` failure is an animus bug, never a
 * recoverable input, and the repository's fail-loud law applies: throw naming
 * the wire and the parse error.
 *
 * The alternative these call sites used to take — substitute an empty value —
 * is worse than a crash precisely because it looks like success. An empty
 * token index reads as "no source defines this token", an empty alias table as
 * "no aliases configured", an empty diagnostic list as "everything validated":
 * in each case the feature the wire feeds goes inert and the build stays
 * green. `parseFilesJson` in `source-ingestion.ts` made the same call for the
 * analysis corpus; this is that decision generalized so the pipeline's
 * internal decoders cannot drift apart on it.
 *
 * `wire` names the payload AND its producer, because the failure has to say
 * which encoder to go look at.
 */
export function parseInternalWire<Decoded>(
  json: string,
  wire: string
): Decoded {
  let parsed: Decoded;
  try {
    // SAFETY: `Decoded` is the declared output shape of the encoder named in
    // `wire`, which is animus's own. A payload that parses but does not match
    // that shape is the same producer bug this function refuses to hide, and
    // is caught by the wire's own consumer rather than re-derived here.
    parsed = JSON.parse(json) as Decoded;
  } catch (error) {
    throw new TypeError(
      `[animus] ${wire} is not valid JSON. animus produces this wire, so ` +
        `this is an engine bug rather than a configuration error: ` +
        `${String(error)}`,
      { cause: error }
    );
  }
  return parsed;
}
