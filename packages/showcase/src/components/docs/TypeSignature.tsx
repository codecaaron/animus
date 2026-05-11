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
      generic: { color: 'violet.400' },
      punct: { color: 'text.dim' },
      param: { color: 'ocean.500' },
      paramType: { color: 'violet.400' },
      return: { color: 'forest.500' },
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
      <TokenSpan>{name}</TokenSpan>
      {generics && <TokenSpan role="generic">&lt;{generics}&gt;</TokenSpan>}
      <TokenSpan>(</TokenSpan>
      {params.map((p, i) => (
        <span key={p.name}>
          <TokenSpan>{p.name}</TokenSpan>
          <TokenSpan>: </TokenSpan>
          <TokenSpan>{p.type}</TokenSpan>
          {i < params.length - 1 && <TokenSpan>, </TokenSpan>}
        </span>
      ))}
      <TokenSpan>)</TokenSpan>
      <TokenSpan> → </TokenSpan>
      <TokenSpan>{returns}</TokenSpan>
    </SignatureContainer>
  );
}
