import { keyframes } from '@emotion/react';

export const flow = keyframes`
  	0% {
        background-size: 300px 100%;
        background-position: 0% 50%;
	}
	100% {
        background-position: -200% 50%;
        background-size: 300px 100%;
	}
`;
