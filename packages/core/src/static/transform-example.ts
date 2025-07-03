/**
 * Example of how code would be transformed by the Vite plugin
 */

// ============ ORIGINAL CODE ============
// import { animus } from '@animus-ui/core';
// 
// const Button = animus
//   .styles({
//     padding: '8px 16px',
//     borderRadius: '4px'
//   })
//   .variant({
//     prop: 'size',
//     variants: {
//       small: { padding: '4px 8px' },
//       large: { padding: '12px 24px' }
//     }
//   })
//   .states({
//     disabled: { opacity: 0.5 }
//   })
//   .groups({ space: true, color: true })
//   .asElement('button');
//
// export default Button;

// ============ TRANSFORMED CODE ============
import { createShimmedComponent } from './runtime-shim';

// Component metadata would be injected by build tool
// @ts-ignore - this is just an example
const __animusMetadata = {
  "Button": {
    "baseClass": "animus-Button-b6n",
    "variants": {
      "size": {
        "small": "animus-Button-b6n-size-small",
        "large": "animus-Button-b6n-size-large"
      }
    },
    "states": {
      "disabled": "animus-Button-b6n-state-disabled"
    },
    "systemProps": ["p", "m", "px", "py", "color", "bg"],
    "groups": ["space", "color"],
    "customProps": []
  }
};

// Initialize shim with metadata (this would happen once at app entry)
// initializeAnimusShim(__animusMetadata);

// Create the shimmed component
const Button = createShimmedComponent('button', 'Button');

export default Button;

// ============ USAGE (unchanged) ============
// <Button size="small" disabled p={4} color="red">
//   Click me
// </Button>
//
// Would render as:
// <button class="animus-Button-b6n animus-Button-b6n-size-small animus-Button-b6n-state-disabled animus-p-4 animus-color-red">
//   Click me
// </button>