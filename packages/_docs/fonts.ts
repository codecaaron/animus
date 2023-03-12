import {
  Cairo,
  DM_Mono,
  Major_Mono_Display,
  Space_Mono,
} from 'next/font/google';

export const Logo = Major_Mono_Display({
  weight: '400',
  style: 'normal',
});

export const Body = Cairo({
  weight: ['400', '600', '700'],
  style: 'normal',
});

export const Heading = Space_Mono({
  weight: ['400', '700'],
  style: ['normal'],
});

export const Mono = DM_Mono({
  style: ['normal', 'italic'],
  weight: '400',
});
