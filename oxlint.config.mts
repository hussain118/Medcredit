import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import next from "ultracite/oxlint/next";
import drizzle from "ultracite/oxlint/drizzle";
import tanstack from "ultracite/oxlint/tanstack";
import nextJsPlugins from "ultracite/oxlint/next/js-plugins";
import tanstackJsPlugins from "ultracite/oxlint/tanstack/js-plugins";
import shadcn from "ultracite/oxlint/shadcn";
import antiSlop from "ultracite/oxlint/anti-slop";
import { jsPluginSettings, selectJsPlugins } from "ultracite/oxlint/js-plugins";

const jsPlugins = selectJsPlugins(["react-doctor"]);

export default defineConfig({
  env: core.env,
  extends: [
    core,
    react,
    next,
    drizzle,
    tanstack,
    nextJsPlugins,
    tanstackJsPlugins,
    shadcn,
    antiSlop,
    jsPlugins,
  ],
  ignorePatterns: core.ignorePatterns,
  jsPlugins: [...jsPlugins.jsPlugins, ...shadcn.jsPlugins],
  options: { typeAware: true },
  settings: jsPluginSettings,
});
