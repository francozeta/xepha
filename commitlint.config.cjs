module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        "core",
        "memory",
        "graph",
        "protocol",
        "cli",
        "adapters",
        "api",
        "playground",
        "website",
        "repo",
        "release",
        "docs",
        "ci",
      ],
    ],
  },
};
