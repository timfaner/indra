import typescript from "rollup-plugin-typescript2";
import json from "@rollup/plugin-json";

import pkg from "./package.json";

export default [
  {
    input: "./src/index.ts",
    output: [
      {
        file: pkg.main,
        format: "cjs",
      },
      {
        file: pkg.module,
        format: "esm",
      },
      {
        file: pkg.iife,
        format: "iife",
        name: "window.apps",
      },
    ],
    plugins: [typescript(), json()],
  },
];
