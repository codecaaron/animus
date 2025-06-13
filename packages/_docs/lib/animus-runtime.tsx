import React from 'react';

interface ComponentData {
  id: string;
  props?: Record<string, any>;
  states?: Record<string, any>;
}

export function cx(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function __animus_runtime(
  element: string | React.ComponentType,
  staticClass: string,
  componentData: ComponentData
) {
  return React.forwardRef((props: any, ref: React.Ref<any>) => {
    const { className, ...restProps } = props;

    // Process dynamic props here
    const dynamicClasses: string[] = [];
    const processedProps: Record<string, any> = {};

    // Filter out animus props and convert to classes
    for (const [key, value] of Object.entries(restProps)) {
      if (componentData.props && key in componentData.props) {
        // This is an animus prop - convert to class if possible
        // For now, just pass through
        processedProps[key] = value;
      } else {
        processedProps[key] = value;
      }
    }

    // Handle state-based classes
    if (componentData.states) {
      for (const [stateName] of Object.entries(componentData.states)) {
        if (props[stateName]) {
          dynamicClasses.push(`${staticClass}--${stateName}`);
        }
      }
    }

    return React.createElement(element, {
      ...processedProps,
      ref,
      className: cx(staticClass, ...dynamicClasses, className),
    } as any);
  });
}
