import { ds } from '../../ds';

const SignatureContainer = ds
  .styles({
    p: 16,
    bg: 'surface',
    border: 1,
    borderColor: 'border',
    borderLeft: 3,
    borderLeftColor: 'primary',
    borderRadius: '0 8px 8px 0',
    fontFamily: 'mono',
    fontSize: 13,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 2,
    lineHeight: 'relaxed',
    overflow: 'auto',
  })
  .asElement('div');

const TokenSpan = ds
  .styles({})
  .variant({
    prop: 'role',
    variants: {
      name: { color: 'primary', fontWeight: 700 },
      generic: { color: '{colors.violet.400}' },
      punct: { color: 'text.dim' },
      param: { color: '{colors.ocean.500}' },
      paramType: { color: '{colors.violet.400}' },
      return: { color: '{colors.forest.500}' },
    },
  })
  .asElement('span');

interface Param {
  name: string;
  type: string;
}

export function TypeSignature({
  name,
  generics,
  params,
  returns,
}: {
  name: string;
  generics?: string;
  params: Param[];
  returns: string;
}) {
  return (
    <SignatureContainer>
      <TokenSpan role="name">{name}</TokenSpan>
      {generics && (
        <TokenSpan role="generic">
          &lt;{generics}&gt;
        </TokenSpan>
      )}
      <TokenSpan role="punct">(</TokenSpan>
      {params.map((p, i) => (
        <span key={p.name}>
          <TokenSpan role="param">{p.name}</TokenSpan>
          <TokenSpan role="punct">: </TokenSpan>
          <TokenSpan role="paramType">{p.type}</TokenSpan>
          {i < params.length - 1 && <TokenSpan role="punct">, </TokenSpan>}
        </span>
      ))}
      <TokenSpan role="punct">)</TokenSpan>
      <TokenSpan role="punct"> → </TokenSpan>
      <TokenSpan role="return">{returns}</TokenSpan>
    </SignatureContainer>
  );
}
