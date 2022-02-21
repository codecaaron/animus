import Head from 'next/head';
import React from 'react';

export interface MetaProps {
  title: string;
  description: string;
}

export const Meta = ({ title, description }: MetaProps) => {
  return (
    <Head>
      <title>Animus | {title}</title>
      <meta name="description" content={description} />
    </Head>
  );
};
