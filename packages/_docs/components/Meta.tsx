import Head from 'next/head';
import React from 'react';

export interface MetaProps {
  title?: string;
  description?: string;
}

export const Meta = ({
  title,
  description = 'A configuration driven API for creating articulate component languages and expressive UIs.',
}: MetaProps) => {
  const titleText = title ? `Animus | ${title}` : 'Animus ';
  return (
    <Head>
      <title>{titleText}</title>
      <meta name="description" content={description} />
    </Head>
  );
};
