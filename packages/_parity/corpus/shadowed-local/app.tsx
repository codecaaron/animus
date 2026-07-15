import { Button } from './button';

export const Page = () => <Button px={4} />;

export const Shadowed = () => {
  const Button = 'a' as const;
  return <Button href="/x" />;
};
