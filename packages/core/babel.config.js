module.exports = {
  extends: "../../babel.config.js",
  presets: ["@babel/preset-typescript"],
  include: ["./src/**/*.ts", "./src/**/*.tsx"],
  ignore: ["./**/*.d.ts", "__tests__"],
};
