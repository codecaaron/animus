import { GridBox, FlexBox } from '@animus/elements';

const demo = new Array(100).fill(0).map((_, idx) => idx);

export default function Home() {
  return (
    <GridBox
      p="1vh"
      width={1}
      gap="1vh"
      cols={10}
      autoRows="calc(89vh / 10)"
      fit
    >
      {demo.map((num) => (
        <FlexBox
          bg="navy-200"
          center
          textTransform="uppercase"
          fontWeight={700}
          fontSize={14}
          key={num}
        >
          Griddy
        </FlexBox>
      ))}
    </GridBox>
  );
}
