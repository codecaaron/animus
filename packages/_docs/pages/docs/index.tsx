const Page = () => <></>;

export default Page;

export async function getStaticProps() {
  return {
    redirect: {
      destination: '/docs/start/introduction',
      permanent: false,
    },
  };
}
