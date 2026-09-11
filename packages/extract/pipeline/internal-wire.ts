export function parseInternalWire<Decoded>(
  json: string,
  wire: string
): Decoded {
  let parsed: Decoded;
  try {
    // SAFETY: `Decoded` is the declared output shape of the encoder named by
    // `wire`; a payload that parses but mismatches is caught by its consumer.
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
