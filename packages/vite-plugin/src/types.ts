export interface AnimusVitePluginOptions {
  theme?: string;
  output?: string;
  themeMode?: 'inline' | 'css-variable' | 'hybrid';
  atomic?: boolean;
  transform?: boolean | TransformOptions;
  transformExclude?: RegExp;
}

export interface TransformOptions {
  enabled?: boolean;
  mode?: 'production' | 'development' | 'both';
  preserveDevExperience?: boolean;
  injectMetadata?: 'inline' | 'external' | 'both';
  shimImportPath?: string;
}
