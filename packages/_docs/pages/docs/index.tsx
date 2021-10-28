const Page = () => <></>;

export default Page;

export async function getServerSideProps() {
  return {
    redirect: {
      destination: '/docs/start/introduction',
      permanent: false,
    },
  };
}
